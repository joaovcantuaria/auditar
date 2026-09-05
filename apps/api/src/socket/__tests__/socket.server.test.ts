import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server as HttpServer } from 'node:http';

// ---------------------------------------------------------------------------
// Mocks (hoisted) — mesmo padrão dos testes irmãos.
// Nenhum destes toca em Redis/DB reais, e o pacote `socket.io` NUNCA é
// carregado: injetamos um `serverFactory` fake via `deps`.
// ---------------------------------------------------------------------------

// env: fornece CORS_ORIGINS sem parsear process.env real.
vi.mock('../../config/env.js', () => ({
  env: { CORS_ORIGINS: 'http://localhost:5173,http://example.com' },
}));

// redis: `duplicate()` retorna um objeto inofensivo (só usado se o adapter rodar).
vi.mock('../../config/redis.js', () => ({
  redis: { duplicate: () => ({}) },
}));

// jwt: controlamos verifyToken/isBlacklisted por teste.
const verifyToken = vi.fn();
const isBlacklisted = vi.fn();
vi.mock('../../lib/jwt.js', () => ({
  verifyToken: (t: string) => verifyToken(t),
  isBlacklisted: (jti: string) => isBlacklisted(jti),
}));

// ---------------------------------------------------------------------------
// Fakes de Socket.io
// ---------------------------------------------------------------------------

interface EmitCall {
  room: string;
  event: string;
  payload: unknown;
}

