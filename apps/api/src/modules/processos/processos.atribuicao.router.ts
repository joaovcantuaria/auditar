import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import {
  getCargasDisponiveis,
  postAtribuir,
  postReatribuir,
} from './processos.atribuicao.controller.js';

/**
 * Rotas de Atribuição/Reatribuição de Processos pelo Servidor (Task 7.7, Req 12).
 *
 * Montado sob `/api/v1/admin/processos` pelo agregador de rotas, ao lado de
 * `processosAdminRouter` (tarefa 7.4, `GET /`) e `processosTramitacaoRouter`
 * (tarefa 7.6, `GET /:id` + ações de tramitação). Não há colisão: os caminhos
 * aqui são exclusivos (`/:id/atribuir`, `/:id/atribuir/cargas`,
 * `/:id/reatribuir`).
 *
 *   GET  /:id/atribuir/cargas — carga ativa dos Servidores da Unidade (Req 12.4)
 *   POST /:id/atribuir        — atribui (automatico/manual/fila_geral) (Req 12.1, 12.2, 12.5, 12.7)
 *   POST /:id/reatribuir      — reatribui com justificativa (Req 12.8, 12.9, 12.10)
 *
 * Todas as rotas exigem Servidor autenticado com a permissão ATRIBUIR.
 *
 * Requisitos: 12.1, 12.2, 12.4, 12.5, 12.7, 12.8, 12.9, 12.10
 */
export const processosAtribuicaoRouter = Router();

processosAtribuicaoRouter.use(authenticate, requireServidor);

processosAtribuicaoRouter.get(
  '/:id/atribuir/cargas',
  requirePermission(Permissao.ATRIBUIR),
  getCargasDisponiveis,
);

processosAtribuicaoRouter.post(
  '/:id/atribuir',
  requirePermission(Permissao.ATRIBUIR),
  sanitizeMiddleware,
  postAtribuir,
);

processosAtribuicaoRouter.post(
  '/:id/reatribuir',
  requirePermission(Permissao.ATRIBUIR),
  sanitizeMiddleware,
  postReatribuir,
);

export default processosAtribuicaoRouter;
