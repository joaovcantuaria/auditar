import { createRequire } from 'node:module';
import type { PrismaClient, Mensagem } from '@prisma/client';
import { ErrorCodes, StatusProcesso, TipoEvento } from '@auditar/shared';
import { badRequest, notFound } from '../../utils/index.js';
import type { NotificacaoJob } from '../../jobs/types.js';
import { registrar as defaultRegistrar } from '../auditoria/index.js';
import type { RegistrarAuditoriaDto } from '../auditoria/index.js';

/**
 * Serviço do canal de mensagens público (Cidadão ↔ Servidor) dentro de um
 * Processo (Task 8.1).
 *
 * Cobre o ENVIO de mensagens em ambas as direções:
 *  - `enviarMensagemCidadao` — o Cidadão escreve ao Servidor responsável. A
 *    notificação ao Servidor é "fire-and-forget": uma falha ao notificar
 *    NUNCA desfaz a mensagem já persistida nem é propagada ao chamador — o
 *    texto do Cidadão já foi salvo com sucesso, então nunca é perdido
 *    (Req 5.6, 5.7).
 *  - `enviarMensagemServidor` — o Servidor escreve ao Cidadão. Aqui a
 *    notificação É aguardada (não fire-and-forget), porque o Servidor precisa
 *    saber, na própria resposta, se ela foi entregue — em particular quando o
 *    Cidadão não possui conta ativa (Req 13.7), caso em que a mensagem é
 *    registrada normalmente mas `notificacaoEntregue: false`.
 *
 * Em ambas as direções, o envio é bloqueado quando o Processo está em um
 * status terminal (`STATUS_ENCERRADOS` — Req 13.8).
 *
 * A LISTAGEM (GET) do canal público já é responsabilidade da tarefa 7.3
 * (`processos.detalhe.service.ts#obterMensagens`, Portal do Cidadão) e do
 * respectivo endpoint administrativo — este módulo trata exclusivamente do
 * envio (POST), para não duplicar aquele trabalho.
 *
 * Requisitos: 5.5, 5.6, 5.7, 13.1, 13.3, 13.7, 13.8
 */

const MODULO = 'processos';

const MENSAGEM_PROCESSO_NAO_ENCONTRADO = 'Processo não encontrado';
const MENSAGEM_PROCESSO_ENCERRADO =
  'Processo encerrado; não é possível enviar novas mensagens';

/**
 * Status TERMINAIS de um Processo — enquanto o Processo estiver em um destes
 * status, o envio de novas mensagens no canal público é bloqueado (Req 13.8).
 * Mesmo conjunto usado em `cidadaos.service.ts`, `categorias.service.ts` e
 * `tipos.service.ts`.
 */
export const STATUS_ENCERRADOS: readonly string[] = [
  StatusProcesso.FINALIZADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.APROVADO,
];

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa as instâncias reais por padrão)
// ---------------------------------------------------------------------------

/** Enfileiramento de notificação — mesmo payload da `notificacao-queue`. */
export type NotificarMensagemFn = (payload: NotificacaoJob) => Promise<unknown>;

/** Dependências injetáveis do serviço. */
export interface MensagensPublicoDeps {
  prisma: Pick<PrismaClient, 'processo' | 'mensagem'>;
  notificar: NotificarMensagemFn;
  /**
   * Registro em Módulo_de_Auditoria (Req 13.4 — a resposta do Cidadão deve
   * ser registrada com data, hora e identificação do Cidadão). Opcional na
   * injeção: quando ausente, usa o `registrar` real (nunca lança — Req 17.8).
   */
  auditar: (dto: RegistrarAuditoriaDto) => Promise<void>;
}

let cachedPrisma: MensagensPublicoDeps['prisma'] | undefined;
let cachedNotificar: NotificarMensagemFn | undefined;

/**
 * Resolve o Prisma real preguiçosamente (lazy). Só é chamada quando o
 * chamador NÃO injeta `deps.prisma` — importar este módulo não deve carregar
 * o `@prisma/client`.
 */
