import { Router } from 'express';
import { authenticate, requireCidadao } from '../../middleware/auth.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import { getMeusProcessos, postProcesso } from './processos.controller.js';

/**
 * Rotas de criação e listagem de Processos pelo Cidadão (Req. 3, 4).
 * Montado sob `/api/v1/processos` pelo agregador de rotas.
 *
 *   GET  / — listar os Processos do Cidadão autenticado (com filtros)
 *   POST / — criar um novo Processo (submissão da etapa 6 do wizard)
 *
 * Mantido separado de `processos.admin.router.ts` (listagem/tramitação pelo
 * Servidor) para evitar conflito de arquivos. Todas as rotas exigem um
 * Cidadão autenticado.
 *
 * Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13
 */
export const processosCidadaoRouter = Router();

processosCidadaoRouter.use(authenticate, requireCidadao);

processosCidadaoRouter.get('/', getMeusProcessos);
processosCidadaoRouter.post('/', sanitizeMiddleware, postProcesso);

export default processosCidadaoRouter;
