import { createRequire } from 'node:module';
import type { PrismaClient, Mensagem } from '@prisma/client';
import { ErrorCodes, TipoEvento } from '@auditar/shared';
import { badRequest, notFound } from '../../utils/index.js';
import type { NotificacaoJob } from '../../jobs/types.js';
import { validarArquivo } from './documentos.service.js';
import { STATUS_ENCERRADOS } from './mensagens.publico.service.js';
import { registrar as defaultRegistrar } from '../auditoria/index.js';
import type { RegistrarAuditoriaDto } from '../auditoria/index.js';
import type { EnviarMensagemInternaInput } from './mensagens.interno.schema.js';

/**
 * Serviço do canal de mensagens internas (Servidor ↔ Servidor) dentro de um
 * Processo (Task 8.2). Estas mensagens NUNCA são visíveis ao Cidadão — o
 * canal público (Cidadão ↔ Servidor) é tratado por `mensagens.publico.service.ts`
 * (tarefa 8.1) e a listagem correspondente por `processos.detalhe.service.ts`
 * (tarefa 7.3), ambos filtrando exclusivamente `canal: 'publico'`.
 *
 * ## Anexos — reuso do fluxo de upload de Documentos (Req 13.5)
 *
 * Não existe (nem é necessário criar) um endpoint de upload dedicado para
 * anexos de mensagem interna. O frontend deve reutilizar o endpoint JÁ
 * EXISTENTE de presigned URL de Documentos (`POST
 * /api/v1/admin/processos/:id/documentos/upload-url`, tarefa 7.2,
 * `documentos.service.ts#gerarUploadUrl`) para:
 *
 *   1. Obter uma presigned URL do MinIO + o `caminhoStorage` resultante;
 *   2. Fazer o upload do binário diretamente ao MinIO usando essa URL;
 *   3. Enviar os metadados do arquivo (`nomeOriginal`, `mimeType`,
 *      `tamanhoBytes`) junto do `caminhoStorage` retornado, no campo `anexo`
 *      do corpo de `enviarInterna` (ver `mensagens.interno.schema.ts`).
 *
 * O passo de CONFIRMAÇÃO do fluxo de Documentos (`POST
 * .../documentos`, que persiste uma linha `Documento`) NUNCA deve ser chamado
 * para anexos de mensagem — um anexo de mensagem interna não é um `Documento`
 * do Processo, ele vive exclusivamente em `Mensagem.caminhoAnexo`. Chamar a
 * confirmação criaria uma linha `Documento` "fantasma", sem relação com a
 * mensagem, na aba Documentos do Processo.
 *
 * A validação de formato/tamanho do anexo reaproveita `validarArquivo`
 * (`documentos.service.ts`), sem duplicar as regras de formato/tamanho.
 *
 * Requisitos: 13.2, 13.4, 13.5, 13.6, 13.8
 */

const MODULO = 'processos';

const MENSAGEM_PROCESSO_NAO_ENCONTRADO = 'Processo não encontrado';
const MENSAGEM_PROCESSO_ENCERRADO =
  'Processo encerrado; não é possível enviar novas mensagens';

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa as instâncias reais por padrão)
// ---------------------------------------------------------------------------

/**
 * Enfileiramento de notificação — mesmo payload da `notificacao-queue`.
 * Nomeado distintamente de `NotificarMensagemFn` (mensagens.publico.service.ts)
 * para evitar ambiguidade de reexportação no barrel (`export *` de ambos os
 * módulos) — os dois tipos têm formato idêntico, apenas nomes diferentes.
 */
export type NotificarMensagemInternaFn = (payload: NotificacaoJob) => Promise<unknown>;

/** Dependências injetáveis do serviço. */
export interface MensagensInternoDeps {
  prisma: Pick<PrismaClient, 'processo' | 'mensagem'>;
  notificar: NotificarMensagemInternaFn;
  auditar: (dto: RegistrarAuditoriaDto) => Promise<void>;
}

