import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import { ErrorCodes, ModoAtribuicao, TipoEvento } from '@auditar/shared';
import { badRequest, notFound } from '../../utils/index.js';
import type { NotificacaoJob } from '../../jobs/types.js';
import { STATUS_ENCERRADOS } from './mensagens.publico.service.js';
import { registrar as defaultRegistrar } from '../auditoria/index.js';
import type { RegistrarAuditoriaDto } from '../auditoria/index.js';
import type { AtribuirInput, ReatribuirInput } from './processos.atribuicao.schema.js';

/**
 * Serviço de Atribuição e Reatribuição de Processos (Task 7.7, Requisito 12).
 *
 * Cobre:
 *  - `selecionarServidorMenorCarga` — algoritmo puro de menor carga com
 *    desempate por tempo desde a última atribuição (Req 12.2). Sem I/O, para
 *    que a tarefa 7.8 (property test) possa exercitá-lo diretamente.
 *  - `atribuir` — atribuição pelos três modos: automático (menor carga),
 *    manual (servidor escolhido) e fila_geral (disponível para qualquer
 *    Servidor da Unidade). Registra Auditoria e notifica o Servidor atribuído
 *    (Req 12.1, 12.2, 12.5, 12.7).
 *  - `listarCargasDisponiveis` — carga ativa de cada Servidor da Unidade,
 *    exibida ANTES da confirmação da atribuição manual (Req 12.4).
 *  - `reatribuir` — reatribuição com justificativa validada e Auditoria
 *    origem→destino (Req 12.8, 12.9, 12.10).
 *  - `atribuirAutomaticamente` — lógica compartilhada usada tanto pelo
 *    endpoint `modo=automatico` quanto pelo worker de atribuição automática
 *    (Req 12.2, 12.3). Quando nenhum Servidor está disponível, move o Processo
 *    para a Fila_Geral (`servidorResponsavelId` fica null) e registra o evento
 *    no Módulo_de_Auditoria (Req 12.3).
 *
 * O registro em Auditoria usa `registrar` (assíncrono, nunca lança) — o
 * Requisito 12.7/12.10 não exige atomicidade transacional com o UPDATE do
 * Processo. A notificação ao Servidor e a emissão via Socket.io são
 * "fire-and-forget", mesmo padrão de `processos.tramitacao.service.ts`.
 *
 * Requisitos: 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8, 12.9, 12.10
 */

const MODULO = 'processos';

const MENSAGEM_PROCESSO_NAO_ENCONTRADO = 'Processo não encontrado';
const MENSAGEM_PROCESSO_ENCERRADO =
  'Processo encerrado; não é possível atribuir ou reatribuir';
const MENSAGEM_SERVIDOR_INVALIDO =
  'Servidor indisponível: verifique se está ativo e pertence à unidade do processo';

// ---------------------------------------------------------------------------
// Algoritmo puro de menor carga (Req 12.2) — export por este nome exato
// ---------------------------------------------------------------------------

/**
 * Carga de um Servidor considerada pelo algoritmo de atribuição automática.
 * `processosAtivos` = quantidade de Processos NÃO encerrados atribuídos ao
 * Servidor; `ultimaAtribuicaoEm` = instante da última atribuição recebida
 * (null quando o Servidor nunca recebeu uma atribuição — tratado como
 * "infinitamente antigo", ou seja, de mais alta prioridade no desempate).
 */
export interface CargaServidor {
  servidorId: string;
  processosAtivos: number;
  ultimaAtribuicaoEm: Date | null;
}

/**
 * Seleciona o Servidor com a MENOR carga de Processos ativos (Req 12.2).
 *
 * Regra de desempate: quando dois Servidores têm a mesma quantidade de
 * Processos ativos, vence aquele com maior tempo desde a última atribuição —
 * isto é, o menor/mais antigo `ultimaAtribuicaoEm`. Um `ultimaAtribuicaoEm`
 * null representa um Servidor que nunca recebeu atribuição, portanto tem a
 * maior prioridade (considerado infinitamente antigo).
 *
 * Função PURA e determinística (sem I/O), para que a tarefa 7.8 possa
 * exercitá-la diretamente no property test.
 *
 * @returns o Servidor escolhido, ou `null` quando a lista está vazia.
 */
