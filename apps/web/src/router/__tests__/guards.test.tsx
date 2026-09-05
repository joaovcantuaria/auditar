import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore, type AuthUser } from '@/store/authStore';
import { PrivateRoute, RoleRoute } from '../guards';

const servidor: AuthUser = { sub: 's1', role: 'servidor' };
const cidadao: AuthUser = { sub: 'c1', role: 'cidadao' };

/** Monta uma árvore de rotas mínima com destinos de login/redirect distintos. */
function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Portal Login</div>} />
        <Route path="/admin/login" element={<div>Admin Login</div>} />
        <Route path="/" element={<div>Portal Home</div>} />

        <Route element={<PrivateRoute loginPath="/admin/login" />}>
          <Route element={<RoleRoute role="servidor" redirectTo="/" />}>
            <Route path="/admin" element={<div>Admin Area</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('PrivateRoute + RoleRoute', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    localStorage.clear();
  });

  it('redirects unauthenticated users to the configured login', () => {
    renderAt('/admin');
    expect(screen.getByText('Admin Login')).toBeInTheDocument();
    expect(screen.queryByText('Admin Area')).not.toBeInTheDocument();
  });

  it('renders the protected content for the correct role', () => {
    useAuthStore.getState().login('tok', servidor);
    renderAt('/admin');
    expect(screen.getByText('Admin Area')).toBeInTheDocument();
  });

  it('redirects authenticated users with the wrong role', () => {
    useAuthStore.getState().login('tok', cidadao);
    renderAt('/admin');
    expect(screen.getByText('Portal Home')).toBeInTheDocument();
    expect(screen.queryByText('Admin Area')).not.toBeInTheDocument();
  });
});
