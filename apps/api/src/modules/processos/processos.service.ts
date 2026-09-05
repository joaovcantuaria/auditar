import { createRequire } from 'node:module';
import type { PrismaClient, Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import { ErrorCodes, StatusProcesso, TipoEvento } from '@auditar/shared';
import {
  badRequest,
  gerarProtocolo,
  calcularPrazoFinal,
  resolverPrefixo,
} from '../../utils/index.js';
import { registrar as defaultRegistrar } from '../auditoria/auditoria.service.js';
import type { RegistrarAuditoriaDto } from '../auditoria/auditoria.types.js';
import type { FormularioComCampos } from '../formularios/formularios.service.js';
import type { NotificacaoJob } from '../../jobs/types.js';
import type { CriarProcessoInput, FiltroProcessoCidadaoInput } from './processos.schema.js';

/**
 * Serviço de Criação e Acompanhamento de Processos pelo Cidadão (Req. 4, 3).
 *
 * Fluxo de criação (Fluxo 1 do design — Wizard 6 Etapas):
 *  1. Valida Tipo_de_Processo (existe, ativo, Categoria ativa) e Unidade
 *     (existe, ativa) — Req. 4.1, 4.2, 4.3, 4.12, 4.13.
 *  2. Carrega o Formulário_Dinâmico do par Tipo+Unidade e garante que todo
 *     campo obrigatório tem uma resposta preenchida — Req. 4.6.
 *  3. Gera o Protocolo único (`AAAA-NNNNN`) via `INCR` atômico no Redis —
 *     Req. 4.8.
 *  4. Calcula o prazo final a partir do prazo total do Tipo_de_Processo em
 *     dias úteis.
 *  5. Persiste o Processo + as RespostaFormulario dentro de UMA transação
 *     Prisma, vinculando os Documentos já enviados (se houver).
 *  6. Após o commit, dispara notificação ao Cidadão e o agendamento da
 *     atribuição automática de forma "fire-and-forget" (nunca bloqueiam nem
 *     derrubam a criação) e registra a ação na Auditoria.
 *
 * Falhas durante ou após a transação de persistência SÃO propagadas — o
 * Cidadão deve poder tentar novamente sem perder os dados já preenchidos no
 * wizard (Req. 4.11). Apenas as etapas explicitamente "fire-and-forget"
 * (notificação e agendamento de atribuição) engolem os próprios erros.
 *
 * As dependências (prisma, redis, auditar, obterFormulario, notificar,
 * agendarAtribuicao) são injetáveis para facilitar os testes unitários — em
 * produção usam as instâncias/módulos reais, resolvidos de forma preguiçosa
 * (lazy) para não carregar o Prisma Client nem abrir conexões ao apenas
 * importar este módulo (mesmo padrão de `servidores.service.ts`).
 */

const MODULO = 'processos';

// ---------------------------------------------------------------------------
// Injeção de dependências
// ---------------------------------------------------------------------------

/**
 * Ator que dispara a criação — usado para registrar a auditoria.
 *
 * - No fluxo do Portal_do_Cidadão (tarefa 7.1), o próprio Cidadão dono do
 *   Processo é o ator: apenas `cidadaoId` + `enderecoIp` são informados e a
 *   auditoria é registrada como `ator: 'cidadao'`.
 * - No fluxo de abertura pelo Servidor (tarefa 20.2, Req. 23), quem age é um
 *   Servidor autenticado: informa-se adicionalmente `servidorId`, e a auditoria
 *   passa a ser registrada como `ator: 'servidor'` (com o Cidadão vinculado ao
 *   Processo em `atorCidadaoId`). O motor de criação é o mesmo — só muda o ator.
 */
export interface Ator {
  cidadaoId: string;
  enderecoIp: string;
  /** Presente somente quando um Servidor abre o Processo em nome do Cidadão. */
  servidorId?: string;
}

/** Cliente mínimo de auditoria — permite injetar um mock nos testes. */
export type Auditar = (dto: RegistrarAuditoriaDto) => Promise<void>;

/** Leitura do Formulário_Dinâmico ativo de um par Tipo_de_Processo + Unidade. */
export type ObterFormularioFn = (
  tipoProcessoId: string,
  unidadeId: string,
) => Promise<FormularioComCampos | null>;

/** Enfileiramento de notificação — mesmo payload da `notificacao-queue`. */
export type NotificarFn = (payload: NotificacaoJob) => Promise<unknown>;

/**
 * Agendamento da atribuição automática de um Processo recém-criado. A tarefa
 * 7.7 injeta a implementação real (algoritmo de menor carga / fila geral —
 * Req. 12); aqui existe apenas o contrato + um default não-bloqueante.
 */
export type AgendarAtribuicaoFn = (processoId: string, unidadeId: string) => Promise<unknown>;

/** Dependências injetáveis do serviço. */
export interface ProcessosServiceDeps {
  prisma: PrismaClient;
  redis: Pick<Redis, 'incr' | 'expire'>;
  auditar: Auditar;
  obterFormulario: ObterFormularioFn;
  notificar: NotificarFn;
  agendarAtribuicao: AgendarAtribuicaoFn;
}

/**
 * Hook de agendamento da atribuição automática (Req. 12 — implementado de
 * fato na tarefa 7.7). Implementação padrão: apenas registra a intenção e
 * resolve, SEM bloquear a criação do Processo. A tarefa 7.7 deve substituir
 * este comportamento injetando `agendarAtribuicao` com o algoritmo real.
 */
export async function agendarAtribuicaoAutomatica(
  processoId: string,
  unidadeId: string,
): Promise<void> {
  console.log(
    JSON.stringify({
      level: 'info',
      scope: MODULO,
      event: 'atribuicao_automatica_pendente',
      processoId,
      unidadeId,
    }),
  );
}

/**
 * Resolve as dependências reais preguiçosamente (lazy). Importar este módulo
 * NÃO deve carregar o Prisma Client, abrir conexão com o Redis, nem puxar os
 * módulos de Formulários/Jobs — só quando uma operação é executada sem
 * dependências injetadas. Mantém os testes (que injetam mocks) independentes
 * da geração do client Prisma.
 */
let cachedDeps: ProcessosServiceDeps | undefined;

function resolveDeps(deps?: ProcessosServiceDeps): ProcessosServiceDeps {
  if (deps) return deps;
  if (!cachedDeps) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };
    const { redis } = requireLocal('../../config/redis.js') as { redis: Redis };
    const { obterPorTipoUnidade } = requireLocal('../formularios/formularios.service.js') as {
      obterPorTipoUnidade: ObterFormularioFn;
    };
    const { notificacaoQueue, QUEUE_NAMES } = requireLocal('../../jobs/queues.js') as {
      notificacaoQueue: () => { add: (name: string, data: unknown) => Promise<unknown> };
      QUEUE_NAMES: Record<string, string>;
    };
    // Tarefa 7.7 fornece a implementação real da atribuição automática
    // (algoritmo de menor carga / Fila_Geral — Req. 12). Resolvida de forma
    // preguiçosa aqui para não puxar o Prisma nem abrir conexões ao apenas
    // importar este módulo. Os testes injetam `agendarAtribuicao` via `deps`,
    // então esta resolução real nunca é exercitada por eles.
    const { atribuirAutomaticamente } = requireLocal('./processos.atribuicao.service.js') as {
      atribuirAutomaticamente: AgendarAtribuicaoFn;
    };

    cachedDeps = {
      prisma,
      redis,
      auditar: defaultRegistrar,
      obterFormulario: obterPorTipoUnidade,
      notificar: (payload) => notificacaoQueue().add(QUEUE_NAMES.NOTIFICACAO, payload),
      agendarAtribuicao: atribuirAutomaticamente,
    };
  }
  return cachedDeps;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Executa uma operação assíncrona sem aguardar seu resultado, registrando
 * (mas nunca propagando) uma eventual falha. Usado para notificação e
 * agendamento de atribuição, que jamais devem bloquear ou derrubar a criação
 * do Processo. */
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

