import {
  joinRoomsForSocket,
  joinProcessoRoom,
  type IOServer,
  type SocketLike,
  type PrismaLike,
} from '../socket.server.js';

/**
 * Nomes das salas (rooms) do Socket.io. Centralizados aqui para manter os
 * produtores e os testes alinhados com o design ("Socket.io — Salas e Eventos").
 */
export const rooms = {
  cidadao: (id: string) => `cidadao:${id}`,
  servidor: (id: string) => `servidor:${id}`,
  processo: (id: string) => `processo:${id}`,
  unidade: (id: string) => `unidade:${id}`,
} as const;

/**
 * Eventos emitidos pelo servidor → cliente. São exatamente os listados no
 * design; centralizá-los evita divergência de strings entre produtores.
 */
export const eventos = {
  processoStatusAtualizado: 'processo:status_atualizado',
  processoNovaMensagem: 'processo:nova_mensagem',
  processoAtribuido: 'processo:atribuido',
  processoEtapaAvancada: 'processo:etapa_avancada',
  notificacaoNova: 'notificacao:nova',
  filaNovoProcesso: 'fila:novo_processo',
  dashboardAtualizar: 'dashboard:atualizar',
} as const;

export type EventoServidor = (typeof eventos)[keyof typeof eventos];

/**
 * Registra o ciclo de vida da conexão no servidor Socket.io: em cada conexão
 * autenticada, junta o socket às salas do seu perfil. O `disconnect` é tratado
 * automaticamente pelo Socket.io (remove o socket de todas as salas), então não
 * há limpeza manual — registramos apenas um listener de log opcional.
 *
 * Chamado por `initSocket`. Também exposto para uso em testes/bootstrap.
 */
export function registerConnectionHandlers(server: IOServer, prisma: PrismaLike): void {
  server.on('connection', (socket: SocketLike) => {
    void joinRoomsForSocket(socket, prisma);

    // Assinatura sob demanda de uma sala de processo (ex.: cliente abre detalhe).
    socket.on('processo:entrar', (...args: unknown[]) => {
      const processoId = args[0];
      if (typeof processoId === 'string' && processoId) {
        void joinProcessoRoom(socket, processoId);
      }
    });
  });
}

export { joinRoomsForSocket, joinProcessoRoom };
