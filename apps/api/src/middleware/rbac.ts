import type { Request, Response, NextFunction } from 'express';
import { Permissao, ErrorCodes, RBAC_MATRIX_POR_NIVEL, temPermissao } from '@auditar/shared';
import type { JwtPayload } from '../lib/jwt.js';

/**
 * Matriz de permissões por nível de acesso.
 *
 * Reexportada da fonte única de verdade em `@auditar/shared` (`RBAC_MATRIX_POR_NIVEL`)
 * para que backend e frontend apliquem EXATAMENTE a mesma regra. Mantida sob o
 * nome histórico `RBAC_MATRIX` por compatibilidade com os consumidores/testes.
 */
export const RBAC_MATRIX = RBAC_MATRIX_POR_NIVEL;

/**
 * Verifica se o usuário possui a permissão informada.
 *
 * A verificação combina duas fontes (delegadas à função compartilhada
 * `temPermissao` do `@auditar/shared`):
 * 1. A matriz base do nível de acesso (`req.user.nivel`).
 * 2. As permissões granulares em cache no token (`req.user.permissions`),
 *    que funcionam como override aditivo (ex.: Analista com REJEITAR concedido).
 *
 * @param user payload do JWT
 * @param permissao permissão requerida
 * @returns true quando o usuário está autorizado
 */
export function hasPermission(user: JwtPayload | undefined, permissao: Permissao): boolean {
  if (!user || user.role !== 'servidor') return false;

  return temPermissao(user.nivel, user.permissions as Permissao[] | undefined, permissao);
}

/**
 * Middleware factory: exige uma permissão específica.
 * Em caso de negação responde 403 com `code: AUTH_005`, sem revelar
 * qual permissão faltou nem o nível do usuário.
 */
export function requirePermission(permissao: Permissao) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hasPermission(req.user, permissao)) {
      res.status(403).json({ error: 'Acesso negado', code: ErrorCodes.INSUFFICIENT_PERMISSIONS });
      return;
    }
    next();
  };
}
