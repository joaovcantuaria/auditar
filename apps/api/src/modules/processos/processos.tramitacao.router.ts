import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import {
  getProcessoTramitacao,
  getProcessoPdf,
  getTrilhaAuditoria,
  patchProcessoCorretivo,
  postAvancarEtapa,
  postRejeitar,
  postSolicitarDocumentos,
  postObservacao,
} from './processos.tramitacao.controller.js';

/**
 * Rotas de Tramitação de Processo pelo Servidor (Task 7.6, Requisito 11).
 *
 * Montado sob `/api/v1/admin/processos` pelo agregador de rotas, ao lado de
 * `processosAdminRouter` (tarefa 7.4, que define apenas `GET /` — listagem).
 * Não há colisão de rotas: aqui usamos `GET /:id` e as ações POST em
 * subcaminhos (`/:id/avancar-etapa`, etc.), enquanto o admin router só trata
 * a raiz `GET /`.
 *
 *   GET  /:id                    — detalhe administrativo (Req 11.1, 24.1, 24.3)
 *   GET  /:id/pdf                 — PDF consolidado do processo (Req 26.1-26.6)
 *   GET  /:id/auditoria           — trilha de auditoria do processo (Req 24.2)
 *   PATCH /:id                    — edição corretiva de dados (Req 24.4-24.7)
 *   POST /:id/avancar-etapa       — avança/finaliza o processo (Req 11.2, 11.3, 11.9)
 *   POST /:id/rejeitar            — rejeita o processo (Req 11.7)
 *   POST /:id/solicitar-documentos — solicita documentos ao cidadão (Req 11.6)
 *   POST /:id/observacoes         — registra observação interna/pública (Req 11.4, 11.5)
 *
 * Todas as rotas exigem Servidor autenticado. As permissões estáveis são
 * aplicadas por middleware (`requirePermission`); as condicionais ao conteúdo
 * (aprovação, rejeição, tipo de observação) são checadas no controller.
 *
 * Requisitos: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9, 24.1, 24.2,
 * 24.3, 24.4, 24.5, 24.7
 */
export const processosTramitacaoRouter = Router();

processosTramitacaoRouter.use(authenticate, requireServidor);

// PDF consolidado do Processo (Req 26) — rota mais específica antes de `GET /:id`.
processosTramitacaoRouter.get(
  '/:id/pdf',
  requirePermission(Permissao.VISUALIZAR),
  getProcessoPdf,
);

// Trilha de auditoria (Req 24.2) — rota mais específica antes de `GET /:id`.
processosTramitacaoRouter.get(
  '/:id/auditoria',
  requirePermission(Permissao.VISUALIZAR),
  getTrilhaAuditoria,
);

processosTramitacaoRouter.get(
  '/:id',
  requirePermission(Permissao.VISUALIZAR),
  getProcessoTramitacao,
);

// Edição_Corretiva de dados do Processo (Req 24.4-24.7) — exige `editar`.
processosTramitacaoRouter.patch(
  '/:id',
  requirePermission(Permissao.EDITAR),
  sanitizeMiddleware,
  patchProcessoCorretivo,
);

processosTramitacaoRouter.post(
  '/:id/avancar-etapa',
  requirePermission(Permissao.MOVER_ETAPA),
  sanitizeMiddleware,
  postAvancarEtapa,
);

// Permissão REJEITAR verificada no controller (mensagem orientativa custom, Req 11.7).
processosTramitacaoRouter.post('/:id/rejeitar', sanitizeMiddleware, postRejeitar);

processosTramitacaoRouter.post(
  '/:id/solicitar-documentos',
  requirePermission(Permissao.SOLICITAR_DOCUMENTOS),
  sanitizeMiddleware,
  postSolicitarDocumentos,
);

// Permissão por conteúdo (interna vs pública) verificada no controller (Req 11.4/11.5).
processosTramitacaoRouter.post('/:id/observacoes', sanitizeMiddleware, postObservacao);

export default processosTramitacaoRouter;