function getRealPrisma(): MensagensPublicoDeps['prisma'] {
  if (!cachedPrisma) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };
    cachedPrisma = prisma as unknown as MensagensPublicoDeps['prisma'];
  }
  return cachedPrisma;
}

/**
 * Resolve o enfileiramento de notificação real preguiçosamente (lazy). Só é
 * chamada quando o chamador NÃO injeta `deps.notificar` — importar este
 * módulo não deve abrir conexão com o Redis/BullMQ.
 */
function getRealNotificar(): NotificarMensagemFn {
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

function resolveDeps(deps?: Partial<MensagensPublicoDeps>): MensagensPublicoDeps {
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
 * (mas nunca propagando) uma eventual falha. Usado para a notificação
 * disparada pelo envio do Cidadão, que jamais deve bloquear ou derrubar o
 * envio da mensagem (Req 5.6, 5.7 — o texto do Cidadão nunca é perdido).
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
// Envio pelo Cidadão (Req 5.5, 5.6, 5.7, 13.1, 13.8)
// ---------------------------------------------------------------------------

/** Formato crú do Processo carregado para validar o envio pelo Cidadão. */
interface ProcessoParaEnvioCidadao {
  cidadaoId: string;
  status: string;
  servidorResponsavelId: string | null;
}

/**
 * Registra uma mensagem do Cidadão ao Servidor responsável pelo Processo, no
 * canal público (Req 5.5, 5.6, 13.1).
 *
 * 1. Verifica que o Processo existe e pertence ao Cidadão informado — caso
 *    contrário, 404 (nunca 403, mesmo padrão de `processos.detalhe.service.ts`
 *    e `documentos.service.ts`).
 * 2. Bloqueia o envio quando o Processo está em um status terminal (Req 13.8).
 * 3. Persiste a Mensagem.
 * 4. Registra a resposta no Módulo_de_Auditoria com a identificação do
 *    Cidadão (Req 13.4). `registrar` nunca lança (Req 17.8), então é
 *    aguardado diretamente, sem try/catch adicional — a função ainda retorna
 *    normalmente mesmo que esse registro leve algum tempo.
 * 5. Notifica o Servidor responsável (quando houver um atribuído) de forma
 *    "fire-and-forget": uma falha na notificação NUNCA desfaz a mensagem já
 *    salva nem é propagada — o texto do Cidadão já foi persistido com
 *    sucesso (Req 5.6, 5.7).
 *
 * @throws {AppError} 404 — Processo inexistente ou não pertencente ao Cidadão.
 * @throws {AppError} 400 `PROCESSO_ENCERRADO` — Processo em status terminal (Req 13.8).
 */
export async function enviarMensagemCidadao(
  processoId: string,
  cidadaoId: string,
  conteudo: string,
  deps?: Partial<MensagensPublicoDeps>,
): Promise<Mensagem> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { cidadaoId: true, status: true, servidorResponsavelId: true },
  })) as ProcessoParaEnvioCidadao | null;

  if (!processo || processo.cidadaoId !== cidadaoId) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  if (STATUS_ENCERRADOS.includes(processo.status)) {
    throw badRequest(ErrorCodes.PROCESSO_ENCERRADO, MENSAGEM_PROCESSO_ENCERRADO);
  }

  const mensagem = await d.prisma.mensagem.create({
    data: {
      processoId,
      canal: 'publico',
      conteudo,
      remetenteCidadaoId: cidadaoId,
      enviadaEm: new Date(),
    },
  });

  // Req 13.4: a resposta do Cidadão deve ser registrada com data, hora e
  // identificação do Cidadão no Módulo_de_Auditoria. `registrar` nunca lança
  // (Req 17.8), então é aguardado diretamente — sem IP disponível nesta
  // camada, usa-se o mesmo fallback "desconhecido" já adotado em
  // `documentos.service.ts#gerarDownloadUrl`.
  await d.auditar({
    tipoAcao: 'enviar_mensagem_cidadao',
    modulo: MODULO,
    objetoId: processoId,
    tipoObjeto: 'Processo',
    ator: 'cidadao',
    atorCidadaoId: cidadaoId,
    enderecoIp: 'desconhecido',
    valorPosterior: { conteudo },
  });

  const servidorResponsavelId = processo.servidorResponsavelId;
  if (servidorResponsavelId) {
    fireAndForget(
      () =>
        d.notificar({
          tipo: 'painel',
          destinatario: { servidorId: servidorResponsavelId },
          tipoEvento: TipoEvento.NOVA_MENSAGEM,
          conteudo,
          processoId,
        }),
      'notificar_nova_mensagem_cidadao_falhou',
    );
  }

  return mensagem;
}

