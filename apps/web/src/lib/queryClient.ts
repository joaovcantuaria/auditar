import { QueryClient } from '@tanstack/react-query';

/**
 * Instância única do React Query compartilhada por todo o app.
 *
 * Padrões escolhidos:
 * - `staleTime` de 30s: reduz refetches redundantes; atualizações em tempo real
 *   chegam via Socket.io (task 11.3), então não dependemos de polling agressivo.
 * - `retry` 1: uma nova tentativa é suficiente para falhas transitórias; erros
 *   de autenticação (401) são tratados pelo interceptor do axios.
 * - `refetchOnWindowFocus` false: evita recargas inesperadas ao alternar abas.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export default queryClient;
