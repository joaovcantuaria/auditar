import { Router, type Request, type Response, type NextFunction } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireCidadao, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  getDocumentos,
  postGerarUploadUrl,
  postConfirmarDocumento,
  getDownloadUrl,
  handleDocumentosError,
} from './documentos.controller.js';
import { verificarAcessoProcesso } from './documentos.service.js';

/**
 * Rotas de Upload/Download de Documentos via MinIO (Task 7.2).
 *
 *   GET  /                    — lista os documentos do processo
 *   POST /upload-url          — gera presigned URL de upload (expira em 5min)
 *   POST /                    — confirma o upload já realizado no MinIO
 *   GET  /:docId/download     — gera presigned URL de download (expira em 5min)
 *
 * Há DOIS routers (ambos com `{ mergeParams: true }` para herdar `:id`):
 *
 *   - `documentosCidadaoRouter`  → `/api/v1/processos/:id/documentos`
 *       exige cidadão autenticado E dono do Processo (404 caso contrário).
 *   - `documentosServidorRouter` → `/api/v1/admin/processos/:id/documentos`
 *       exige servidor com `visualizar` (leitura) / `editar` (envio).
 *
 * Em ambos, o download também confere que `:docId` pertence ao Processo `:id`.
 *
 * Requisitos: 4.5, 4.7, 5.4
 */

/** Middleware: o Processo `:id` deve existir e pertencer ao cidadão logado. */
async function exigirDonoDoProcesso(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await verificarAcessoProcesso(req.params.id, req.user?.sub);
    next();
  } catch (err) {
    handleDocumentosError(err, res);
  }
}

/** Middleware: o Processo `:id` deve existir (servidor já autorizado pelo RBAC). */
async function exigirProcessoExistente(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await verificarAcessoProcesso(req.params.id, undefined);
    next();
  } catch (err) {
    handleDocumentosError(err, res);
  }
}

export const documentosCidadaoRouter = Router({ mergeParams: true });

documentosCidadaoRouter.use(authenticate, requireCidadao, exigirDonoDoProcesso);

documentosCidadaoRouter.get('/', getDocumentos);
documentosCidadaoRouter.post('/upload-url', postGerarUploadUrl);
documentosCidadaoRouter.post('/', postConfirmarDocumento);
documentosCidadaoRouter.get('/:docId/download', getDownloadUrl);

export const documentosServidorRouter = Router({ mergeParams: true });

documentosServidorRouter.use(
  authenticate,
  requireServidor,
  requirePermission(Permissao.VISUALIZAR),
  exigirProcessoExistente,
);

documentosServidorRouter.get('/', getDocumentos);
documentosServidorRouter.post('/upload-url', requirePermission(Permissao.EDITAR), postGerarUploadUrl);
documentosServidorRouter.post('/', requirePermission(Permissao.EDITAR), postConfirmarDocumento);
documentosServidorRouter.get('/:docId/download', getDownloadUrl);