/** Um valor é considerado "vazio" (campo obrigatório não preenchido) quando é
 * `undefined`/`null`, uma string em branco ou um array vazio. */
function valorVazio(valor: unknown): boolean {
  if (valor === undefined || valor === null) return true;
  if (typeof valor === 'string') return valor.trim().length === 0;
  if (Array.isArray(valor)) return valor.length === 0;
  return false;
}

/** Normaliza o valor de uma resposta para persistência: strings passam direto,
 * qualquer outro tipo é serializado em JSON (`RespostaFormulario.valor` é
 * `String` no schema). */
function normalizarValor(valor: unknown): string {
  return typeof valor === 'string' ? valor : JSON.stringify(valor);
}

// ---------------------------------------------------------------------------
// Criação de Processo (Req. 4.1 – 4.13)
// ---------------------------------------------------------------------------

/** Resultado da criação: o Protocolo gerado e o id do Processo criado. */
export interface CriarProcessoResultado {
  protocolo: string;
  processoId: string;
}

/**
 * Cria um novo Processo a partir da submissão da etapa 6 do wizard.
 *
 * Motor único de criação de Processo: é reutilizado tanto pelo Portal do
 * Cidadão (tarefa 7.1) quanto pela abertura administrativa pelo Servidor
 * (tarefa 20.2 / `abrirProcessoPeloServidor`). O que muda entre os dois é
 * apenas o ator registrado na Auditoria (ver `Ator.servidorId`).
 *
 * @param cidadaoId id do Cidadão dono do Processo
 * @param dto       payload validado por `criarProcessoSchema`
 * @param ator      identificação do ator (Cidadão ou Servidor) + IP
 * @param deps      dependências injetáveis (testes)
 */
