import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { NivelAcesso, Permissao, ErrorCodes } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import {
  getFormularios,
  getFormularioPorTipoUnidade,
  postFormulario,
  putFormulario,
} from './formularios.controller.js';

/**
 * Rotas de Formulários Dinâmicos.
 *
 * Rota administrativa (`formulariosRouter`), montada sob
 * `/api/v1/admin/config/formularios`:
 *   GET  /        — servidor com permissão VISUALIZAR
 *   POST /        — Administrador (nível 1)
 *   PUT  /:id     — Administrador (nível 1)
 *
 * Rota pública (`formulariosPublicRouter`), montada sob `/api/v1/formularios`,
 * consumida pelo Portal do Cidadão (Req. 16.5):
 *   GET  /?tipoId=&unidadeId=   — sem autenticação
 *
 * Requisitos: 16.1, 16.2, 16.3, 16.4, 16.5
 */

/**
 * Guard: exige que o servidor autenticado seja Administrador (nível 1).
 * Criar/salvar Formulários Dinâmicos é restrito ao Administrador (Req. 16.1).
 */
function requireAdministrador(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'servidor' || req.user?.nivel !== NivelAcesso.ADMINISTRADOR) {
    res.status(403).json({ error: 'Acesso negado', code: ErrorCodes.INSUFFICIENT_PERMISSIONS });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Rota administrativa
// ---------------------------------------------------------------------------

export const formulariosRouter = Router();

formulariosRouter.use(authenticate, requireServidor);

formulariosRouter.get('/', requirePermission(Permissao.VISUALIZAR), getFormularios);
formulariosRouter.post('/', requireAdministrador, sanitizeMiddleware, postFormulario);
formulariosRouter.put('/:id', requireAdministrador, sanitizeMiddleware, putFormulario);

// ---------------------------------------------------------------------------
// Rota pública (Portal do Cidadão) — leitura por Tipo + Unidade
// ---------------------------------------------------------------------------

export const formulariosPublicRouter = Router();

formulariosPublicRouter.get('/', getFormularioPorTipoUnidade);

export default formulariosRouter;
