import { Router, type Request, type Response, type NextFunction } from 'express';
import { Permissao, ErrorCodes } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  getAuditoria,
  postExportarAuditoria,
  getStatusExportacaoAuditoria,
} from './auditoria.controller.js';

/**
 * Rotas do log de auditoria (Req. 17.2, 17.4, 17.5, 17.6, 17.7).
 * Montado sob `/api/v1/admin/auditoria` pelo agregador de rotas.
 *
 *   GET  /              — listagem paginada com filtros (Req. 17.2, 17.4)
 *   POST /exportar      — solicita job de exportação CSV/PDF (Req. 17.5)
 *   GET  /exportar/:id  — status/download do job (Req. 17.5)
 *
 * SOMENTE LEITURA PARA TODOS OS NÍVEIS, INCLUSIVE ADMINISTRADOR (Req. 17.7):
 * o log de auditoria é imutável. Não há rotas PUT/PATCH/DELETE, e o único POST
 * existente serve exclusivamente para SOLICITAR uma exportação — ele jamais
 * altera um registro do `AuditoriaLog`. O guard {@link somenteLeitura} rejeita
 * de forma defensiva qualquer método de mutação inesperado.
 *
 * Todas as rotas exigem Servidor autenticado com a permissão ACESSAR_AUDITORIA.
 */

/** Métodos HTTP permitidos neste router (leitura + solicitação de export). */
const METODOS_PERMITIDOS = new Set(['GET', 'HEAD', 'POST', 'OPTIONS']);

/** Sufixos de rota onde o POST é aceito (solicitação de exportação). */
const POST_PERMITIDO_EM = /\/exportar\/?$/;

/**
 * Guard defensivo de imutabilidade (Req. 17.7). Bloqueia qualquer tentativa de
 * mutação sobre o log de auditoria:
 *  - PUT/PATCH/DELETE são sempre rejeitados (405).
 *  - POST só é aceito na rota de exportação (`/exportar`); qualquer outro POST
 *    é rejeitado com 405, garantindo que não exista caminho de escrita no log.
 */
export function somenteLeitura(req: Request, res: Response, next: NextFunction): void {
  const metodo = req.method.toUpperCase();

  if (!METODOS_PERMITIDOS.has(metodo)) {
    res
      .status(405)
      .json({ error: 'Auditoria é somente leitura', code: ErrorCodes.INSUFFICIENT_PERMISSIONS });
    return;
  }

  if (metodo === 'POST' && !POST_PERMITIDO_EM.test(req.path)) {
    res
      .status(405)
      .json({ error: 'Auditoria é somente leitura', code: ErrorCodes.INSUFFICIENT_PERMISSIONS });
    return;
  }

  next();
}

export const auditoriaRouter = Router();

auditoriaRouter.use(
  authenticate,
  requireServidor,
  requirePermission(Permissao.ACESSAR_AUDITORIA),
  somenteLeitura,
);

auditoriaRouter.get('/', getAuditoria);
auditoriaRouter.post('/exportar', postExportarAuditoria);
auditoriaRouter.get('/exportar/:jobId', getStatusExportacaoAuditoria);

export default auditoriaRouter;