export function selecionarServidorMenorCarga(
  servidores: readonly CargaServidor[],
): CargaServidor | null {
  if (servidores.length === 0) return null;

  return servidores.reduce((melhor, candidato) => {
    // Menor número de processos ativos vence.
    if (candidato.processosAtivos !== melhor.processosAtivos) {
      return candidato.processosAtivos < melhor.processosAtivos ? candidato : melhor;
    }

    // Empate na carga: vence o de última atribuição mais antiga. null = mais
    // antigo possível (nunca recebeu atribuição).
    const tempoCandidato =
      candidato.ultimaAtribuicaoEm === null ? -Infinity : candidato.ultimaAtribuicaoEm.getTime();
    const tempoMelhor =
      melhor.ultimaAtribuicaoEm === null ? -Infinity : melhor.ultimaAtribuicaoEm.getTime();

    return tempoCandidato < tempoMelhor ? candidato : melhor;
  });
}

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa as instâncias reais por padrão)
// ---------------------------------------------------------------------------

/** Enfileiramento de notificação — mesmo payload da `notificacao-queue`. */
export type NotificarAtribuicaoFn = (payload: NotificacaoJob) => Promise<unknown>;

/** Dependências injetáveis do serviço. */
export interface AtribuicaoDeps {
  /** Precisa de `processo`, `servidor` e `unidade`. */
  prisma: Pick<PrismaClient, 'processo' | 'servidor' | 'unidade'>;
  notificar: NotificarAtribuicaoFn;
  auditar: (dto: RegistrarAuditoriaDto) => Promise<void>;
}

let cachedPrisma: AtribuicaoDeps['prisma'] | undefined;
let cachedNotificar: NotificarAtribuicaoFn | undefined;

/**
 * Resolve o Prisma real preguiçosamente (lazy). Só é chamada quando o
 * chamador NÃO injeta `deps.prisma` — importar este módulo não deve carregar
 * o `@prisma/client`.
 */
function getRealPrisma(): AtribuicaoDeps['prisma'] {
  if (!cachedPrisma) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };
    cachedPrisma = prisma as unknown as AtribuicaoDeps['prisma'];
  }
  return cachedPrisma;
}

/**
 * Resolve o enfileiramento de notificação real preguiçosamente (lazy). Só é
 * chamada quando o chamador NÃO injeta `deps.notificar` — importar este
 * módulo não deve abrir conexão com o Redis/BullMQ.
 */
function getRealNotificar(): NotificarAtribuicaoFn {
  if (!cachedNotificar) {
    const requireLocal = createRequire(import.meta.url);
    const { notificacaoQueue, QUEUE_NAMES } = requireLocal('../../jobs/queues.js') as {
      notificacaoQueue: () => { add: (name: string, data: unknown) => Promise<unknown> };
      QUEUE_NAMES: Record<string, string>;
    };
    cachedNotificar = (payload) => notificacaoQueue().add(QUEUE_NAMES.NOTIFICACAO, payload);
  }
  return cachedNotificar;
}

function resolveDeps(deps?: Partial<AtribuicaoDeps>): AtribuicaoDeps {
  return {
    prisma: deps?.prisma ?? getRealPrisma(),
    notificar: deps?.notificar ?? getRealNotificar(),
    auditar: deps?.auditar ?? defaultRegistrar,
  };
}

// ---------------------------------------------------------------------------
// Emissão de eventos em tempo real via Socket.io (tarefa 9.3 — pode não existir)
// ---------------------------------------------------------------------------

type EmitFn = (room: string, event: string, payload: unknown) => void;
let cachedEmit: EmitFn | undefined;

/**
 * Resolve preguiçosamente a função de emissão do Socket.io. O servidor
 * Socket.io é criado na tarefa 9.3 — enquanto não existir, cai silenciosamente
 * em um no-op. Assim que `socket/socket.server.js#getIO` existir, a emissão
 * passa a funcionar sem alterar este arquivo (mesmo padrão de
 * `processos.tramitacao.service.ts`).
 */
