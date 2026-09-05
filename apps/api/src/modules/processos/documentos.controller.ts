import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { arquivoInputSchema, confirmarDocumentoSchema } from './documentos.schema.js';
import {
  gerarUploadUrl,
  confirmarUpload,
  gerarDownloadUrl,
  listarDocumentos,
  obterUnidadeDoProcesso,
  type AtorDocumento,
} from './documentos.service.js';

/**
 * Controllers HTTP do Upload/Download de Documentos via MinIO (Task 7.2).
 *
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`ZodError`, `AppError`) na forma de resposta `ApiError` (`{ error, code, field? }`).
 * O binário do arquivo nunca passa por aqui — apenas metadados e presigned URLs.
 *
 * Requisitos: 4.5, 4.7, 5.4
 */

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Extrai o ator autenticado (cidadão ou servidor) da requisição para a Auditoria. */
function resolveAtor(req: Request): AtorDocumento {
  const enderecoIp = resolveIp(req);
  if (req.user?.role === 'cidadao') {
    return { ator: 'cidadao', atorCidadaoId: req.user.sub, enderecoIp };
  }
  return { ator: 'servidor', atorServidorId: req.user?.sub, enderecoIp };
}

/** Mapeia um erro conhecido para uma resposta HTTP; loga e responde 500 caso contrário. */
function handleError(err: unknown, res: Response): void {
  if (err instanceof ZodError) {
    const first = err.errors[0];
    res.status(400).json({
      error: first?.message ?? 'Dados inválidos',
      code: ErrorCodes.VALIDATION_ERROR,
      field: first?.path?.join('.') || undefined,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code, field: err.field });
    return;
  }

  console.error(
    JSON.stringify({
      level: 'error',
      scope: 'documentos.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * POST /api/v1/processos/:id/documentos/upload-url
 * POST /api/v1/admin/processos/:id/documentos/upload-url
 *
 * Valida os metadados do arquivo e devolve uma presigned URL de upload direto
 * ao MinIO (Req. 4.5, 4.7, 5.4).
 */
export async function postGerarUploadUrl(req: Request, res: Response): Promise<void> {
  try {
    const arquivo = arquivoInputSchema.parse(req.body);
    const processoId = req.params.id;
    const unidadeId = await obterUnidadeDoProcesso(processoId);
    const resultado = await gerarUploadUrl(processoId, unidadeId, arquivo, resolveAtor(req));
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/processos/:id/documentos
 * POST /api/v1/admin/processos/:id/documentos
 *
 * Confirma um upload já realizado no MinIO, persistindo o `Documento`
 * (Req. 4.5, 5.4).
 */
export async function postConfirmarDocumento(req: Request, res: Response): Promise<void> {
  try {
    const dto = confirmarDocumentoSchema.parse(req.body);
    const { caminhoStorage, ...arquivo } = dto;
    const enviadoPorCidadao = req.user?.role === 'cidadao';
    const enviadoPorId = req.user?.sub ?? 'desconhecido';

    const documento = await confirmarUpload(
      req.params.id,
      arquivo,
      caminhoStorage,
      enviadoPorId,
      enviadoPorCidadao,
      resolveAtor(req),
    );
    res.status(201).json(documento);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/processos/:id/documentos/:docId/download
 * GET /api/v1/admin/processos/:id/documentos/:docId/download
 *
 * Gera uma presigned URL de leitura (Req. 5.4). Para cidadãos, restringe ao
 * Processo do próprio cidadão (404 quando não pertence); Servidores já são
 * autorizados pelo RBAC na camada de rota.
 */
export async function getDownloadUrl(req: Request, res: Response): Promise<void> {
  try {
    const solicitanteCidadaoId = req.user?.role === 'cidadao' ? req.user.sub : undefined;
    const resultado = await gerarDownloadUrl(req.params.docId, solicitanteCidadaoId);
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/processos/:id/documentos
 * GET /api/v1/admin/processos/:id/documentos
 *
 * Lista os documentos anexados ao Processo (Req. 5.4).
 */
export async function getDocumentos(req: Request, res: Response): Promise<void> {
  try {
    const documentos = await listarDocumentos(req.params.id);
    res.status(200).json({ data: documentos });
  } catch (err) {
    handleError(err, res);
  }
}
