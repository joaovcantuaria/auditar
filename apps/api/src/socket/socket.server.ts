import type { Server as HttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { verifyToken, isBlacklisted, type JwtPayload } from '../lib/jwt.js';

// ---------------------------------------------------------------------------
// Tipos mínimos do Socket.io
// ---------------------------------------------------------------------------
// Declaramos apenas a superfície da API que usamos. Isso mantém o módulo
// tipado sem exigir que o pacote `socket.io` esteja fisicamente instalado no
// momento da compilação/import (ver nota de "lazy require" abaixo).

/** Objeto de sala retornado por `io.to(room)` / `socket.to(room)`. */
export interface BroadcastOperator {
  emit(event: string, payload: unknown): void;
}

/** Socket individual de uma conexão cliente. */
export interface SocketLike {
  handshake: {
    auth?: { token?: string };
    headers?: Record<string, string | string[] | undefined>;
  };
  data: { user?: JwtPayload };
  join(room: string): void | Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  to(room: string): BroadcastOperator;
}

/** Instância do servidor Socket.io (superfície usada pela aplicação). */
export interface IOServer {
  use(fn: (socket: SocketLike, next: (err?: Error) => void) => void | Promise<void>): void;
  on(event: 'connection', listener: (socket: SocketLike) => void): void;
  to(room: string): BroadcastOperator;
  adapter(adapter: unknown): void;
}

/** Assinatura do construtor `new Server(httpServer, opts)` do `socket.io`. */
export type ServerFactory = (httpServer: HttpServer, opts: unknown) => IOServer;

/** Assinatura de `createAdapter(pubClient, subClient)` do redis-adapter. */
export type AdapterFactory = (pub: unknown, sub: unknown) => unknown;

/**
 * Dependências injetáveis. Em produção resolvidas preguiçosamente via
 * `createRequire` (ver `resolveServerFactory`/`resolveAdapterFactory`); em
 * testes um fake é injetado para não depender do pacote real `socket.io`.
 */
export interface InitSocketDeps {
  /** Fábrica que cria o servidor (equivale a `(srv, opts) => new Server(srv, opts)`). */
  serverFactory?: ServerFactory;
  /** Fábrica do adaptador Redis (`createAdapter`). Passe `null` para desabilitar. */
  adapterFactory?: AdapterFactory | null;
  /** Prisma injetável para consultar os processos do cidadão ao conectar. */
  prisma?: PrismaLike;
}

/** Superfície mínima do Prisma usada aqui (facilita mocks em teste). */
export interface PrismaLike {
  processo: {
    findMany(args: {
      where: { cidadaoId: string };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
}

// ---------------------------------------------------------------------------
// Estado do módulo (singleton)
// ---------------------------------------------------------------------------

let io: IOServer | undefined;

/**
 * Resolve preguiçosamente o construtor `Server` do pacote `socket.io`.
 * O require é adiado até `initSocket` ser chamado com um servidor HTTP real,
 * de modo que apenas IMPORTAR este módulo (como fazem os produtores via
 * `getIO()` dentro de try/catch) nunca carrega o pacote — que pode nem estar
 * fisicamente instalado no ambiente.
 */
function resolveServerFactory(): ServerFactory {
  const requireLocal = createRequire(import.meta.url);
  const { Server } = requireLocal('socket.io') as {
    Server: new (httpServer: HttpServer, opts: unknown) => IOServer;
  };
  return (httpServer, opts) => new Server(httpServer, opts);
}

/** Resolve preguiçosamente `createAdapter` do `@socket.io/redis-adapter`. */
function resolveAdapterFactory(): AdapterFactory {
  const requireLocal = createRequire(import.meta.url);
  const { createAdapter } = requireLocal('@socket.io/redis-adapter') as {
    createAdapter: AdapterFactory;
  };
  return createAdapter;
}

/** Resolve preguiçosamente o Prisma real (evita conexão ao só importar). */
function resolvePrisma(): PrismaLike {
  const requireLocal = createRequire(import.meta.url);
  const mod = requireLocal('../lib/prisma.js') as { prisma: PrismaLike };
  return mod.prisma;
}

// ---------------------------------------------------------------------------
// Autenticação de handshake
// ---------------------------------------------------------------------------

/**
 * Extrai o token JWT do handshake: primeiro de `auth.token`, depois do header
 * `Authorization: Bearer <token>`.
 */
export function extractHandshakeToken(handshake: SocketLike['handshake']): string | null {
  const fromAuth = handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.trim()) {
    return fromAuth.trim();
  }
  const rawHeader = handshake.headers?.authorization;
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim() || null;
}

/**
 * Middleware de handshake: valida o JWT (assinatura + expiração), checa a
 * blacklist no Redis e anexa o payload em `socket.data.user`. Qualquer falha
 * rejeita a conexão com `Error('unauthorized')` (Req. 5.9, 6.1 — apenas
 * conexões autenticadas entram nas salas).
 */
export async function authenticateHandshake(
  socket: SocketLike,
  next: (err?: Error) => void,
): Promise<void> {
  const token = extractHandshakeToken(socket.handshake);
  if (!token) {
    next(new Error('unauthorized'));
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    next(new Error('unauthorized'));
    return;
  }

  try {
    if (payload.jti && (await isBlacklisted(payload.jti))) {
      next(new Error('unauthorized'));
      return;
    }
  } catch {
    // Falha ao consultar o Redis: por segurança, negar a conexão.
    next(new Error('unauthorized'));
    return;
  }

  socket.data.user = payload;
  next();
}

// ---------------------------------------------------------------------------
// Ciclo de conexão / join de salas
// ---------------------------------------------------------------------------

/**
 * Registra um socket já autenticado nas salas apropriadas ao seu perfil:
 * - Cidadão: `cidadao:{sub}` + `processo:{id}` para cada processo seu.
 * - Servidor: `servidor:{sub}` + `unidade:{unidadeId}` (quando disponível).
 *
 * Ao desconectar, o Socket.io remove o socket de todas as salas
 * automaticamente — nenhuma limpeza manual é necessária.
 */
export async function joinRoomsForSocket(socket: SocketLike, prisma: PrismaLike): Promise<void> {
  const user = socket.data.user;
  if (!user) return;

  if (user.role === 'cidadao') {
    await socket.join(`cidadao:${user.sub}`);
    // Junta o cidadão às salas de cada um de seus processos. A consulta usa o
    // Prisma injetado, então testes não precisam de banco real. Se por algum
    // motivo a consulta falhar, a sala pessoal já foi garantida acima e os
    // processos podem ser assinados sob demanda via `joinProcessoRoom`.
    try {
      const processos = await prisma.processo.findMany({
        where: { cidadaoId: user.sub },
        select: { id: true },
      });
      for (const p of processos) {
        await socket.join(`processo:${p.id}`);
      }
    } catch {
      /* processos ficam disponíveis sob demanda (joinProcessoRoom) */
    }
    return;
  }

  // Servidor
  await socket.join(`servidor:${user.sub}`);
  // `unidadeId` do servidor pode chegar no payload (via permissions/claims
  // futuros). Se presente, entra também na sala da unidade (Req. 12.7).
  const unidadeId = (user as JwtPayload & { unidadeId?: string }).unidadeId;
  if (unidadeId) {
    await socket.join(`unidade:${unidadeId}`);
  }
}

/**
 * Helper para juntar um socket a uma sala de processo sob demanda (ex.: o
 * cliente abre um processo específico). Mantém a lógica de rooms centralizada.
 */
export function joinProcessoRoom(socket: SocketLike, processoId: string): void | Promise<void> {
  return socket.join(`processo:${processoId}`);
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

/**
 * Monta o servidor Socket.io sobre o `httpServer` fornecido, configura o
 * adaptador Redis (multi-instância) e registra a autenticação de handshake +
 * o join automático de salas na conexão.
 *
 * Deve ser chamado uma única vez por um bootstrap futuro que crie o servidor
 * HTTP (`http.createServer(app)`). Os produtores (tasks 7.6/9.1) usam `getIO()`
 * envolto em try/catch, então antes desta chamada as emissões viram no-op.
 *
 * @param httpServer servidor HTTP onde o Socket.io será montado
 * @param deps dependências injetáveis (fábricas/prisma) — usado em testes
 * @returns a instância do servidor Socket.io criada
 */
export function initSocket(httpServer: HttpServer, deps: InitSocketDeps = {}): IOServer {
  const serverFactory = deps.serverFactory ?? resolveServerFactory();
  const prisma = deps.prisma ?? resolvePrisma();

  const corsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
  const server = serverFactory(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
  });

  // Adaptador Redis para propagar eventos entre instâncias (Req. multi-instância).
  // `adapterFactory === null` desabilita explicitamente (útil em testes).
  if (deps.adapterFactory !== null) {
    try {
      const createAdapter = deps.adapterFactory ?? resolveAdapterFactory();
      const pubClient = redis.duplicate();
      const subClient = redis.duplicate();
      server.adapter(createAdapter(pubClient, subClient));
    } catch (err) {
      // Sem o pacote/adapter disponível seguimos em modo single-instance.
      console.error(
        '[socket] adaptador Redis indisponível — modo single-instance:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Autenticação de handshake.
  server.use((socket, next) => {
    void authenticateHandshake(socket, next);
  });

  // Ciclo de conexão: join de salas por perfil.
  server.on('connection', (socket) => {
    void joinRoomsForSocket(socket, prisma);
  });

  io = server;
  return server;
}

/**
 * Retorna a instância do servidor Socket.io inicializada.
 * @throws Error quando `initSocket` ainda não foi executado. Os produtores
 * envolvem `getIO()` em try/catch, então lançar aqui é o sinal de no-op
 * pretendido antes da inicialização.
 */
export function getIO(): IOServer {
  if (!io) {
    throw new Error('Socket.io não inicializado — chame initSocket(httpServer) primeiro');
  }
  return io;
}

/** Reseta o singleton (uso interno em testes). */
export function __resetIO(): void {
  io = undefined;
}

// ---------------------------------------------------------------------------
// Helpers de emissão tipados (usados pelos produtores)
// ---------------------------------------------------------------------------

/** Emite um evento para uma sala arbitrária. */
export function emitParaSala(room: string, event: string, payload: unknown): void {
  getIO().to(room).emit(event, payload);
}

/** Emite para a sala de um processo (`processo:{id}`). */
export function emitParaProcesso(processoId: string, event: string, payload: unknown): void {
  emitParaSala(`processo:${processoId}`, event, payload);
}

/** Emite para a sala pessoal de um cidadão (`cidadao:{id}`). */
export function emitParaCidadao(cidadaoId: string, event: string, payload: unknown): void {
  emitParaSala(`cidadao:${cidadaoId}`, event, payload);
}

/** Emite para a sala pessoal de um servidor (`servidor:{id}`). */
export function emitParaServidor(servidorId: string, event: string, payload: unknown): void {
  emitParaSala(`servidor:${servidorId}`, event, payload);
}

/** Emite para a sala de uma unidade (`unidade:{id}`). */
export function emitParaUnidade(unidadeId: string, event: string, payload: unknown): void {
  emitParaSala(`unidade:${unidadeId}`, event, payload);
}
