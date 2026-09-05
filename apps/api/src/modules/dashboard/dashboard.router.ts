import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  getDashboardAnalista,
  getDashboardGestorUnidade,
  getDashboardGestorCategoria,
  getDashboardGestorGeral,
  getDashboardResumo,
  getDashboardDesempenhoEquipe,
} from './dashboard.controller.js';

/**
 * Rotas de Dashboard por perfil (Task 10.1, Req 9.1–9.4).
 * Montado sob `/api/v1/admin/dashboard` pelo agregador de rotas.
 *
 *   GET /analista           (Req 9.1)
 *   GET /gestor-unidade     (Req 9.2)
 *   GET /gestor-categoria   (Req 9.3)
 *   GET /gestor-geral       (Req 9.4)
 *   GET /resumo             (Req 9.7, 9.8, 9.11, 9.12)
 *   GET /desempenho-equipe  (Req 9.9, 9.10, 9.11, 9.12)
 *
 * Todas exigem servidor autenticado com a permissão ACESSAR_RELATORIOS — o
 * gate mais próximo de "acesso a indicadores" na matriz RBAC.
 */
export const dashboardRouter = Router();

dashboardRouter.use(
  authenticate,
  requireServidor,
  requirePermission(Permissao.ACESSAR_RELATORIOS),
);

dashboardRouter.get('/analista', getDashboardAnalista);
dashboardRouter.get('/gestor-unidade', (req, res) => getDashboardGestorUnidade(req, res));
dashboardRouter.get('/gestor-categoria', (req, res) => getDashboardGestorCategoria(req, res));
dashboardRouter.get('/gestor-geral', getDashboardGestorGeral);
dashboardRouter.get('/resumo', (req, res) => getDashboardResumo(req, res));
dashboardRouter.get('/desempenho-equipe', (req, res) => getDashboardDesempenhoEquipe(req, res));

export default dashboardRouter;
