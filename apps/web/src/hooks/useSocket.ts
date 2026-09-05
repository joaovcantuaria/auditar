import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socketClient';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/store/authStore';
import { useNotificacaoStore } from '@/store/notificacaoStore';

/**
 * Hook de tempo real: conecta o Socket.io autenticado, assina todos os eventos
 * servidor→cliente do design e reage a cada um (a) atualizando o
 * `notificacaoStore` quando relevante e (b) invalidando as queries React Query
 * correspondentes para que a UI refaça o fetch dos dados afetados.
 *
 * Deve ser montado uma única vez em um ponto alto da árvore (ex.: o AppShell),
 * pois o socket é um singleton — múltiplas montagens apenas re-registram os
 * mesmos listeners (que são removidos no cleanup).
 *
 * _Requirements: 5.9, 6.1_
 */

// ---------------------------------------------------------------------------
// Nomes dos eventos servidor → cliente (espelham `connection.handler.ts`).
// ---------------------------------------------------------------------------

export const SOCKET_EVENTS = {
  processoStatusAtualizado: 'processo:status_atualizado',
  processoNovaMensagem: 'processo:nova_mensagem',
  processoAtribuido: 'processo:atribuido',
  processoEtapaAvancada: 'processo:etapa_avancada',
  notificacaoNova: 'notificacao:nova',
  filaNovoProcesso: 'fila:novo_processo',
  dashboardAtualizar: 'dashboard:atualizar',
  // Organizador de Tarefas (Req. 27) — eventos emitidos pelo backend na sala
  // pessoal do Servidor (`servidor:{id}`). Todos invalidam as queries de tarefa.
  tarefaAtribuida: 'tarefa:atribuida',
  tarefaStatusAtualizado: 'tarefa:status_atualizado',
  tarefaProximaVencimento: 'tarefa:proxima_vencimento',
  tarefaVencida: 'tarefa:vencida',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// ---------------------------------------------------------------------------
// Payloads dos eventos (espelham as formas emitidas pelo backend).
// Exportados para reuso pelo código de features (grupos 13–17).
// ---------------------------------------------------------------------------

/** `processo:status_atualizado` */
export interface ProcessoStatusAtualizadoPayload {
  processoId: string;
  novoStatus: string;
  etapa: string;
}

/** `processo:nova_mensagem` */
export interface ProcessoNovaMensagemPayload {
  mensagemId: string;
  processoId: string;
  remetente: string;
  conteudo: string;
}

/** `processo:atribuido` */
export interface ProcessoAtribuidoPayload {
  processoId: string;
  servidorId: string;
}

/** `processo:etapa_avancada` */
export interface ProcessoEtapaAvancadaPayload {
  processoId: string;
  etapaDestino: string;
}

/** `notificacao:nova` */
export interface NotificacaoNovaPayload {
  notificacaoId: string;
  tipo: string;
  conteudo: string;
}

/** `fila:novo_processo` */
export interface FilaNovoProcessoPayload {
  processoId: string;
  protocolo: string;
}

/** `dashboard:atualizar` (sem corpo). */
export type DashboardAtualizarPayload = Record<string, never>;

/** `tarefa:atribuida` */
export interface TarefaAtribuidaPayload {
  tarefaId: string;
  titulo: string;
  prazo: string;
}

/** `tarefa:status_atualizado` */
export interface TarefaStatusAtualizadoPayload {
  tarefaId: string;
  atribuicaoId: string;
  status: string;
}

/** `tarefa:proxima_vencimento` / `tarefa:vencida` (formas mínimas). */
export interface TarefaPrazoPayload {
  tarefaId: string;
}

// ---------------------------------------------------------------------------
// Convenções de query-keys do React Query.
//
// Fonte única de verdade para os feature pages (grupos 13–17). Ao consumir
// dados via `useQuery`, use EXATAMENTE estas keys para que as invalidações
// disparadas por eventos de socket atinjam os caches corretos.
//
//   queryKeys.processos()                 -> ['processos']            (listas)
//   queryKeys.processo(id)                -> ['processo', id]         (detalhe)
//   queryKeys.processoMensagens(id)       -> ['processo', id, 'mensagens']
//   queryKeys.fila()                      -> ['fila']                 (fila geral)
//   queryKeys.dashboard()                 -> ['dashboard']            (indicadores)
//   queryKeys.notificacoes()              -> ['notificacoes']         (painel)
// ---------------------------------------------------------------------------

export const queryKeys = {
  processos: () => ['processos'] as const,
  processo: (id: string) => ['processo', id] as const,
  processoMensagens: (id: string) => ['processo', id, 'mensagens'] as const,
  fila: () => ['fila'] as const,
  dashboard: () => ['dashboard'] as const,
  notificacoes: () => ['notificacoes'] as const,
  // Organizador de Tarefas (Req. 27):
  //   tarefas()        -> ['tarefas']            (lista do painel de tarefas)
  //   minhasTarefas()  -> ['tarefas', 'minhas']  (atribuições do servidor logado)
  tarefas: () => ['tarefas'] as const,
  minhasTarefas: () => ['tarefas', 'minhas'] as const,
} as const;

// ---------------------------------------------------------------------------
// Handlers de invalidação/atualização por evento.
// ---------------------------------------------------------------------------

/**
 * Invalida as queries de um processo específico e das listas que o contêm.
 * Usado por status/etapa/atribuição, que afetam tanto a listagem quanto o
 * detalhe do processo.
 */
function invalidarProcesso(processoId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.processos() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) });
}

