import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { NivelAcesso, Permissao, ErrorCodes } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import {
  getCategorias,
  postCategoria,
  patchCategoria,
  deleteCategoria,
} from './categorias.controller.js';

/**
 * Rotas de configuração de Categorias.
 * Montado sob `/api/v1/admin/config/categorias` pelo agregador de rotas.
 *
 *   GET    /        — servidor com permissão VISUALIZAR
 *   POST   /        — Administrador (nível 1)
 *   PATCH  /:id     — Administrador (nível 1)
 *   DELETE /:id     — Administrador (nível 1) — aceita `?confirmar=true`
 *
 * Requisitos: 14.1, 14.2, 14.6, 14.7
 */

/**
 * Guard: exige que o servidor autenticado seja Administrador (nível 1).
 * Criar/editar/desativar Categorias é restrito ao Administrador (Req. 14.1).
 */
function requireAdministrador(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'servidor' || req.user?.nivel !== NivelAcesso.ADMINISTRADOR) {
    res.status(403).json({ error: 'Acesso negado', code: ErrorCodes.INSUFFICIENT_PERMISSIONS });
    return;
  }
  next();
}

export const categoriasRouter = Router();

categoriasRouter.use(authenticate, requireServidor);

categoriasRouter.get('/', requirePermission(Permissao.VISUALIZAR), getCategorias);
categoriasRouter.post('/', requireAdministrador, sanitizeMiddleware, postCategoria);
categoriasRouter.patch('/:id', requireAdministrador, sanitizeMiddleware, patchCategoria);
categoriasRouter.delete('/:id', requireAdministrador, deleteCategoria);

export default categoriasRouter;
