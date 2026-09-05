import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import {
  getDocumentos,
  postGerarUploadUrl,
  postConfirmarDocumento,
  getDownloadUrl,
} from './documentos.controller.js';

/**
 * Rotas de Upload/Download de Documentos via MinIO (Task 7.2).
 *
 *   GET  /                    — lista os documentos do processo
 *   POST /upload-url          — gera presigned URL de upload (expira em 5min)
 *   POST /                    — confirma o upload já realizado no MinIO
 *   GET  /:docId/download     — gera presigned URL de download (expira em 5min)
 *
 * Este router usa `{ mergeParams: true }` para herdar `req.params.id` (o id do
 * Processo) do router pai. Ele deve ser montado (pelo agregador de rotas) em
 * AMBOS os pontos abaixo:
 *
 *   - `/api/v1/processos/:id/documentos`        (Portal do Cidadão — Req. 4.5, 5.4)
 *   - `/api/v1/admin/processos/:id/documentos`  (Painel Administrativo — Req. 5.4)
 *
 * A autorização por ownership (cidadão só acessa documentos de seus próprios
 * Processos) é feita na camada de serviço (`gerarDownloadUrl`); a autorização
 * de Servidor (RBAC) é responsabilidade do router administrativo que monta
 * este router sob `/admin` (ex.: `authenticate + requireServidor + requirePermission`
 * antes de delegar a este router).
 *
 * Requisitos: 4.5, 4.7, 5.4
 */
export const documentosRouter = Router({ mergeParams: true });

documentosRouter.use(authenticate);

documentosRouter.get('/', getDocumentos);
documentosRouter.post('/upload-url', postGerarUploadUrl);
documentosRouter.post('/', postConfirmarDocumento);
documentosRouter.get('/:docId/download', getDownloadUrl);

export default documentosRouter;
