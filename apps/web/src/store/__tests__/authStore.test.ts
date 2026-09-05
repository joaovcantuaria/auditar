import { beforeEach, describe, expect, it } from 'vitest';
import { NivelAcesso, Permissao } from '@auditar/shared';
import { getAuthToken, useAuthStore, type AuthUser } from '../authStore';

const cidadao: AuthUser = { sub: 'c1', role: 'cidadao', nome: 'Maria' };
const servidor: AuthUser = {
  sub: 's1',
  role: 'servidor',
  nome: 'João',
  permissions: [Permissao.ACESSAR_RELATORIOS, Permissao.MOVER_ETAPA],
};

describe('authStore', () => {
  beforeEach(() => {
    // Reseta o estado entre testes.
    useAuthStore.getState().logout();
    localStorage.clear();
  });

  it('starts unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('login stores token/user and flips isAuthenticated', () => {
    useAuthStore.getState().login('tok-123', cidadao);
    const state = useAuthStore.getState();
    expect(state.token).toBe('tok-123');
    expect(state.user).toEqual(cidadao);
    expect(state.isAuthenticated).toBe(true);
  });

  it('logout clears the session', () => {
    useAuthStore.getState().login('tok-123', cidadao);
    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('setToken(null) marks the session unauthenticated', () => {
    useAuthStore.getState().login('tok-123', cidadao);
    useAuthStore.getState().setToken(null);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('hasRole reflects the current user role', () => {
    useAuthStore.getState().login('tok', servidor);
    expect(useAuthStore.getState().hasRole('servidor')).toBe(true);
    expect(useAuthStore.getState().hasRole('cidadao')).toBe(false);
  });

  it('hasPermission checks granular permissions', () => {
    useAuthStore.getState().login('tok', servidor);
    expect(useAuthStore.getState().hasPermission(Permissao.ACESSAR_RELATORIOS)).toBe(true);
    expect(useAuthStore.getState().hasPermission(Permissao.GERENCIAR_USUARIOS)).toBe(false);
  });

  it('hasPermission is false when the user has no permissions array', () => {
    useAuthStore.getState().login('tok', cidadao);
    expect(useAuthStore.getState().hasPermission(Permissao.ACESSAR_RELATORIOS)).toBe(false);
  });

  it('hasPermission autoriza pela matriz do nível quando sem permissões granulares', () => {
    // Administrador criado pelo seed: nível 1 e permissions vazio/ausente.
    // Deve receber todas as permissões via matriz RBAC do nível.
    const admin: AuthUser = {
      sub: 'a1',
      role: 'servidor',
      nome: 'Admin',
      nivel: NivelAcesso.ADMINISTRADOR,
      permissions: [],
    };
    useAuthStore.getState().login('tok', admin);
    const state = useAuthStore.getState();
    expect(state.hasPermission(Permissao.GERENCIAR_USUARIOS)).toBe(true);
    expect(state.hasPermission(Permissao.CONFIGURAR_FLUXOS)).toBe(true);
    expect(state.hasPermission(Permissao.ACESSAR_RELATORIOS)).toBe(true);
    expect(state.hasPermission(Permissao.ACESSAR_AUDITORIA)).toBe(true);
  });

  it('getAuthToken returns the stored token (framework-agnostic getter)', () => {
    expect(getAuthToken()).toBeNull();
    useAuthStore.getState().login('tok-xyz', cidadao);
    expect(getAuthToken()).toBe('tok-xyz');
  });
});
