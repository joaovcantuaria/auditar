import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { NivelAcesso, Permissao, ErrorCodes } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import { getTipos, postTipo, patchTipo, deleteTipo } from './tipos.controller.js';

/**
 * Rotas de configuração de Tipos de Processo (Painel Administrativo).
 * Montado sob `/api/v1/admin/config/tipos-processo` pelo agregador de rotas.
 *
 *   GET    /        — servidor com permissão VISUALIZAR
 *   POST   /        — Administrador (nível 1)
 *   PATCH  /:id     — Administrador (nível 1)
 *   DELETE /:id     — Administrador (nível 1) — aceita `?confirmar=true`
 *
 * Todas exigem servidor autenticado. Requisitos: 14.3, 14.4, 14.6, 14.7.
 */

/**
 * Guard: exige que o servidor autenticado seja Administrador (nível 1).
 * Criar/editar/desativar Tipos de Processo é restrito ao Administrador (Req. 14.3),
 * espelhando a política já adotada para Categorias.
 */
function requireAdministrador(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'servidor' || req.user?.nivel !== NivelAcesso.ADMINISTRADOR) {
    res.status(403).json({ error: 'Acesso negado', code: ErrorCodes.INSUFFICIENT_PERMISSIONS });
    return;
  }
  next();
}

export const tiposProcessoRouter = Router();

tiposProcessoRouter.use(authenticate, requireServidor);

tiposProcessoRouter.get('/', requirePermission(Permissao.VISUALIZAR), getTipos);
tiposProcessoRouter.post('/', requireAdministrador, sanitizeMiddleware, postTipo);
tiposProcessoRouter.patch('/:id', requireAdministrador, sanitizeMiddleware, patchTipo);
tiposProcessoRouter.delete('/:id', requireAdministrador, deleteTipo);

export default tiposProcessoRouter;