function getRealEmit(): EmitFn {
  if (!cachedEmit) {
    try {
      const requireLocal = createRequire(import.meta.url);
      const { getIO } = requireLocal('../../socket/socket.server.js') as {
        getIO: () => { to: (room: string) => { emit: (e: string, p: unknown) => void } };
      };
      cachedEmit = (room, event, payload) => {
        getIO().to(room).emit(event, payload);
      };
    } catch {
      cachedEmit = () => {}; /* Socket.io (tarefa 9.3) ainda não existe — no-op */
    }
  }
  return cachedEmit;
}

/** Emite um evento em tempo real sem nunca propagar erro (fire-and-forget síncrono). */
function emitSeguro(room: string, event: string, payload: unknown): void {
  try {
    getRealEmit()(room, event, payload);
  } catch {
    /* nunca propaga */
  }
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Executa uma operação assíncrona sem aguardar seu resultado, registrando
 * (mas nunca propagando) uma eventual falha. Usado para a notificação ao
 * Servidor atribuído, que jamais deve derrubar a atribuição já persistida.
 */
function fireAndForget(operacao: () => Promise<unknown>, evento: string): void {
  operacao().catch((err: unknown) => {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: MODULO,
        event: evento,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  });
}

/** Formato crú do Processo carregado para as operações de atribuição. */
interface ProcessoParaAtribuicao {
  id: string;
  status: string;
  unidadeId: string;
  protocolo: string;
  servidorResponsavelId: string | null;
}

/** Carrega o Processo e valida que existe e não está encerrado. */
async function carregarProcessoAtribuivel(
  d: AtribuicaoDeps,
  processoId: string,
): Promise<ProcessoParaAtribuicao> {
  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      id: true,
      status: true,
      unidadeId: true,
      protocolo: true,
      servidorResponsavelId: true,
    },
  })) as ProcessoParaAtribuicao | null;

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  if (STATUS_ENCERRADOS.includes(processo.status)) {
    throw badRequest(ErrorCodes.PROCESSO_ENCERRADO, MENSAGEM_PROCESSO_ENCERRADO);
  }

  return processo;
}

/**
 * Verifica que o Servidor existe, está ativo e pertence à Unidade informada.
 * Lança 400 caso contrário (Req 12.1 — atribuição manual exige um Servidor
 * válido da mesma Unidade do Processo).
 */
async function validarServidorDaUnidade(
  d: AtribuicaoDeps,
  servidorId: string,
  unidadeId: string,
): Promise<void> {
  const servidor = (await d.prisma.servidor.findUnique({
    where: { id: servidorId },
    select: { ativo: true, unidadeId: true },
  })) as { ativo: boolean; unidadeId: string } | null;

  if (!servidor || !servidor.ativo || servidor.unidadeId !== unidadeId) {
    throw badRequest(ErrorCodes.VALIDATION_ERROR, MENSAGEM_SERVIDOR_INVALIDO, 'servidorId');
  }
}

/**
 * Coleta a carga de cada Servidor ativo da Unidade: número de Processos ativos
 * (não encerrados) e o instante da última atribuição recebida. A "última
 * atribuição" é aproximada pelo Processo ativo mais recente do Servidor
 * (`abertoEm` mais recente) — na ausência de uma coluna dedicada de
 * timestamp de atribuição, é a melhor aproximação disponível no schema atual.
 */
async function coletarCargas(d: AtribuicaoDeps, unidadeId: string): Promise<CargaServidor[]> {
  const servidores = (await d.prisma.servidor.findMany({
    where: { unidadeId, ativo: true },
    select: {
      id: true,
      processos: {
        where: { status: { notIn: [...STATUS_ENCERRADOS] } },
        select: { abertoEm: true },
        orderBy: { abertoEm: 'desc' },
      },
    },
  })) as { id: string; processos: { abertoEm: Date }[] }[];

  return servidores.map((s) => ({
    servidorId: s.id,
    processosAtivos: s.processos.length,
    ultimaAtribuicaoEm: s.processos[0]?.abertoEm ?? null,
  }));
}

// ---------------------------------------------------------------------------
// GET /:id/atribuir/cargas (Req 12.4)
// ---------------------------------------------------------------------------

