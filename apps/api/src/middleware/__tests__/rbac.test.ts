import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { NivelAcesso, Permissao, ErrorCodes } from '@auditar/shared';
import { hasPermission, requirePermission, RBAC_MATRIX } from '../rbac.js';
import type { JwtPayload } from '../../lib/jwt.js';

function servidor(nivel: NivelAcesso, permissions?: string[]): JwtPayload {
  return { sub: 's1', role: 'servidor', nivel, permissions, jti: 'j1' };
}

describe('hasPermission — matriz por nível', () => {
  it('Administrador possui todas as permissões', () => {
    const user = servidor(NivelAcesso.ADMINISTRADOR);
    for (const p of Object.values(Permissao)) {
      expect(hasPermission(user, p)).toBe(true);
    }
  });

  it('Gestor Geral: visualizar e relatórios; nega edição', () => {
    const user = servidor(NivelAcesso.GESTOR_GERAL);
    expect(hasPermission(user, Permissao.VISUALIZAR)).toBe(true);
    expect(hasPermission(user, Permissao.ACESSAR_RELATORIOS)).toBe(true);
    expect(hasPermission(user, Permissao.EDITAR)).toBe(false);
    expect(hasPermission(user, Permissao.APROVAR)).toBe(false);
  });

  it('Gestor Categoria: visualizar, obs interna, relatórios, configurar fluxos', () => {
    const user = servidor(NivelAcesso.GESTOR_CATEGORIA);
    expect(hasPermission(user, Permissao.VISUALIZAR)).toBe(true);
    expect(hasPermission(user, Permissao.OBSERVACAO_INTERNA)).toBe(true);
    expect(hasPermission(user, Permissao.ACESSAR_RELATORIOS)).toBe(true);
    expect(hasPermission(user, Permissao.CONFIGURAR_FLUXOS)).toBe(true);
    expect(hasPermission(user, Permissao.EDITAR)).toBe(false);
    expect(hasPermission(user, Permissao.OBSERVACAO_PUBLICA)).toBe(false);
  });

  it('Gestor Unidade: fluxo operacional completo + atribuir/aprovar', () => {
    const user = servidor(NivelAcesso.GESTOR_UNIDADE);
    for (const p of [
      Permissao.VISUALIZAR,
      Permissao.EDITAR,
      Permissao.MOVER_ETAPA,
      Permissao.REJEITAR,
      Permissao.SOLICITAR_DOCUMENTOS,
      Permissao.OBSERVACAO_PUBLICA,
      Permissao.OBSERVACAO_INTERNA,
      Permissao.ACESSAR_RELATORIOS,
      Permissao.ATRIBUIR,
      Permissao.APROVAR,
    ]) {
      expect(hasPermission(user, p)).toBe(true);
    }
    expect(hasPermission(user, Permissao.GERENCIAR_USUARIOS)).toBe(false);
    expect(hasPermission(user, Permissao.ACESSAR_AUDITORIA)).toBe(false);
  });

  it('Analista: edição/mover/solicitar/obs mas NÃO rejeitar/aprovar por padrão', () => {
    const user = servidor(NivelAcesso.ANALISTA);
    expect(hasPermission(user, Permissao.VISUALIZAR)).toBe(true);
    expect(hasPermission(user, Permissao.EDITAR)).toBe(true);
    expect(hasPermission(user, Permissao.MOVER_ETAPA)).toBe(true);
    expect(hasPermission(user, Permissao.SOLICITAR_DOCUMENTOS)).toBe(true);
    expect(hasPermission(user, Permissao.OBSERVACAO_PUBLICA)).toBe(true);
    expect(hasPermission(user, Permissao.OBSERVACAO_INTERNA)).toBe(true);
    expect(hasPermission(user, Permissao.REJEITAR)).toBe(false);
    expect(hasPermission(user, Permissao.APROVAR)).toBe(false);
  });

  it('Inspetor: apenas visualizar e observações', () => {
    const user = servidor(NivelAcesso.INSPETOR);
    expect(hasPermission(user, Permissao.VISUALIZAR)).toBe(true);
    expect(hasPermission(user, Permissao.OBSERVACAO_PUBLICA)).toBe(true);
    expect(hasPermission(user, Permissao.OBSERVACAO_INTERNA)).toBe(true);
    expect(hasPermission(user, Permissao.EDITAR)).toBe(false);
    expect(hasPermission(user, Permissao.MOVER_ETAPA)).toBe(false);
  });

  it('Visualizador: visualizar e relatórios apenas', () => {
    const user = servidor(NivelAcesso.VISUALIZADOR);
    expect(hasPermission(user, Permissao.VISUALIZAR)).toBe(true);
    expect(hasPermission(user, Permissao.ACESSAR_RELATORIOS)).toBe(true);
    expect(hasPermission(user, Permissao.EDITAR)).toBe(false);
    expect(hasPermission(user, Permissao.OBSERVACAO_INTERNA)).toBe(false);
  });
});

describe('hasPermission — override granular', () => {
  it('concede REJEITAR ao Analista quando a permissão granular é atribuída', () => {
    const user = servidor(NivelAcesso.ANALISTA, [Permissao.REJEITAR, Permissao.APROVAR]);
    expect(hasPermission(user, Permissao.REJEITAR)).toBe(true);
    expect(hasPermission(user, Permissao.APROVAR)).toBe(true);
  });

  it('não concede permissão não presente na matriz nem no override', () => {
    const user = servidor(NivelAcesso.ANALISTA, [Permissao.REJEITAR]);
    expect(hasPermission(user, Permissao.GERENCIAR_USUARIOS)).toBe(false);
  });
});

describe('hasPermission — não-servidores', () => {
  it('nega para cidadão', () => {
    const cidadao: JwtPayload = { sub: 'c1', role: 'cidadao', jti: 'j1' };
    expect(hasPermission(cidadao, Permissao.VISUALIZAR)).toBe(false);
  });

  it('nega para undefined', () => {
    expect(hasPermission(undefined, Permissao.VISUALIZAR)).toBe(false);
  });
});

describe('requirePermission middleware', () => {
  function mockRes() {
    const res = {} as Response;
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it('chama next() quando autorizado', () => {
    const req = { user: servidor(NivelAcesso.ADMINISTRADOR) } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    requirePermission(Permissao.GERENCIAR_USUARIOS)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responde 403 AUTH_005 sem revelar detalhes quando negado', () => {
    const req = { user: servidor(NivelAcesso.INSPETOR) } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    requirePermission(Permissao.EDITAR)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Acesso negado',
      code: ErrorCodes.INSUFFICIENT_PERMISSIONS,
    });
  });
});

describe('RBAC_MATRIX integridade', () => {
  it('define uma entrada para cada nível de acesso', () => {
    const niveis = Object.values(NivelAcesso).filter((v) => typeof v === 'number') as number[];
    for (const nivel of niveis) {
      expect(RBAC_MATRIX[nivel as NivelAcesso]).toBeDefined();
    }
  });
});