export async function criarProcesso(
  cidadaoId: string,
  dto: CriarProcessoInput,
  ator: Ator,
  deps?: ProcessosServiceDeps,
): Promise<CriarProcessoResultado> {
  const d = resolveDeps(deps);

  // 1. Tipo_de_Processo: precisa existir, estar ativo e pertencer a uma
  //    Categoria ativa (Req. 4.1, 4.2, 4.12).
  const tipoProcesso = await d.prisma.tipoProcesso.findUnique({
    where: { id: dto.tipoProcessoId },
    include: {
      categoria: true,
      fluxo: { include: { etapas: { orderBy: { ordem: 'asc' } } } },
    },
  });
  if (!tipoProcesso || !tipoProcesso.ativo) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'Tipo de processo indisponível',
      'tipoProcessoId',
    );
  }
  if (tipoProcesso.categoria?.ativa === false) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'Categoria indisponível para abertura de novos processos',
      'tipoProcessoId',
    );
  }
  // Invariante do schema: `Processo.fluxoVersaoId` é obrigatório — um Tipo de
  // Processo sem Fluxo configurado (ou com Fluxo sem Etapas, o que o próprio
  // CRUD de Fluxos já impede — Req. 15.6) não pode originar um Processo válido.
  const etapas = tipoProcesso.fluxo?.etapas ?? [];
  if (!tipoProcesso.fluxoId || etapas.length === 0) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'Tipo de processo sem fluxo configurado',
      'tipoProcessoId',
    );
  }

  // 2. Unidade: precisa existir e estar ativa (Req. 4.3, 4.13).
  const unidade = await d.prisma.unidade.findUnique({ where: { id: dto.unidadeId } });
  if (!unidade || !unidade.ativa) {
    throw badRequest(ErrorCodes.VALIDATION_ERROR, 'Unidade indisponível', 'unidadeId');
  }

  // 3. Formulário_Dinâmico: todo campo obrigatório precisa de uma resposta
  //    não vazia — caso contrário, lista os rótulos pendentes (Req. 4.6).
  const formulario = await d.obterFormulario(dto.tipoProcessoId, dto.unidadeId);
  const respostasPorCampo = new Map(dto.respostas.map((r) => [r.campoId, r.valor]));
  const camposFaltantes = (formulario?.campos ?? []).filter(
    (campo: { id: string; obrigatorio: boolean }) =>
      campo.obrigatorio && valorVazio(respostasPorCampo.get(campo.id)),
  );
  if (camposFaltantes.length > 0) {
    throw badRequest(
      ErrorCodes.CAMPO_OBRIGATORIO,
      `Preencha os campos obrigatórios pendentes: ${camposFaltantes
        .map((campo: { rotulo: string }) => campo.rotulo)
        .join(', ')}`,
      'respostas',
    );
  }

  // 4. Protocolo único `[PREFIXO-]AAAA-NNNNN` (Req. 4.8, 4.8a-c) + prazo final
  //    a partir do prazo total do Tipo_de_Processo em dias úteis.
  //    O prefixo é resolvido pela precedência Unidade → Categoria → sem prefixo
  //    (decisão F). Sem prefixo configurado, o formato permanece `AAAA-NNNNN`,
  //    preservando a retrocompatibilidade da criação pelo Cidadão.
  const prefixo = resolverPrefixo(unidade, tipoProcesso.categoria);
  const protocolo = await gerarProtocolo(d.redis, prefixo);
  const abertoEm = new Date();
  const prazoFinal = calcularPrazoFinal(abertoEm, tipoProcesso.prazoTotalDiasUteis);

  // 5. A primeira Etapa do Fluxo vigente define onde o Processo nasce.
  const etapaAtualId = etapas[0].id;
  const fluxoVersaoId = tipoProcesso.fluxoId;

  // 6. Criação atômica: Processo + RespostaFormulario[] + vínculo de
  //    Documentos já enviados. Qualquer falha aqui PROPAGA (não é engolida)
  //    para que o Cidadão possa tentar novamente sem perder os dados
  //    preenchidos no wizard (Req. 4.11).
  const processo = await d.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const criado = await tx.processo.create({
      data: {
        protocolo,
        status: StatusProcesso.ABERTO,
        prioridade: 0,
        cidadaoId,
        tipoProcessoId: dto.tipoProcessoId,
        unidadeId: dto.unidadeId,
        etapaAtualId,
        fluxoVersaoId,
        abertoEm,
        prazoFinal,
      },
    });

    if (dto.respostas.length > 0) {
      await tx.respostaFormulario.createMany({
        data: dto.respostas.map((resposta) => ({
          processoId: criado.id,
          campoId: resposta.campoId,
          valor: normalizarValor(resposta.valor),
        })),
      });
    }

    if (dto.documentoIds && dto.documentoIds.length > 0) {
      await tx.documento.updateMany({
        where: { id: { in: dto.documentoIds } },
        data: { processoId: criado.id },
      });
    }

    return criado;
  });

  // 7. Pós-commit: notificação e agendamento de atribuição são
  //    "fire-and-forget" — uma falha aqui NUNCA deve impedir a resposta do
  //    Protocolo ao Cidadão nem ser confundida com falha da criação em si.
  fireAndForget(
    () =>
      d.notificar({
        tipo: 'painel',
        destinatario: { cidadaoId },
        tipoEvento: TipoEvento.CRIACAO_PROCESSO,
        conteudo: protocolo,
        processoId: processo.id,
      }),
    'notificar_criacao_processo_falhou',
  );

  fireAndForget(
    () => d.agendarAtribuicao(processo.id, dto.unidadeId),
    'agendar_atribuicao_falhou',
  );

  // A auditoria identifica QUEM abriu o Processo. Quando um Servidor abre em
  // nome do Cidadão (Req. 23.6), o ator é 'servidor' (com o Cidadão vinculado
  // registrado em `atorCidadaoId`); caso contrário, o próprio Cidadão (Req. 4).
  const auditoriaAtor: RegistrarAuditoriaDto = ator.servidorId
    ? {
        ator: 'servidor',
        atorServidorId: ator.servidorId,
        atorCidadaoId: cidadaoId,
        enderecoIp: ator.enderecoIp,
        tipoAcao: 'abrir_processo_admin',
        modulo: MODULO,
        objetoId: processo.id,
        tipoObjeto: 'Processo',
        valorPosterior: {
          protocolo,
          status: processo.status,
          tipoProcessoId: dto.tipoProcessoId,
          unidadeId: dto.unidadeId,
          cidadaoId,
        },
      }
    : {
        ator: 'cidadao',
        atorCidadaoId: cidadaoId,
        enderecoIp: ator.enderecoIp,
        tipoAcao: 'criar_processo',
        modulo: MODULO,
        objetoId: processo.id,
        tipoObjeto: 'Processo',
        valorPosterior: {
          protocolo,
          status: processo.status,
          tipoProcessoId: dto.tipoProcessoId,
          unidadeId: dto.unidadeId,
        },
      };
  await d.auditar(auditoriaAtor);

  return { protocolo, processoId: processo.id };
}