function handleStatusAtualizado(payload: ProcessoStatusAtualizadoPayload): void {
  invalidarProcesso(payload.processoId);
}

function handleEtapaAvancada(payload: ProcessoEtapaAvancadaPayload): void {
  invalidarProcesso(payload.processoId);
}

function handleAtribuido(payload: ProcessoAtribuidoPayload): void {
  invalidarProcesso(payload.processoId);
}

function handleNovaMensagem(payload: ProcessoNovaMensagemPayload): void {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.processoMensagens(payload.processoId),
  });
}

function handleFilaNovoProcesso(_payload: FilaNovoProcessoPayload): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.fila() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.processos() });
}

function handleDashboardAtualizar(_payload: DashboardAtualizarPayload): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
}

/**
 * Qualquer evento `tarefa:*` invalida tanto a lista geral do painel de tarefas
 * quanto o agrupamento "minhas tarefas" da dashboard, garantindo a atualização
 * em tempo real (Req. 27.5, 27.6, 27.7, 27.8, 27.9).
 */
function invalidarTarefas(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tarefas() });
}

function handleNotificacaoNova(payload: NotificacaoNovaPayload): void {
  // Alimenta o painel/NotificationBell diretamente pelo store.
  useNotificacaoStore.getState().adicionar({
    id: payload.notificacaoId,
    tipo: payload.tipo,
    conteudo: payload.conteudo,
    lida: false,
    criadaEm: new Date().toISOString(),
  });
  // Também invalida a lista persistida (caso haja fetch inicial de painel).
  void queryClient.invalidateQueries({ queryKey: queryKeys.notificacoes() });
}

/**
 * Registra todos os listeners no socket e devolve uma função de cleanup que os
 * remove. Extraído para facilitar testes unitários (socket + queryClient
 * mockados) sem depender do React.
 */
export function registrarListeners(s: Socket): () => void {
  s.on(SOCKET_EVENTS.processoStatusAtualizado, handleStatusAtualizado);
  s.on(SOCKET_EVENTS.processoEtapaAvancada, handleEtapaAvancada);
  s.on(SOCKET_EVENTS.processoAtribuido, handleAtribuido);
  s.on(SOCKET_EVENTS.processoNovaMensagem, handleNovaMensagem);
  s.on(SOCKET_EVENTS.filaNovoProcesso, handleFilaNovoProcesso);
  s.on(SOCKET_EVENTS.dashboardAtualizar, handleDashboardAtualizar);
  s.on(SOCKET_EVENTS.notificacaoNova, handleNotificacaoNova);
  s.on(SOCKET_EVENTS.tarefaAtribuida, invalidarTarefas);
  s.on(SOCKET_EVENTS.tarefaStatusAtualizado, invalidarTarefas);
  s.on(SOCKET_EVENTS.tarefaProximaVencimento, invalidarTarefas);
  s.on(SOCKET_EVENTS.tarefaVencida, invalidarTarefas);

  return () => {
    s.off(SOCKET_EVENTS.processoStatusAtualizado, handleStatusAtualizado);
    s.off(SOCKET_EVENTS.processoEtapaAvancada, handleEtapaAvancada);
    s.off(SOCKET_EVENTS.processoAtribuido, handleAtribuido);
    s.off(SOCKET_EVENTS.processoNovaMensagem, handleNovaMensagem);
    s.off(SOCKET_EVENTS.filaNovoProcesso, handleFilaNovoProcesso);
    s.off(SOCKET_EVENTS.dashboardAtualizar, handleDashboardAtualizar);
    s.off(SOCKET_EVENTS.notificacaoNova, handleNotificacaoNova);
    s.off(SOCKET_EVENTS.tarefaAtribuida, invalidarTarefas);
    s.off(SOCKET_EVENTS.tarefaStatusAtualizado, invalidarTarefas);
    s.off(SOCKET_EVENTS.tarefaProximaVencimento, invalidarTarefas);
    s.off(SOCKET_EVENTS.tarefaVencida, invalidarTarefas);
  };
}

/**
 * Hook React que ativa o tempo real enquanto o usuário estiver autenticado.
 *
 * - Conecta apenas quando autenticado (guarda contra conexão anônima).
 * - Assina todos os eventos e limpa os listeners no unmount / logout.
 * - Desconecta o socket quando a sessão termina.
 */
export function useSocket(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      // Sem sessão: garante que qualquer conexão anterior seja encerrada.
      disconnectSocket();
      return undefined;
    }

    const s = getSocket();
    const cleanup = registrarListeners(s);
    connectSocket();

    return () => {
      cleanup();
      disconnectSocket();
    };
  }, [isAuthenticated]);
}

export default useSocket;