// ---------------------------------------------------------------------------
// Envio pelo Servidor (Req 13.1, 13.3, 13.7, 13.8)
// ---------------------------------------------------------------------------

/** Formato crú do Processo carregado para validar o envio pelo Servidor. */
interface ProcessoParaEnvioServidor {
  cidadaoId: string;
  status: string;
  cidadao: { ativo: boolean } | null;
}

/** Resultado do envio de uma mensagem pelo Servidor ao Cidadão. */
export interface EnviarMensagemServidorResultado {
  mensagem: Mensagem;
  /** false quando o Cidadão não possui conta ativa ou a notificação falhou (Req 13.7). */
  notificacaoEntregue: boolean;
}

/**
 * Registra uma mensagem do Servidor ao Cidadão do Processo, no canal público
 * (Req 13.1, 13.3).
 *
 * 1. Carrega o Processo (404 quando inexistente).
 * 2. Bloqueia o envio quando o Processo está em um status terminal (Req 13.8).
 * 3. Persiste a Mensagem.
 * 4. Tenta notificar o Cidadão — mas SÓ quando ele possui conta ativa. Ao
 *    contrário do envio pelo Cidadão, esta notificação é AGUARDADA (não
 *    fire-and-forget): o Servidor precisa saber, na própria resposta, se a
 *    notificação foi entregue. Quando o Cidadão não tem conta ativa (Req 13.7)
 *    ou a notificação falha por qualquer outro motivo, a mensagem permanece
 *    registrada e a função retorna `notificacaoEntregue: false` — o envio
 *    NUNCA lança erro por causa da notificação.
 *
 * @throws {AppError} 404 — Processo inexistente.
 * @throws {AppError} 400 `PROCESSO_ENCERRADO` — Processo em status terminal (Req 13.8).
 */
export async function enviarMensagemServidor(
  processoId: string,
  servidorId: string,
  conteudo: string,
  deps?: Partial<MensagensPublicoDeps>,
): Promise<EnviarMensagemServidorResultado> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { cidadaoId: true, status: true, cidadao: { select: { ativo: true } } },
  })) as ProcessoParaEnvioServidor | null;

  if (!processo) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  if (STATUS_ENCERRADOS.includes(processo.status)) {
    throw badRequest(ErrorCodes.PROCESSO_ENCERRADO, MENSAGEM_PROCESSO_ENCERRADO);
  }

  const mensagem = await d.prisma.mensagem.create({
    data: {
      processoId,
      canal: 'publico',
      conteudo,
      remetenteServidorId: servidorId,
      enviadaEm: new Date(),
    },
  });

  // Cidadão sem conta ativa (Req 13.7): a mensagem já está registrada, mas não
  // há para onde notificar — nem tenta, apenas sinaliza a falha ao Servidor.
  const cidadaoAtivo = processo.cidadao?.ativo ?? true;

  let notificacaoEntregue = false;
  if (cidadaoAtivo) {
    try {
      await d.notificar({
        tipo: 'painel',
        destinatario: { cidadaoId: processo.cidadaoId },
        tipoEvento: TipoEvento.NOVA_MENSAGEM,
        conteudo,
        processoId,
      });
      notificacaoEntregue = true;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'warn',
          scope: MODULO,
          event: 'notificar_nova_mensagem_servidor_falhou',
          processoId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return { mensagem, notificacaoEntregue };
}
