import { describe, expect, it } from 'vitest';
import { Permissao } from '@auditar/shared';
import { getNavItems } from '../navConfig';
import type { AuthUser } from '@/store/authStore';

describe('getNavItems (RBAC)', () => {
  it('returns no items when there is no user', () => {
    expect(getNavItems(null)).toEqual([]);
  });

  it('returns the citizen portal menu for cidadao', () => {
    const user: AuthUser = { sub: 'c1', role: 'cidadao' };
    const labels = getNavItems(user).map((i) => i.label);
    expect(labels).toEqual(['Meus Processos', 'Novo Processo', 'Perfil', 'Configurações']);
  });

  it('shows only unrestricted admin items for a servidor with no permissions', () => {
    const user: AuthUser = { sub: 's1', role: 'servidor', permissions: [] };
    const labels = getNavItems(user).map((i) => i.label);
    expect(labels).toEqual(['Dashboard', 'Processos']);
  });

  it('reveals permission-gated items when the servidor has the permission', () => {
    const user: AuthUser = {
      sub: 's1',
      role: 'servidor',
      permissions: [Permissao.ACESSAR_RELATORIOS, Permissao.ACESSAR_AUDITORIA],
    };
    const labels = getNavItems(user).map((i) => i.label);
    expect(labels).toContain('Relatórios');
    expect(labels).toContain('Auditoria');
    // Sem GERENCIAR_USUARIOS/CONFIGURAR_FLUXOS, estes ficam ocultos.
    expect(labels).not.toContain('Servidores');
    expect(labels).not.toContain('Configurações');
  });

  it('reveals config and servidores for a full-permission servidor', () => {
    const user: AuthUser = {
      sub: 's1',
      role: 'servidor',
      permissions: [
        Permissao.CONFIGURAR_FLUXOS,
        Permissao.GERENCIAR_USUARIOS,
        Permissao.ACESSAR_RELATORIOS,
        Permissao.ACESSAR_AUDITORIA,
      ],
    };
    const labels = getNavItems(user).map((i) => i.label);
    expect(labels).toEqual([
      'Dashboard',
      'Processos',
      'Configurações',
      'Servidores',
      'Relatórios',
      'Auditoria',
    ]);
  });
});