/** Carga exibida ao Gestor antes da confirmação da atribuição manual (Req 12.4). */
export interface CargaServidorDisponivel {
  servidorId: string;
  nome: string;
  processosAtivos: number;
}

/**
 * Lista os Servidores ativos da Unidade do Processo com o número de Processos
 * ativos atribuídos a cada um, para exibição ANTES da confirmação da
 * atribuição manual (Req 12.4).
 *
 * @throws {AppError} 404 — Processo inexistente.
 */
export async function listarCargasDisponiveis(
  processoId: string,
  deps?: Partial<AtribuicaoDeps>,
): Promise<CargaServidorDisponivel[]> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { unidadeId: true },
  })) as { unidadeId: string } | null;

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  const servidores = (await d.prisma.servidor.findMany({
    where: { unidadeId: processo.unidadeId, ativo: true },
    select: {
      id: true,
      nome: true,
      processos: {
        where: { status: { notIn: [...STATUS_ENCERRADOS] } },
        select: { id: true },
      },
    },
  })) as { id: string; nome: string; processos: { id: string }[] }[];

  return servidores.map((s) => ({
    servidorId: s.id,
    nome: s.nome,
    processosAtivos: s.processos.length,
  }));
}

// ---------------------------------------------------------------------------
// Resultado das operações de atribuição
// ---------------------------------------------------------------------------

/** Resumo do resultado de uma atribuição/reatribuição. */
export interface AtribuicaoResultado {
  processoId: string;
  /** Servidor atribuído, ou null quando o Processo foi para a Fila_Geral. */
  servidorId: string | null;
  modo: string;
  /** true quando nenhum Servidor foi atribuído e o Processo caiu na Fila_Geral. */
  filaGeral: boolean;
}

/**
 * Persiste a atribuição de um Processo a um Servidor (ou a null, para
 * Fila_Geral), registra a Auditoria e dispara as notificações/emissões
 * apropriadas. Compartilhado por todos os modos e pelo worker.
 */
async function persistirAtribuicao(
  d: AtribuicaoDeps,
  processo: ProcessoParaAtribuicao,
  servidorId: string | null,
  modo: string,
  ator: { atorServidorId?: string; enderecoIp: string },
): Promise<AtribuicaoResultado> {
  await d.prisma.processo.update({
    where: { id: processo.id },
    data: { servidorResponsavelId: servidorId },
  });

  // Req 12.7 — registra a atribuição no Módulo_de_Auditoria (processoId,
  // servidorId, modo, data/hora implícita). `registrar` nunca lança (Req 17.8).
  await d.auditar({
    tipoAcao: servidorId ? 'atribuir_processo' : 'atribuir_processo_fila_geral',
    modulo: MODULO,
    objetoId: processo.id,
    tipoObjeto: 'Processo',
    ator: 'servidor',
    atorServidorId: ator.atorServidorId,
    enderecoIp: ator.enderecoIp,
    valorAnterior: { servidorId: processo.servidorResponsavelId },
    valorPosterior: { servidorId, modo },
  });

  if (servidorId) {
    // Req 12.7 — notificar o Servidor atribuído (fire-and-forget) + emissão.
    fireAndForget(
      () =>
        d.notificar({
          tipo: 'painel',
          destinatario: { servidorId },
          tipoEvento: TipoEvento.ATRIBUICAO,
          conteudo: processo.protocolo,
          processoId: processo.id,
        }),
      'notificar_atribuicao_falhou',
    );
    emitSeguro(`servidor:${servidorId}`, 'processo:atribuido', {
      processoId: processo.id,
      servidorId,
    });
  } else {
    // Fila_Geral: sinaliza a chegada do Processo à Unidade (Req 12.5/12.3).
    emitSeguro(`unidade:${processo.unidadeId}`, 'fila:novo_processo', {
      processoId: processo.id,
      protocolo: processo.protocolo,
    });
  }

  return {
    processoId: processo.id,
    servidorId,
    modo,
    filaGeral: servidorId === null,
  };
}

// ---------------------------------------------------------------------------
// Atribuição automática compartilhada (Req 12.2, 12.3)
// ---------------------------------------------------------------------------