let cachedPrisma: MensagensInternoDeps['prisma'] | undefined;
let cachedNotificar: NotificarMensagemInternaFn | undefined;

/**
 * Resolve o Prisma real preguiçosamente (lazy). Só é chamada quando o
 * chamador NÃO injeta `deps.prisma` — importar este módulo não deve carregar
 * o `@prisma/client`.
 */
function getRealPrisma(): MensagensInternoDeps['prisma'] {
  if (!cachedPrisma) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };
    cachedPrisma = prisma as unknown as MensagensInternoDeps['prisma'];
  }
  return cachedPrisma;
}

/**
 * Resolve o enfileiramento de notificação real preguiçosamente (lazy). Só é
 * chamada quando o chamador NÃO injeta `deps.notificar` — importar este
 * módulo não deve abrir conexão com o Redis/BullMQ.
 */
function getRealNotificar(): NotificarMensagemInternaFn {
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

function resolveDeps(deps?: Partial<MensagensInternoDeps>): MensagensInternoDeps {
  return {
    prisma: deps?.prisma ?? getRealPrisma(),
    notificar: deps?.notificar ?? getRealNotificar(),
    auditar: deps?.auditar ?? defaultRegistrar,
  };
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Executa uma operação assíncrona sem aguardar seu resultado, registrando
 * (mas nunca propagando) uma eventual falha. Usado para a notificação ao
 * Servidor destinatário, que jamais deve bloquear ou derrubar o envio da
 * mensagem já persistida (mesmo padrão de `mensagens.publico.service.ts`).
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

// ---------------------------------------------------------------------------
// Envio (Req 13.2, 13.5, 13.6, 13.8)
// ---------------------------------------------------------------------------

/** Formato crú do Processo carregado para validar o envio interno. */
interface ProcessoParaEnvioInterno {
  status: string;
}

/**
 * Registra uma mensagem interna (Servidor ↔ Servidor) no Processo, invisível
 * ao Cidadão (Req 13.2).
 *
 * 1. Verifica que o Processo existe — 404 quando não.
 * 2. Bloqueia o envio quando o Processo está em um status terminal, tanto no
 *    canal público quanto no interno (Req 13.8).
 * 3. Quando há anexo, valida formato/tamanho ANTES de criar a mensagem
 *    (`validarArquivo`) — uma falha de validação impede o envio da mensagem
 *    por completo, o anexo é rejeitado antes de qualquer persistência
 *    (Req 13.5).
 * 4. Persiste a Mensagem no canal `interno`.
 * 5. Registra a ação no Módulo_de_Auditoria (Req 13.6 exige explicitamente o
 *    registro em auditoria para mensagens internas direcionadas). `registrar`
 *    nunca lança, então é apenas aguardado diretamente.
 * 6. Quando a mensagem é direcionada a um Servidor específico
 *    (`destinatarioServidorId`), notifica esse Servidor de forma
 *    "fire-and-forget" (Req 13.6). Uma anotação interna geral — sem
 *    destinatário específico — não dispara notificação, pois o requisito
 *    trata exclusivamente do caso direcionado.
 *
 * @throws {AppError} 404 — Processo inexistente.
 * @throws {AppError} 400 `PROCESSO_ENCERRADO` — Processo em status terminal (Req 13.8).
 * @throws {AppError} 400 `ARQUIVO_FORMATO_INVALIDO` / `ARQUIVO_MUITO_GRANDE` — anexo inválido (Req 13.5).
 */
export async function enviarInterna(
  processoId: string,
  remetenteServidorId: string,
  dto: EnviarMensagemInternaInput,
  deps?: Partial<MensagensInternoDeps>,
): Promise<Mensagem> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { status: true },
  })) as ProcessoParaEnvioInterno | null;

  if (!processo) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  if (STATUS_ENCERRADOS.includes(processo.status)) {
    throw badRequest(ErrorCodes.PROCESSO_ENCERRADO, MENSAGEM_PROCESSO_ENCERRADO);
  }

  if (dto.anexo) {
    // Lança AppError (400) e propaga — a mensagem NUNCA é criada quando o
    // anexo é inválido (Req 13.5: rejeitar antes do envio da mensagem).
    validarArquivo(dto.anexo);
  }

  const mensagem = await d.prisma.mensagem.create({
    data: {
      processoId,
      canal: 'interno',
      conteudo: dto.conteudo,
      remetenteServidorId,
      destinatarioServidorId: dto.destinatarioServidorId ?? null,
      caminhoAnexo: dto.anexo?.caminhoStorage ?? null,
      enviadaEm: new Date(),
    },
  });

  // Req 13.6 exige explicitamente o registro em Módulo_de_Auditoria para
  // mensagens internas. `registrar` nunca lança (Req 17.8), então é aguardado
  // diretamente, sem try/catch adicional. Não há IP de origem disponível
  // nesta camada — o controller espelha `mensagens.publico.controller.ts`
  // (que não computa IP algum), então usamos o mesmo fallback "desconhecido"
  // já adotado em `documentos.service.ts#gerarDownloadUrl`.
  await d.auditar({
    tipoAcao: 'enviar_mensagem_interna',
    modulo: MODULO,
    objetoId: processoId,
    tipoObjeto: 'Processo',
    ator: 'servidor',
    atorServidorId: remetenteServidorId,
    enderecoIp: 'desconhecido',
    valorPosterior: { destinatarioServidorId: dto.destinatarioServidorId, temAnexo: !!dto.anexo },
  });

  // Notifica apenas quando a mensagem é direcionada a um Servidor específico
  // (Req 13.6) — uma observação interna geral não notifica ninguém.
  const destinatarioServidorId = dto.destinatarioServidorId;
  if (destinatarioServidorId) {
    fireAndForget(
      () =>
        d.notificar({
          tipo: 'painel',
          destinatario: { servidorId: destinatarioServidorId },
          tipoEvento: TipoEvento.NOVA_MENSAGEM,
          conteudo: dto.conteudo,
          processoId,
        }),
      'notificar_mensagem_interna_falhou',
    );
  }

  return mensagem;
}

