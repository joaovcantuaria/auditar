import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NivelAcesso, Permissao } from '@auditar/shared';
import { temPermissao } from '@auditar/shared';

/**
 * Tipo do ator autenticado, espelhando o payload do JWT emitido pela API
 * (`apps/api/src/lib/jwt.ts`). Apenas os campos relevantes ao cliente são
 * mantidos — o token cru continua sendo a fonte de verdade do servidor.
 */
export type UserRole = 'cidadao' | 'servidor';

export interface AuthUser {
  /** userId (Cidadao.id ou Servidor.id) — corresponde ao `sub` do JWT. */
  sub: string;
  /** Tipo de ator autenticado. */
  role: UserRole;
  /** Nome de exibição (opcional; a API pode preenchê-lo no login). */
  nome?: string;
  /** Nível de acesso — apenas servidores. */
  nivel?: NivelAcesso;
  /** Permissões granulares — apenas servidores. */
  permissions?: Permissao[];
}

export interface AuthState {
  /** JWT bruto ou null quando deslogado. */
  token: string | null;
  /** Dados do usuário definidos no momento do login. */
  user: AuthUser | null;
  /** Derivado de `token`; conveniência para guards e UI. */
  isAuthenticated: boolean;

  /** Persiste o token + usuário e marca a sessão como autenticada. */
  login: (token: string, user: AuthUser) => void;
  /** Limpa a sessão (usado no logout manual e no 401 do axios). */
  logout: () => void;
  /** Atualiza apenas o token (ex.: refresh), preservando o usuário. */
  setToken: (token: string | null) => void;

  /**
   * True se o usuário possui a permissão indicada — considerando tanto a
   * matriz do seu nível de acesso quanto suas permissões granulares.
   */
  hasPermission: (permissao: Permissao) => boolean;
  /** True se o usuário tem o papel indicado. */
  hasRole: (role: UserRole) => boolean;
}

/**
 * Store de autenticação (Zustand + persist).
 *
 * O token é persistido em `localStorage` para que recarregar a página mantenha
 * a sessão. Nenhuma decodificação é feita no cliente — confiamos no objeto
 * `user` definido no login. O guardado é intencionalmente restrito a
 * `token`/`user`; `isAuthenticated` é reidratado a partir do token.
 *
 * _Requirements: 8.3, 8.4_
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      login: (token, user) => set({ token, user, isAuthenticated: true }),

      logout: () => set({ token: null, user: null, isAuthenticated: false }),

      setToken: (token) => set({ token, isAuthenticated: Boolean(token) }),

      hasPermission: (permissao) => {
        const { user } = get();
        // Servidor autoriza por nível (matriz RBAC) + permissões granulares;
        // cidadão nunca possui permissões de painel.
        if (!user || user.role !== 'servidor') return false;
        return temPermissao(user.nivel, user.permissions, permissao);
      },

      hasRole: (role) => get().user?.role === role,
    }),
    {
      name: 'auditar-auth',
      // Persistimos somente o essencial; isAuthenticated é derivado na
      // reidratação para evitar estados inconsistentes.
      partialize: (state) => ({ token: state.token, user: state.user }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = Boolean(state.token);
        }
      },
    },
  ),
);

/**
 * Getter framework-agnóstico do token, seguro para uso fora de componentes
 * React (ex.: interceptors do axios) — evita import circular ao ler o estado
 * diretamente do store.
 */
export function getAuthToken(): string | null {
  return useAuthStore.getState().token;
}