/**
 * Executa a atribuição automática de um Processo já carregado: seleciona o
 * Servidor de menor carga da Unidade (Req 12.2). Quando nenhum Servidor está
 * disponível, move o Processo para a Fila_Geral (`servidorResponsavelId` fica
 * null) e o evento correspondente é registrado na Auditoria (Req 12.3).
 *
 * Compartilhado pelo endpoint `modo=automatico` e pelo worker de atribuição
 * automática, garantindo uma única fonte da lógica.
 */
async function atribuirAutomaticamenteInterno(
  d: AtribuicaoDeps,
  processo: ProcessoParaAtribuicao,
  ator: { atorServidorId?: string; enderecoIp: string },
): Promise<AtribuicaoResultado> {
  const cargas = await coletarCargas(d, processo.unidadeId);
  const escolhido = selecionarServidorMenorCarga(cargas);

  return persistirAtribuicao(
    d,
    processo,
    escolhido?.servidorId ?? null,
    ModoAtribuicao.AUTOMATICO,
    ator,
  );
}

// ---------------------------------------------------------------------------
// POST /:id/atribuir (Req 12.1, 12.2, 12.4, 12.5, 12.7)
// ---------------------------------------------------------------------------

/**
 * Atribui um Processo segundo o modo informado (Req 12.1):
 *  - `manual`: exige `servidorId` (validado no schema); o Servidor precisa
 *    existir, estar ativo e pertencer à Unidade do Processo (Req 12.1).
 *  - `automatico`: seleciona o Servidor de menor carga; se nenhum disponível,
 *    move para a Fila_Geral + Auditoria (Req 12.2, 12.3).
 *  - `fila_geral`: deixa o Processo disponível na fila da Unidade
 *    (`servidorResponsavelId` = null) — Req 12.5.
 *
 * @throws {AppError} 404 — Processo inexistente.
 * @throws {AppError} 400 `PROCESSO_ENCERRADO` — Processo em status terminal.
 * @throws {AppError} 400 `VALIDATION_ERROR` — Servidor inválido no modo manual.
 */
export async function atribuir(
  processoId: string,
  dto: AtribuirInput,
  servidorAtorId: string,
  enderecoIp: string,
  deps?: Partial<AtribuicaoDeps>,
): Promise<AtribuicaoResultado> {
  const d = resolveDeps(deps);
  const processo = await carregarProcessoAtribuivel(d, processoId);
  const ator = { atorServidorId: servidorAtorId, enderecoIp };

  if (dto.modo === ModoAtribuicao.MANUAL) {
    // `servidorId` presença já garantida pelo schema (superRefine).
    const servidorId = dto.servidorId as string;
    await validarServidorDaUnidade(d, servidorId, processo.unidadeId);
    return persistirAtribuicao(d, processo, servidorId, ModoAtribuicao.MANUAL, ator);
  }

  if (dto.modo === ModoAtribuicao.AUTOMATICO) {
    return atribuirAutomaticamenteInterno(d, processo, ator);
  }

  // Fila_Geral: nenhum Servidor atribuído (Req 12.5).
  return persistirAtribuicao(d, processo, null, ModoAtribuicao.FILA_GERAL, ator);
}

// ---------------------------------------------------------------------------
// Atribuição automática ao criar Processo (Req 12.2, 12.3) — usada pelo worker
// e pelo hook `agendarAtribuicao` de `processos.service.ts`
// ---------------------------------------------------------------------------

/**
 * Atribui automaticamente um Processo recém-criado, respeitando o
 * `modoAtribuicao` configurado na Unidade (Req 12.1):
 *  - Só executa o algoritmo de menor carga quando a Unidade está em modo
 *    AUTOMATICO (Req 12.2). Nos demais modos (manual/fila_geral) não faz nada
 *    automaticamente — o Processo aguarda ação do Gestor / voluntariado.
 *  - Quando em AUTOMATICO e nenhum Servidor está disponível, move o Processo
 *    para a Fila_Geral + Auditoria (Req 12.3).
 *
 * Nunca lança para o chamador do hook (é invocado como "fire-and-forget" em
 * `processos.service.ts#criarProcesso`): valida existência/encerramento do
 * Processo internamente e, se algo estiver errado, apenas retorna sem agir.
 *
 * Assinatura compatível com `AgendarAtribuicaoFn` de `processos.service.ts`.
 */
