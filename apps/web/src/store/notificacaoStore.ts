import { create } from 'zustand';

/**
 * Notificação exibida no painel/NotificationBell.
 *
 * Mantida propositalmente enxuta e independente do tipo `Notificacao` do banco
 * (que possui campos extras de persistência). É alimentada pelo hook de socket
 * da task 11.3 (`useNotificacoes`) e consumida pelo `NotificationBell`.
 */
export interface Notificacao {
  id: string;
  /** Categoria/evento da notificação (ex.: 'nova_mensagem', 'movimentacao_etapa'). */
  tipo: string;
  /** Texto legível exibido ao usuário. */
  conteudo: string;
  /** Indica se já foi lida. */
  lida: boolean;
  /** Momento de criação em ISO 8601. */
  criadaEm: string;
}

export interface NotificacaoState {
  notificacoes: Notificacao[];
  /** Contador derivado de notificações não lidas. */
  naoLidas: number;

  /** Adiciona uma notificação ao topo da lista (mais recente primeiro). */
  adicionar: (notificacao: Notificacao) => void;
  /** Marca uma notificação específica como lida. */
  marcarComoLida: (id: string) => void;
  /** Marca todas como lidas. */
  marcarTodasComoLidas: () => void;
  /** Substitui a lista completa (ex.: carga inicial vinda da API). */
  setNotificacoes: (lista: Notificacao[]) => void;
}

/** Conta quantas notificações da lista ainda não foram lidas. */
function contarNaoLidas(lista: Notificacao[]): number {
  return lista.reduce((total, n) => (n.lida ? total : total + 1), 0);
}

/**
 * Store de notificações em memória (não persistido — a fonte de verdade é a
 * API/socket). Mantém `naoLidas` sempre em sincronia com a lista.
 */
export const useNotificacaoStore = create<NotificacaoState>((set) => ({
  notificacoes: [],
  naoLidas: 0,

  adicionar: (notificacao) =>
    set((state) => {
      // Evita duplicatas por id (reconexões de socket podem reenviar).
      if (state.notificacoes.some((n) => n.id === notificacao.id)) {
        return state;
      }
      const notificacoes = [notificacao, ...state.notificacoes];
      return { notificacoes, naoLidas: contarNaoLidas(notificacoes) };
    }),

  marcarComoLida: (id) =>
    set((state) => {
      const notificacoes = state.notificacoes.map((n) =>
        n.id === id ? { ...n, lida: true } : n,
      );
      return { notificacoes, naoLidas: contarNaoLidas(notificacoes) };
    }),

  marcarTodasComoLidas: () =>
    set((state) => ({
      notificacoes: state.notificacoes.map((n) => ({ ...n, lida: true })),
      naoLidas: 0,
    })),

  setNotificacoes: (lista) =>
    set({ notificacoes: lista, naoLidas: contarNaoLidas(lista) }),
}));
