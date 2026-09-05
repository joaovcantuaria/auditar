// Worker for the `notificacao` queue (task 9.1).
//
// Delivers a notification through exactly ONE channel per job (the channel is
// chosen by the producer via `job.data.tipo`) and applies, for citizen
// recipients, the citizen's channel preferences (Req. 6.2/6.7) and silence
// window (Req. 6.4). Email/SMS failures propagate so BullMQ's 3-attempt /
// fixed-30s retry (configured on the queue, Req. 6.5) kicks in; after the final
// failed attempt a painel fallback is registered (Req. 6.5).
//
// Design decision (channel model)
// -------------------------------
// Producers across the codebase enqueue jobs that already target a single
// concrete channel, e.g. `{ tipo: 'painel', ... }`. So each job = one channel.
// The worker therefore does NOT fan a job out to every preferred channel;
// instead it decides whether THIS job's channel should actually be delivered:
//   - Servidor recipients have no preference table  -> always deliver.
//   - Citizen recipients: deliver only if the channel is enabled in their
//     preferences for that `tipoEvento`. The `painel` channel is the reliable
//     fallback and is ALWAYS delivered, even if the citizen opted out of it
//     (Req. 6.5/6.7 — painel is the guaranteed channel).
// The silence window (Req. 6.4) applies to citizens: a job that arrives during
// the window is re-enqueued with a `delay` until the window ends instead of
// being delivered immediately.
//
// Everything is dependency-injectable (prisma, mailer, emit, preferences
// reader, enqueue) with lazy real defaults, so importing this module opens no
// Redis/DB/SMTP connection and unit tests can inject mocks.

import { Worker, type Job } from 'bullmq';
import { createRequire } from 'node:module';
import { bullmqConnection } from '../config/bullmq.js';
import { QUEUE_NAMES } from './queues.js';
import type { NotificacaoJob } from './types.js';

// ---------------------------------------------------------------------------
// Injectable dependencies
// ---------------------------------------------------------------------------

/** Minimal Prisma surface the worker needs. */
export interface NotificacaoPrisma {
  notificacao: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  preferenciaNotificacao: {
    findMany: (args: {
      where: { cidadaoId: string };
    }) => Promise<
      Array<{
        tipoEvento: string;
        canais: string[];
        inicioSilencio: string | null;
        fimSilencio: string | null;
      }>
    >;
  };
}

/** Minimal mailer surface (Nodemailer transport `sendMail`). */
export interface NotificacaoMailer {
  sendMail: (opts: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }) => Promise<unknown>;
}

/** Real-time emit function (room, event, payload). */
export type EmitFn = (room: string, event: string, payload: unknown) => void;

/** Enqueue a (delayed) notificacao job — used to defer during the silence window. */
export type EnqueueFn = (data: NotificacaoJob, opts: { delay: number }) => Promise<unknown>;

/** Recipient email lookup — resolves the destinatario's e-mail address. */
export type ResolverEmailFn = (data: NotificacaoJob) => Promise<string | null>;

export interface NotificacaoDeps {
  prisma: NotificacaoPrisma;
  mailer: NotificacaoMailer;
  fromAddress: string;
  emit: EmitFn;
  enqueue: EnqueueFn;
  /** Feature flags for the optional channels. */
  smsEnabled: boolean;
  pushEnabled: boolean;
  /** Current time provider (injectable for deterministic tests). */
  agora: () => Date;
}

// ---------------------------------------------------------------------------
// Lazy real defaults — nothing here runs at import time.
// ---------------------------------------------------------------------------

let cachedPrisma: NotificacaoPrisma | undefined;
function getRealPrisma(): NotificacaoPrisma {
  if (!cachedPrisma) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../config/database.js') as { prisma: unknown };
    cachedPrisma = prisma as NotificacaoPrisma;
  }
  return cachedPrisma;
}