export async function atribuirAutomaticamente(
  processoId: string,
  unidadeId: string,
  deps?: Partial<AtribuicaoDeps>,
): Promise<AtribuicaoResultado | null> {
  const d = resolveDeps(deps);

  const unidade = (await d.prisma.unidade.findUnique({
    where: { id: unidadeId },
    select: { modoAtribuicao: true },
  })) as { modoAtribuicao: string } | null;

  // Só atribui automaticamente quando a Unidade está em modo AUTOMATICO
  // (Req 12.1/12.2). Nos demais modos, nada a fazer aqui.
  if (!unidade || unidade.modoAtribuicao !== ModoAtribuicao.AUTOMATICO) {
    return null;
  }

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      id: true,
      status: true,
      unidadeId: true,
      protocolo: true,
      servidorResponsavelId: true,
    },
  })) as ProcessoParaAtribuicao | null;

  // Processo já encerrado ou inexistente: nada a fazer.
  if (!processo || STATUS_ENCERRADOS.includes(processo.status)) {
    return null;
  }

  return atribuirAutomaticamenteInterno(d, processo, { enderecoIp: 'sistema' });
}

// ---------------------------------------------------------------------------
// POST /:id/reatribuir (Req 12.8, 12.9, 12.10)
// ---------------------------------------------------------------------------

/**
 * Reatribui um Processo de um Servidor para outro (Req 12.8, 12.10). A
 * justificativa (20–500 chars) já foi validada pelo schema ANTES desta camada
 * — nenhuma alteração de estado ocorre quando o tamanho é inválido (Req 12.9).
 *
 * 1. 404 quando o Processo não existe; 400 `PROCESSO_ENCERRADO` quando já
 *    encerrado.
 * 2. O Servidor de destino precisa existir, estar ativo e pertencer à Unidade.
 * 3. Captura o Servidor de origem (`servidorResponsavelId` atual), atualiza
 *    para o destino e registra a Auditoria com origem, destino e justificativa
 *    (Req 12.10). Notifica o destino (fire-and-forget) + emissão.
 *
 * @throws {AppError} 404 / 400 `PROCESSO_ENCERRADO` / 400 `VALIDATION_ERROR`.
 */
export async function reatribuir(
  processoId: string,
  dto: ReatribuirInput,
  servidorAtorId: string,
  enderecoIp: string,
  deps?: Partial<AtribuicaoDeps>,
): Promise<AtribuicaoResultado> {
  const d = resolveDeps(deps);
  const processo = await carregarProcessoAtribuivel(d, processoId);

  await validarServidorDaUnidade(d, dto.servidorDestinoId, processo.unidadeId);

  const origemId = processo.servidorResponsavelId;

  await d.prisma.processo.update({
    where: { id: processo.id },
    data: { servidorResponsavelId: dto.servidorDestinoId },
  });

  // Req 12.10 — registra origem, destino e justificativa no Módulo_de_Auditoria.
  await d.auditar({
    tipoAcao: 'reatribuir_processo',
    modulo: MODULO,
    objetoId: processo.id,
    tipoObjeto: 'Processo',
    ator: 'servidor',
    atorServidorId: servidorAtorId,
    enderecoIp,
    valorAnterior: { servidorId: origemId },
    valorPosterior: { servidorId: dto.servidorDestinoId, justificativa: dto.justificativa },
  });

  fireAndForget(
    () =>
      d.notificar({
        tipo: 'painel',
        destinatario: { servidorId: dto.servidorDestinoId },
        tipoEvento: TipoEvento.ATRIBUICAO,
        conteudo: processo.protocolo,
        processoId: processo.id,
      }),
    'notificar_reatribuicao_falhou',
  );

  emitSeguro(`servidor:${dto.servidorDestinoId}`, 'processo:atribuido', {
    processoId: processo.id,
    servidorId: dto.servidorDestinoId,
  });

  return {
    processoId: processo.id,
    servidorId: dto.servidorDestinoId,
    modo: 'reatribuicao',
    filaGeral: false,
  };
}
