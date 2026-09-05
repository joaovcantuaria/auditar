import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore, type UserRole } from '@/store/authStore';

export interface PrivateRouteProps {
  /**
   * Rota de login para redirecionar quando não autenticado. Como o Portal e o
   * Painel têm telas de login distintas, cada grupo de rotas informa a sua.
   */
  loginPath: string;
  /** Elemento a renderizar quando autenticado. Se omitido, usa `<Outlet/>`. */
  children?: ReactElement;
}

/**
 * Protege rotas que exigem autenticação. Quando não autenticado, redireciona
 * para `loginPath`, preservando a rota pretendida em `state.from` para retorno
 * pós-login.
 *
 * _Requirements: 8.3, 8.4_
 */
export function PrivateRoute({ loginPath, children }: PrivateRouteProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace state={{ from: location }} />;
  }

  return children ?? <Outlet />;
}

export interface RoleRouteProps {
  /** Papel exigido para acessar as rotas filhas. */
  role: UserRole;
  /**
   * Para onde redirecionar quando o papel não corresponde. Normalmente a home
   * do papel real do usuário ou a tela de login apropriada.
   */
  redirectTo: string;
  children?: ReactElement;
}

/**
 * Restringe rotas a um papel específico (ex.: área `/admin` só para servidores).
 * Assume que a autenticação já foi verificada por um `PrivateRoute` ancestral;
 * se não houver usuário, também redireciona.
 */
export function RoleRoute({ role, redirectTo, children }: RoleRouteProps) {
  const user = useAuthStore((s) => s.user);

  if (!user || user.role !== role) {
    return <Navigate to={redirectTo} replace />;
  }

  return children ?? <Outlet />;
}