/** Fake do servidor io que grava chamadas para asserção. */
function makeFakeIO() {
  const emitCalls: EmitCall[] = [];
  const useFns: Array<(socket: unknown, next: (err?: Error) => void) => void> = [];
  const connectionListeners: Array<(socket: unknown) => void> = [];
  let adapterArg: unknown;

  const io = {
    use(fn: (socket: unknown, next: (err?: Error) => void) => void) {
      useFns.push(fn);
    },
    on(event: string, listener: (socket: unknown) => void) {
      if (event === 'connection') connectionListeners.push(listener);
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitCalls.push({ room, event, payload });
        },
      };
    },
    adapter(a: unknown) {
      adapterArg = a;
    },
  };

  return {
    io,
    emitCalls,
    getAdapterArg: () => adapterArg,
    /** Dispara o middleware de handshake registrado e devolve o erro (ou undefined). */
    async runHandshake(socket: unknown): Promise<Error | undefined> {
      let captured: Error | undefined;
      for (const fn of useFns) {
        await fn(socket, (err?: Error) => {
          captured = err;
        });
      }
      // O wrapper de produção chama authenticateHandshake como fire-and-forget
      // (`void ...`), então o `next` resolve em um tick posterior.
      for (let i = 0; i < 5; i++) await Promise.resolve();
      return captured;
    },
    /** Dispara os listeners de `connection`. */
    async fireConnection(socket: unknown): Promise<void> {
      for (const l of connectionListeners) await l(socket);
      // dá um tick para as promises internas (join) resolverem
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

/** Fake de socket individual que grava as salas em que entrou. */
function makeFakeSocket(handshake: {
  auth?: { token?: string };
  headers?: Record<string, string | undefined>;
}) {
  const joined: string[] = [];
  return {
    handshake,
    data: {} as { user?: unknown },
    async join(room: string) {
      joined.push(room);
    },
    on() {
      /* no-op */
    },
    to() {
      return { emit() {} };
    },
    joined,
  };
}

const fakeHttpServer = {} as HttpServer;
const noAdapter = null; // desabilita o adapter Redis nos testes

/** Prisma fake: retorna processos configuráveis para o cidadão. */
function makeFakePrisma(ids: string[]) {
  return {
    processo: {
      findMany: vi.fn(async () => ids.map((id) => ({ id }))),
    },
  };
}

describe('socket.server', () => {
  beforeEach(() => {
    vi.resetModules();
    verifyToken.mockReset();
    isBlacklisted.mockReset();
  });

  describe('getIO', () => {
    it('lança erro antes de initSocket', async () => {
      const mod = await import('../socket.server.js');
      mod.__resetIO();
      expect(() => mod.getIO()).toThrow(/não inicializado/i);
    });

    it('retorna a instância após initSocket', async () => {
      const mod = await import('../socket.server.js');
      const fake = makeFakeIO();
      const returned = mod.initSocket(fakeHttpServer, {
        serverFactory: () => fake.io,
        adapterFactory: noAdapter,
        prisma: makeFakePrisma([]),
      });
      expect(returned).toBe(fake.io);
      expect(mod.getIO()).toBe(fake.io);
    });

    it('configura CORS a partir de env.CORS_ORIGINS', async () => {
      const mod = await import('../socket.server.js');
      const factory = vi.fn((_srv: HttpServer, _opts: unknown) => makeFakeIO().io);
      mod.initSocket(fakeHttpServer, {
        serverFactory: factory,
        adapterFactory: noAdapter,
        prisma: makeFakePrisma([]),
      });
      const opts = factory.mock.calls[0][1] as { cors: { origin: string[]; credentials: boolean } };
      expect(opts.cors.origin).toEqual(['http://localhost:5173', 'http://example.com']);
      expect(opts.cors.credentials).toBe(true);
    });
  });

  describe('handshake auth', () => {
    it('registra o middleware de handshake via io.use', async () => {
      const mod = await import('../socket.server.js');
      const fake = makeFakeIO();
      mod.initSocket(fakeHttpServer, {
        serverFactory: () => fake.io,
        adapterFactory: noAdapter,
        prisma: makeFakePrisma([]),
      });
      // O init deve ter registrado exatamente um middleware de handshake.
      const socket = makeFakeSocket({ auth: {} });
      const err = await fake.runHandshake(socket);
      // Sem token -> rejeitado (confirma que o middleware ligado é o de auth).
      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toBe('unauthorized');
    });

    it('rejeita quando o token está ausente', async () => {
      const mod = await import('../socket.server.js');
      const socket = makeFakeSocket({ auth: {} });
      let captured: Error | undefined;
      await mod.authenticateHandshake(socket as never, (e) => (captured = e));
      expect(captured).toBeInstanceOf(Error);
      expect(captured?.message).toBe('unauthorized');
    });

    it('rejeita quando o token é inválido (verifyToken lança)', async () => {
      const mod = await import('../socket.server.js');
      verifyToken.mockImplementation(() => {
        throw new Error('invalid');
      });
      const socket = makeFakeSocket({ auth: { token: 'bad' } });
      let captured: Error | undefined;
      await mod.authenticateHandshake(socket as never, (e) => (captured = e));
      expect(captured?.message).toBe('unauthorized');
    });

    it('rejeita quando o jti está na blacklist', async () => {
      const mod = await import('../socket.server.js');
      verifyToken.mockReturnValue({ sub: 'c1', role: 'cidadao', jti: 'j1' });
      isBlacklisted.mockResolvedValue(true);
      const socket = makeFakeSocket({ auth: { token: 'ok' } });
      let captured: Error | undefined;
      await mod.authenticateHandshake(socket as never, (e) => (captured = e));
      expect(captured?.message).toBe('unauthorized');
    });

    it('aceita token válido e anexa o payload em socket.data.user', async () => {
      const mod = await import('../socket.server.js');
      const payload = { sub: 'c1', role: 'cidadao', jti: 'j1' };
      verifyToken.mockReturnValue(payload);
      isBlacklisted.mockResolvedValue(false);
      const socket = makeFakeSocket({ auth: { token: 'ok' } });
      let captured: Error | undefined;
      await mod.authenticateHandshake(socket as never, (e) => (captured = e));
      expect(captured).toBeUndefined();
      expect(socket.data.user).toEqual(payload);
    });

    it('extrai token do header Authorization: Bearer', async () => {
      const mod = await import('../socket.server.js');
      const payload = { sub: 's1', role: 'servidor', jti: 'j2' };
      verifyToken.mockReturnValue(payload);
      isBlacklisted.mockResolvedValue(false);
      const socket = makeFakeSocket({ headers: { authorization: 'Bearer headertoken' } });
      let captured: Error | undefined;
      await mod.authenticateHandshake(socket as never, (e) => (captured = e));
      expect(captured).toBeUndefined();
      expect(verifyToken).toHaveBeenCalledWith('headertoken');
      expect(socket.data.user).toEqual(payload);
    });
  });

  describe('join de salas na conexão', () => {
    it('registra o listener de connection via io.on', async () => {
      const mod = await import('../socket.server.js');
      const fake = makeFakeIO();
      mod.initSocket(fakeHttpServer, {
        serverFactory: () => fake.io,
        adapterFactory: noAdapter,
        prisma: makeFakePrisma(['p1']),
      });
      const socket = makeFakeSocket({});
      socket.data.user = { sub: 'c1', role: 'cidadao', jti: 'j1' };
      await fake.fireConnection(socket);
      // Ao menos a sala pessoal deve ter sido registrada pelo listener ligado.
      expect(socket.joined).toContain('cidadao:c1');
    });

    it('cidadão entra em cidadao:{sub} e nas salas dos seus processos', async () => {
      const mod = await import('../socket.server.js');
      const socket = makeFakeSocket({});
      socket.data.user = { sub: 'c1', role: 'cidadao', jti: 'j1' };
      await mod.joinRoomsForSocket(socket as never, makeFakePrisma(['p1', 'p2']) as never);
      expect(socket.joined).toContain('cidadao:c1');
      expect(socket.joined).toContain('processo:p1');
      expect(socket.joined).toContain('processo:p2');
    });

    it('servidor entra em servidor:{sub} e unidade:{unidadeId}', async () => {
      const mod = await import('../socket.server.js');
      const socket = makeFakeSocket({});
      socket.data.user = { sub: 's1', role: 'servidor', jti: 'j2', unidadeId: 'u9' };
      await mod.joinRoomsForSocket(socket as never, makeFakePrisma([]) as never);
      expect(socket.joined).toContain('servidor:s1');
      expect(socket.joined).toContain('unidade:u9');
    });
  });

  describe('helpers de emissão', () => {
    async function initWith() {
      const mod = await import('../socket.server.js');
      const fake = makeFakeIO();
      mod.initSocket(fakeHttpServer, {
        serverFactory: () => fake.io,
        adapterFactory: noAdapter,
        prisma: makeFakePrisma([]),
      });
      return { mod, fake };
    }

    it('emitParaProcesso chama .to(processo:{id}).emit(event, payload)', async () => {
      const { mod, fake } = await initWith();
      const payload = { processoId: 'p1', novoStatus: 'em_analise', etapa: 2 };
      mod.emitParaProcesso('p1', 'processo:status_atualizado', payload);
      expect(fake.emitCalls).toContainEqual({
        room: 'processo:p1',
        event: 'processo:status_atualizado',
        payload,
      });
    });

    it('emitParaCidadao / emitParaServidor / emitParaUnidade usam as salas corretas', async () => {
      const { mod, fake } = await initWith();
      mod.emitParaCidadao('c1', 'notificacao:nova', { a: 1 });
      mod.emitParaServidor('s1', 'processo:atribuido', { b: 2 });
      mod.emitParaUnidade('u9', 'fila:novo_processo', { c: 3 });
      expect(fake.emitCalls).toEqual([
        { room: 'cidadao:c1', event: 'notificacao:nova', payload: { a: 1 } },
        { room: 'servidor:s1', event: 'processo:atribuido', payload: { b: 2 } },
        { room: 'unidade:u9', event: 'fila:novo_processo', payload: { c: 3 } },
      ]);
    });
  });
});