// ---------------------------------------------------------------------------
// Abertura de Processo pelo Servidor no Painel Administrativo (Req. 23)
// ---------------------------------------------------------------------------

/** Ator Servidor que abre um Processo em nome de um Cidadão (Req. 23). */
export interface AtorServidor {
  servidorId: string;
  enderecoIp: string;
}

/**
 * Abre um Processo em nome de um Cidadão a partir do Painel_Administrativo
 * (Req. 23). REUTILIZA integralmente o motor `criarProcesso` — mesmas
 * validações de Tipo/Unidade/Formulário (Req. 4), mesma geração de Protocolo
 * com prefixo (Req. 23.5) e mesmo cálculo de prazo. A única diferença é que o
 * ator registrado na Auditoria é o Servidor, com o Cidadão vinculado ao
 * Processo (Req. 23.6). Falhas são propagadas para preservar os dados e
 * permitir nova tentativa (Req. 23.7).
 *
 * @param cidadaoId id do Cidadão previamente localizado (Req. 23.2)
 * @param dto       payload validado por `criarProcessoSchema`
 * @param ator      identificação do Servidor autenticado + IP
 * @param deps      dependências injetáveis (testes)
 */
export async function abrirProcessoPeloServidor(
  cidadaoId: string,
  dto: CriarProcessoInput,
  ator: AtorServidor,
  deps?: ProcessosServiceDeps,
): Promise<CriarProcessoResultado> {
  const d = resolveDeps(deps);

  // O Cidadão precisa existir (foi localizado por CPF na etapa anterior —
  // Req. 23.2). Valida antes de acionar o motor para retornar um erro claro em
  // vez de estourar a restrição de chave estrangeira do banco.
  const cidadao = await d.prisma.cidadao.findUnique({ where: { id: cidadaoId } });
  if (!cidadao) {
    throw badRequest(ErrorCodes.VALIDATION_ERROR, 'Cidadão não encontrado', 'cidadaoId');
  }

  return criarProcesso(
    cidadaoId,
    dto,
    { cidadaoId, enderecoIp: ator.enderecoIp, servidorId: ator.servidorId },
    d,
  );
}