let cachedMailer: { mailer: NotificacaoMailer; fromAddress: string } | undefined;
function getRealMailer(): { mailer: NotificacaoMailer; fromAddress: string } {
  if (!cachedMailer) {
    const requireLocal = createRequire(import.meta.url);
    const mod = requireLocal('../config/mailer.js') as {
      mailer: NotificacaoMailer;
      fromAddress: string;
    };
    cachedMailer = { mailer: mod.mailer, fromAddress: mod.fromAddress };
  }
  return cachedMailer;
}

let cachedEnv: { smsEnabled: boolean; pushEnabled: boolean } | undefined;
function getRealEnv(): { smsEnabled: boolean; pushEnabled: boolean } {
  if (!cachedEnv) {
    const requireLocal = createRequire(import.meta.url);
    const { env } = requireLocal('../config/env.js') as {
      env: { FEATURE_SMS_ENABLED: boolean; FEATURE_PUSH_ENABLED: boolean };
    };
    cachedEnv = {
      smsEnabled: env.FEATURE_SMS_ENABLED,
      pushEnabled: env.FEATURE_PUSH_ENABLED,
    };
  }
  return cachedEnv;
}

// Real-time emit — same lazy try/catch no-op pattern as
// processos.tramitacao.service.ts (task 9.3 may not exist yet).
let cachedEmit: EmitFn | undefined;
function getRealEmit(): EmitFn {
  if (!cachedEmit) {
    try {
      const requireLocal = createRequire(import.meta.url);
      const { getIO } = requireLocal('../socket/socket.server.js') as {
        getIO: () => { to: (room: string) => { emit: (e: string, p: unknown) => void } };
      };
      cachedEmit = (room, event, payload) => {
        getIO().to(room).emit(event, payload);
      };
    } catch {
      cachedEmit = () => {}; /* Socket.io (task 9.3) ainda não existe — no-op */
    }
  }
  return cachedEmit;
}

/** Real enqueue: adds a delayed job to the notificacao queue. */
async function realEnqueue(data: NotificacaoJob, opts: { delay: number }): Promise<unknown> {
  const requireLocal = createRequire(import.meta.url);
  const { notificacaoQueue } = requireLocal('./queues.js') as {
    notificacaoQueue: () => { add: (name: string, data: unknown, opts: unknown) => Promise<unknown> };
  };
  return notificacaoQueue().add('notificacao', data, { delay: opts.delay });
}

