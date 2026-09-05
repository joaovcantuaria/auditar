import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import { getProcessosAdmin } from './processos.admin.controller.js';
import { postAbrirProcessoAdmin } from './processos.abertura.controller.js';

/**
 * Rotas administrativas de listagem/busca e abertura de processos (Req. 10, 23).
 * Montado sob `/api/v1/admin/processos` pelo agregador de rotas.
 *
 *   GET  / — listagem paginada com filtros/ordenação, ou busca rápida via `?q=`
 *   POST / — abertura de Processo em nome de um Cidadão (Req. 23)
 *
 * Mantido separado de `processos.router.ts` (criação pelo Cidadão, tarefa 7.1)
 * para evitar conflito de arquivos. Todas as rotas exigem Servidor autenticado
 * com a permissão de visualização; a abertura exige adicionalmente a permissão
 * `editar` (Req. 23.1) — níveis com `editar` também possuem `visualizar`, então
 * não há conflito com o guard de router.
 *
 * Requisitos: 10.1–10.8, 23.1, 23.4, 23.5, 23.6, 23.7
 */
export const processosAdminRouter = Router();

processosAdminRouter.use(authenticate, requireServidor, requirePermission(Permissao.VISUALIZAR));

processosAdminRouter.get('/', getProcessosAdmin);

processosAdminRouter.post(
  '/',
  requirePermission(Permissao.EDITAR),
  sanitizeMiddleware,
  postAbrirProcessoAdmin,
);

export default processosAdminRouter;
