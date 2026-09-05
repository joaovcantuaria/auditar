import { io, type Socket } from 'socket.io-client';
import { getAuthToken } from '@/store/authStore';

/**
 * Cliente Socket.io singleton (framework-agnóstico — sem imports de React).
 *
 * Estabelece uma única conexão em tempo real com a API, autenticada via JWT no
 * handshake. O contrato de autenticação espelha o servidor
 * (`apps/api/src/socket/socket.server.ts`): o token é enviado em
 * `handshake.auth.token`. Usamos a forma de callback do `auth` para que cada
 * (re)conexão releia o token atual do `authStore`, garantindo que reconexões
 * após um refresh usem sempre um token válido.
 *
 * _Requirements: 5.9, 6.1_
 */

/**
 * URL base do servidor Socket.io. Em produção pode ser sobrescrita por
 * `VITE_API_URL`; caso contrário conectamos à origem atual (mesmo host que
 * serve o frontend), deixando o Socket.io resolver o caminho padrão.
 */
function resolveSocketUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }
  // Sem variável de ambiente: usa a origem atual quando disponível.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '/';
}

/** Instância única do socket, criada preguiçosamente em `getSocket()`. */
let socket: Socket | null = null;

/**
 * Retorna a instância singleton do socket, criando-a na primeira chamada.
 *
 * A conexão é criada com `autoConnect: false` — quem controla o ciclo de vida
 * é `connectSocket()`/`disconnectSocket()`. O token é lido via callback a cada
 * (re)conexão, então nunca fica "preso" a um valor antigo.
 */
export function getSocket(): Socket {
  if (socket) {
    return socket;
  }

  socket = io(resolveSocketUrl(), {
    // Callback reavaliado a cada conexão/reconexão — sempre lê o token atual.
    auth: (cb: (data: { token: string | null }) => void) => {
      cb({ token: getAuthToken() });
    },
    autoConnect: false,
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  return socket;
}

/**
 * Conecta o socket de forma idempotente.
 *
 * Só conecta quando há um token de autenticação e a conexão ainda não está
 * ativa (guarda contra conexões duplicadas e contra conectar deslogado). Se já
 * estiver conectado, é um no-op. Retorna a instância para conveniência.
 */
export function connectSocket(): Socket | null {
  const token = getAuthToken();
  if (!token) {
    // Sem sessão: não abrimos conexão anônima (o handshake seria rejeitado).
    return null;
  }

  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

/**
 * Desconecta o socket (ex.: no logout). Idempotente — seguro chamar mesmo se
 * a conexão nunca foi aberta. Mantém a instância singleton para permitir uma
 * reconexão futura (novo login) sem recriar listeners de baixo nível.
 */
export function disconnectSocket(): void {
  if (socket && socket.connected) {
    socket.disconnect();
  }
}

/** Indica se o socket está atualmente conectado. */
export function isSocketConnected(): boolean {
  return Boolean(socket?.connected);
}