// ---------------------------------------------------------------------------
// Listagem (Req 13.2)
// ---------------------------------------------------------------------------

/** Mensagem interna exibida ao Servidor, em ordem cronológica crescente. */
export interface MensagemInternaResumo {
  id: string;
  conteudo: string;
  remetenteServidor: { nome: string } | null;
  destinatarioServidorId: string | null;
  caminhoAnexo: string | null;
  enviadaEm: Date;
}

/**
 * Lista as mensagens do canal interno (Servidor ↔ Servidor) de um Processo,
 * em ordem cronológica crescente (Req 13.2). Filtra exclusivamente
 * `canal: 'interno'` — jamais expõe mensagens do canal público por este
 * caminho (nem o inverso: `processos.detalhe.service.ts#obterMensagens`
 * filtra exclusivamente `canal: 'publico'` e permanece intocado).
 *
 * Este endpoint é exclusivo de Servidor (RBAC já aplicado na camada de rota)
 * — não há checagem adicional de ownership aqui, mesmo padrão de
 * `processos.admin.service.ts`.
 *
 * @throws {AppError} 404 — Processo inexistente.
 */
export async function listarInternas(
  processoId: string,
  deps?: Partial<MensagensInternoDeps>,
): Promise<MensagemInternaResumo[]> {
  const d = resolveDeps(deps);

  const processo = await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true },
  });

  if (!processo) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  const mensagens = (await d.prisma.mensagem.findMany({
    where: { processoId, canal: 'interno' },
    orderBy: { enviadaEm: 'asc' },
    select: {
      id: true,
      conteudo: true,
      remetenteServidor: { select: { nome: true } },
      destinatarioServidorId: true,
      caminhoAnexo: true,
      enviadaEm: true,
    },
  })) as MensagemInternaResumo[];

  return mensagens;
}