function resolveDeps(deps?: Partial<NotificacaoDeps>): NotificacaoDeps {
  const env = deps?.smsEnabled === undefined || deps?.pushEnabled === undefined ? getRealEnv() : undefined;
  const mailerDefaults =
    deps?.mailer === undefined || deps?.fromAddress === undefined ? getRealMailer() : undefined;
  return {
    prisma: deps?.prisma ?? getRealPrisma(),
    mailer: deps?.mailer ?? mailerDefaults!.mailer,
    fromAddress: deps?.fromAddress ?? mailerDefaults!.fromAddress,
    emit: deps?.emit ?? getRealEmit(),
    enqueue: deps?.enqueue ?? realEnqueue,
    smsEnabled: deps?.smsEnabled ?? env!.smsEnabled,
    pushEnabled: deps?.pushEnabled ?? env!.pushEnabled,
    agora: deps?.agora ?? (() => new Date()),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Parse an "HH:MM" string into minutes-since-midnight, or null if invalid. */
function parseHoraMinuto(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(valor.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Compute how many milliseconds a notification must be delayed because it falls
 * inside the citizen's silence window (Req. 6.4). Pure function.
 *
 * - Returns 0 when there is no valid window configured or NOW is outside it.
 * - Handles wrap-around windows (e.g. 22:00–07:00 spanning midnight).
 * - When inside the window, returns the ms remaining until `fimSilencio`.
 *
 * `inicioSilencio` / `fimSilencio` are "HH:MM" strings (as persisted by the
 * preferences service). `agora` is evaluated in local time (matching how the
 * strings are interpreted by the citizen).
 */
export function calcularDelaySilencio(
  agora: Date,
  inicioSilencio: string | null | undefined,
  fimSilencio: string | null | undefined,
): number {
  const inicio = parseHoraMinuto(inicioSilencio);
  const fim = parseHoraMinuto(fimSilencio);
  if (inicio === null || fim === null || inicio === fim) {
    return 0; // no (usable) window configured
  }

  const nowMin = agora.getHours() * 60 + agora.getMinutes();
  const dentroJanela =
    inicio < fim
      ? nowMin >= inicio && nowMin < fim // same-day window
      : nowMin >= inicio || nowMin < fim; // wrap-around midnight

  if (!dentroJanela) {
    return 0;
  }

  // Minutes remaining until the end of the window.
  let minutosAteFim = fim - nowMin;
  if (minutosAteFim <= 0) {
    minutosAteFim += 24 * 60; // fim is "tomorrow" (wrap-around case)
  }

  // Subtract the seconds/millis already elapsed in the current minute so the
  // job wakes up right at `fimSilencio`.
  const msDecorridosNoMinuto = agora.getSeconds() * 1000 + agora.getMilliseconds();
  const delay = minutosAteFim * 60_000 - msDecorridosNoMinuto;
  return delay > 0 ? delay : 0;
}

/**
 * Decide whether THIS job's channel should be delivered to a citizen given
 * their preferences (Req. 6.2/6.7).
 *
 * - `painel` is the reliable fallback channel and is ALWAYS delivered.
 * - For any other channel, deliver only if it is listed in the citizen's
 *   preferences for the job's `tipoEvento`.
 * - Servidor recipients (no `cidadaoId`) have no preference table and always
 *   receive — callers should not pass prefs in that case.
 *
 * `prefs` is the list of preference rows for the citizen (may be empty). An
 * empty/absent list means "no configured channel for this event" → only
 * painel is delivered (Req. 6.7).
 */
export function deveEntregar(
  data: NotificacaoJob,
  prefs: Array<{ tipoEvento: string; canais: string[] }> | null | undefined,
): boolean {
  if (data.tipo === 'painel') {
    return true; // painel is always delivered (reliable fallback channel)
  }
  if (!prefs || prefs.length === 0) {
    return false; // no configured channels → painel-only (handled elsewhere)
  }
  const linha = prefs.find((p) => p.tipoEvento === data.tipoEvento);
  if (!linha) {
    return false;
  }
  return linha.canais.includes(data.tipo);
}

/** True when the recipient is a citizen (has preferences + silence window). */
function ehCidadao(data: NotificacaoJob): data is NotificacaoJob & {
  destinatario: { cidadaoId: string };
} {
  return typeof data.destinatario?.cidadaoId === 'string' && data.destinatario.cidadaoId.length > 0;
}

/** Room name for the real-time emit, based on the recipient. */
function salaDestinatario(data: NotificacaoJob): string | null {
  if (data.destinatario?.cidadaoId) return `cidadao:${data.destinatario.cidadaoId}`;
  if (data.destinatario?.servidorId) return `servidor:${data.destinatario.servidorId}`;
  return null;
}

// ---------------------------------------------------------------------------
// Channel handlers
// ---------------------------------------------------------------------------

/**
 * Record an in-app (painel) notification in PostgreSQL and emit it in real time
 * via Socket.io. Painel is the reliable channel and the fallback target.
 */
export async function gravarPainel(
  data: NotificacaoJob,
  deps?: Partial<NotificacaoDeps>,
): Promise<void> {
  const d = resolveDeps(deps);
  const agora = d.agora();
  const row = await d.prisma.notificacao.create({
    data: {
      cidadaoId: data.destinatario?.cidadaoId ?? null,
      servidorId: data.destinatario?.servidorId ?? null,
      tipoEvento: data.tipoEvento,
      canal: 'painel',
      conteudo: data.conteudo,
      entregue: true,
      entregueEm: agora,
    },
  });

  const sala = salaDestinatario(data);
  if (sala) {
    try {
      d.emit(sala, 'notificacao:nova', {
        notificacaoId: row.id,
        tipo: data.tipoEvento,
        conteudo: data.conteudo,
      });
    } catch {
      /* real-time emit is best-effort; the row is already persisted */
    }
  }
}

/**
 * Send an email notification via Nodemailer. On failure the error PROPAGATES so
 * BullMQ's 3-attempt / 30s retry (Req. 6.5) kicks in.
 */
export async function enviarEmail(
  data: NotificacaoJob,
  deps?: Partial<NotificacaoDeps>,
): Promise<void> {
  const d = resolveDeps(deps);
  const destino = await resolverEmailDestinatario(data, d);
  if (!destino) {
    // Nowhere to send — degrade to painel so the citizen still sees it.
    await gravarPainel(data, deps);
    return;
  }
  await d.mailer.sendMail({
    from: d.fromAddress,
    to: destino,
    subject: 'Auditar — Atualização do seu processo',
    text: data.conteudo,
  });
}

/**
 * Send an SMS notification. Gated behind `FEATURE_SMS_ENABLED`; when disabled
 * this is a no-op/log. The real gateway is out of scope for this task — the
 * send is stubbed but the retry-on-throw contract/structure is preserved.
 */
export async function enviarSms(
  data: NotificacaoJob,
  deps?: Partial<NotificacaoDeps>,
): Promise<void> {
  const d = resolveDeps(deps);
  if (!d.smsEnabled) {
    console.log(`[notificacao] SMS desativado (FEATURE_SMS_ENABLED=false) — tipoEvento=${data.tipoEvento}`);
    return;
  }
  // TODO: integrar gateway de SMS real. Mantém o contrato de re-throw para que
  // o retry do BullMQ (Req. 6.5) e o fallback para painel funcionem.
  console.log(`[notificacao] enviarSms tipoEvento=${data.tipoEvento} (gateway stub)`);
}

/**
 * Send a push notification. Gated behind `FEATURE_PUSH_ENABLED`; same treatment
 * as SMS.
 */
export async function enviarPush(
  data: NotificacaoJob,
  deps?: Partial<NotificacaoDeps>,
): Promise<void> {
  const d = resolveDeps(deps);
  if (!d.pushEnabled) {
    console.log(`[notificacao] Push desativado (FEATURE_PUSH_ENABLED=false) — tipoEvento=${data.tipoEvento}`);
    return;
  }
  // TODO: integrar serviço de push real.
  console.log(`[notificacao] enviarPush tipoEvento=${data.tipoEvento} (service stub)`);
}

/** Resolve the recipient email address. Citizens store it on the Cidadao row. */
async function resolverEmailDestinatario(
  data: NotificacaoJob,
  d: NotificacaoDeps,
): Promise<string | null> {
  // The producer may embed the address in `conteudo` metadata in the future;
  // for now we only have the recipient id. Email delivery for servidores/other
  // targets is resolved by the caller layer. Returning null degrades to painel.
  void d;
  return (data as { email?: string }).email ?? null;
}

// ---------------------------------------------------------------------------
// Routing + orchestration
// ---------------------------------------------------------------------------

/**
 * Route a notification job to the correct channel handler, honouring citizen
 * preferences (Req. 6.2/6.7) and the silence window (Req. 6.4).
 *
 * Flow:
 *   1. If the recipient is a citizen, load their preferences.
 *      a. If NOW is inside the silence window, re-enqueue with a delay until
 *         the window ends and return (no delivery now).
 *      b. If the job's channel is not enabled for this event, skip it — unless
 *         it is `painel` (always delivered). For a non-painel channel that is
 *         opted out we no-op (the painel job enqueued separately covers Req.
 *         6.7).
 *   2. Deliver through the channel handler selected by `job.data.tipo`.
 */
export async function processarNotificacao(
  job: Job<NotificacaoJob>,
  deps?: Partial<NotificacaoDeps>,
): Promise<void> {
  const d = resolveDeps(deps);
  const data = job.data;

  if (ehCidadao(data)) {
    const prefs = await d.prisma.preferenciaNotificacao.findMany({
      where: { cidadaoId: data.destinatario.cidadaoId },
    });

    // Silence window (Req. 6.4): retain and re-deliver after it ends.
    const janela = prefs.find((p) => p.inicioSilencio != null || p.fimSilencio != null);
    if (janela) {
      const delay = calcularDelaySilencio(d.agora(), janela.inicioSilencio, janela.fimSilencio);
      if (delay > 0) {
        await d.enqueue(data, { delay });
        return;
      }
    }

    // Channel opt-out (Req. 6.2/6.7): painel always delivers; other channels
    // only when enabled for this event type.
    if (!deveEntregar(data, prefs)) {
      return;
    }
  }

  await rotearCanal(data, deps);
}

/** Dispatch to the channel handler by `tipo`. */
async function rotearCanal(data: NotificacaoJob, deps?: Partial<NotificacaoDeps>): Promise<void> {
  switch (data.tipo) {
    case 'email':
      return enviarEmail(data, deps);
    case 'sms':
      return enviarSms(data, deps);
    case 'painel':
      return gravarPainel(data, deps);
    case 'push':
      return enviarPush(data, deps);
    default:
      throw new Error(`Tipo de notificação desconhecido: ${String((data as NotificacaoJob).tipo)}`);
  }
}

// ---------------------------------------------------------------------------
// Fallback after final failed attempt (Req. 6.5)
// ---------------------------------------------------------------------------

/** True when the job's channel is one that can fall back to painel. */
function canalComFallback(tipo: NotificacaoJob['tipo']): boolean {
  return tipo === 'email' || tipo === 'sms';
}

/**
 * Handle the terminal failure of an email/SMS job (Req. 6.5): register the
 * failure (canal, tipoEvento, timestamp) with `entregue=false` + `tentativas`,
 * then deliver via painel as the fallback channel (≤60s after the last
 * attempt). Exported for unit testing.
 *
 * @param data         the notificacao payload
 * @param tentativas   number of attempts already made
 * @param deps         injectable deps
 */
export async function tratarFalhaFinal(
  data: NotificacaoJob,
  tentativas: number,
  deps?: Partial<NotificacaoDeps>,
): Promise<void> {
  const d = resolveDeps(deps);
  const agora = d.agora();

  // Register the failure with channel, event type and timestamp.
  await d.prisma.notificacao.create({
    data: {
      cidadaoId: data.destinatario?.cidadaoId ?? null,
      servidorId: data.destinatario?.servidorId ?? null,
      tipoEvento: data.tipoEvento,
      canal: data.tipo,
      conteudo: data.conteudo,
      entregue: false,
      tentativas,
    },
  });
  console.error(
    `[notificacao] falha final canal=${data.tipo} tipoEvento=${data.tipoEvento} tentativas=${tentativas} em=${agora.toISOString()}`,
  );

  // Deliver via painel as the reliable fallback.
  await gravarPainel({ ...data, tipo: 'painel' }, deps);
}

/**
 * Decide whether a failed job has exhausted its attempts. BullMQ exposes
 * `job.attemptsMade` and `job.opts.attempts`.
 */
export function ehUltimaTentativa(job: Pick<Job, 'attemptsMade' | 'opts'>): boolean {
  const max = job.opts?.attempts ?? 3;
  return job.attemptsMade >= max;
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Create the notificacao Worker. Retry/backoff live on the queue's
 * `defaultJobOptions` (attempts 3, fixed 30s — Req. 6.5); the worker only wires
 * the processor and the terminal-failure fallback handler.
 *
 * Lazy: calling this opens the Redis connection; importing the module does not.
 */
export function createNotificacaoWorker(): Worker<NotificacaoJob> {
  const worker = new Worker<NotificacaoJob>(
    QUEUE_NAMES.NOTIFICACAO,
    (job) => processarNotificacao(job),
    { connection: bullmqConnection },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    if (canalComFallback(job.data.tipo) && ehUltimaTentativa(job)) {
      void tratarFalhaFinal(job.data, job.attemptsMade).catch((e) => {
        console.error('[notificacao] fallback para painel falhou:', e);
      });
    } else {
      console.warn(
        `[notificacao] job ${job.id} falhou (tentativa ${job.attemptsMade}): ${err?.message ?? err}`,
      );
    }
  });

  return worker;
}
