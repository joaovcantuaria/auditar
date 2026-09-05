import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { getAuthToken, useAuthStore } from '@/store/authStore';

/**
 * URL base da API. Em produção pode ser sobrescrita por `VITE_API_URL`;
 * caso contrário usa o prefixo relativo `/api/v1` (proxied pelo Vite em dev
 * e servido pelo mesmo host em produção).
 */
const baseURL = import.meta.env.VITE_API_URL ?? '/api/v1';

/** Rotas de login por contexto — usadas no redirecionamento de sessão expirada. */
const LOGIN_CIDADAO = '/login';
const LOGIN_SERVIDOR = '/admin/login';

/**
 * Decide para qual tela de login redirecionar após um 401, com base no path
 * atual: qualquer rota administrativa (`/admin`) volta ao login do servidor.
 */
function resolveLoginPath(): string {
  if (typeof window === 'undefined') return LOGIN_CIDADAO;
  return window.location.pathname.startsWith('/admin') ? LOGIN_SERVIDOR : LOGIN_CIDADAO;
}

/**
 * Instância axios configurada, framework-agnóstica (sem imports de React).
 *
 * - Request: injeta `Authorization: Bearer <token>` lido do authStore via
 *   getter, evitando import circular.
 * - Response: em 401, encerra a sessão (`logout`) e redireciona ao login
 *   correto; demais erros são propagados sem alteração.
 *
 * _Requirements: 8.3, 8.4_
 */
export const axiosInstance: AxiosInstance = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAuthToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Sessão inválida/expirada: limpa o estado e envia ao login apropriado.
      useAuthStore.getState().logout();

      if (typeof window !== 'undefined') {
        const loginPath = resolveLoginPath();
        if (window.location.pathname !== loginPath) {
          window.location.assign(loginPath);
        }
      }
    }
    return Promise.reject(error);
  },
);

export default axiosInstance;
