import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import { getFluxos, getFluxo, postFluxo, putFluxo } from './fluxos.controller.js';

/**
 * Rotas de configuração de Fluxos de Processo (Painel Administrativo).
 *
 *   GET    /        — servidor com permissão VISUALIZAR
 *   GET    /:id     — servidor com permissão VISUALIZAR
 *   POST   /        — Administrador ou Gestor de Categoria (CONFIGURAR_FLUXOS)
 *   PUT    /:id     — Administrador ou Gestor de Categoria (CONFIGURAR_FLUXOS)
 *
 * Criar/editar Fluxos é restrito a quem possui a permissão CONFIGURAR_FLUXOS,
 * que na matriz RBAC pertence ao Administrador e ao Gestor de Categoria (Req. 15).
 * Todas exigem servidor autenticado. Requisitos: 15.1–15.8.
 */

export const fluxosRouter = Router();

fluxosRouter.use(authenticate, requireServidor);

fluxosRouter.get('/', requirePermission(Permissao.VISUALIZAR), getFluxos);
fluxosRouter.get('/:id', requirePermission(Permissao.VISUALIZAR), getFluxo);
fluxosRouter.post('/', requirePermission(Permissao.CONFIGURAR_FLUXOS), sanitizeMiddleware, postFluxo);
fluxosRouter.put('/:id', requirePermission(Permissao.CONFIGURAR_FLUXOS), sanitizeMiddleware, putFluxo);

export default fluxosRouter;
