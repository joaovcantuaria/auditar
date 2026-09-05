import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  getRelatorio,
  postExportarRelatorio,
  getStatusExportacaoRelatorio,
} from './relatorios.controller.js';

/**
 * Rotas de Relatórios e Métricas (Req. 18).
 * Montado sob `/api/v1/admin/relatorios` pelo agregador de rotas.
 *
 *   GET  /              — gera relatório com filtros (Req. 18.1, 18.2)
 *   POST /exportar      — solicita job de exportação CSV/PDF (Req. 18.4, 18.5)
 *   GET  /exportar/:id  — status/download do job (Req. 18.5)
 *
 * Todas as rotas exigem Servidor autenticado com a permissão ACESSAR_RELATORIOS.
 */
export const relatoriosRouter = Router();

relatoriosRouter.use(
  authenticate,
  requireServidor,
  requirePermission(Permissao.ACESSAR_RELATORIOS),
);

relatoriosRouter.get('/', getRelatorio);
relatoriosRouter.post('/exportar', postExportarRelatorio);
relatoriosRouter.get('/exportar/:jobId', getStatusExportacaoRelatorio);

export default relatoriosRouter;