// ---------------------------------------------------------------------------
// Listagem de Processos do Cidadão (Req. 3.7, 3.8)
// ---------------------------------------------------------------------------

/** Linha resumida de Processo exibida no painel/histórico do Cidadão. */
export interface ProcessoResumoCidadao {
  protocolo: string;
  categoria: string | null;
  tipoProcesso: string;
  abertoEm: Date;
  status: string;
  prazoFinal: Date;
}

/** Formato crú retornado pelo Prisma para a projeção usada em `listarDoCidadao`. */
interface ProcessoCidadaoRow {
  protocolo: string;
  abertoEm: Date;
  status: string;
  prazoFinal: Date;
  tipoProcesso: { nome: string; categoria: { nome: string } | null } | null;
}

/**
 * Lista os Processos do Cidadão autenticado, com filtros opcionais por status,
 * Categoria e período de abertura (`periodoInicio`/`periodoFim`, ISO date).
 * Ordenado por data de abertura decrescente (mais recentes primeiro).
 */
export async function listarDoCidadao(
  cidadaoId: string,
  filtros: FiltroProcessoCidadaoInput = {},
  deps?: ProcessosServiceDeps,
): Promise<ProcessoResumoCidadao[]> {
  const d = resolveDeps(deps);

  const where: Prisma.ProcessoWhereInput = { cidadaoId };
  if (filtros.status) {
    where.status = filtros.status;
  }
  if (filtros.categoriaId) {
    where.tipoProcesso = { categoriaId: filtros.categoriaId };
  }
  if (filtros.periodoInicio || filtros.periodoFim) {
    where.abertoEm = {
      ...(filtros.periodoInicio ? { gte: new Date(filtros.periodoInicio) } : {}),
      ...(filtros.periodoFim ? { lte: new Date(filtros.periodoFim) } : {}),
    };
  }

  const processos = await d.prisma.processo.findMany({
    where,
    select: {
      protocolo: true,
      abertoEm: true,
      status: true,
      prazoFinal: true,
      tipoProcesso: { select: { nome: true, categoria: { select: { nome: true } } } },
    },
    orderBy: { abertoEm: 'desc' },
  });

  return (processos as ProcessoCidadaoRow[]).map((p) => ({
    protocolo: p.protocolo,
    categoria: p.tipoProcesso?.categoria?.nome ?? null,
    tipoProcesso: p.tipoProcesso?.nome ?? '',
    abertoEm: p.abertoEm,
    status: p.status,
    prazoFinal: p.prazoFinal,
  }));
}
