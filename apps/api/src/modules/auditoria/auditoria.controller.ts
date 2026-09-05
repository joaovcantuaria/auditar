import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import {
  listarAuditoria,
  solicitarExportacao,
  statusExportacao,
  type FiltrosAuditoria,
} from './auditoria.query.service.js';

/**
 * Controller do log de auditoria (Req. 17.2, 17.4, 17.5, 17.6, 17.7).
 *
 * Expõe SOMENTE operações de leitura + a solicitação de um job de exportação:
 *  - GET  /            → listagem paginada com filtros (Req. 17.2, 17.4).
 *  - POST /exportar    → solicita job de exportação CSV/PDF (Req. 17.5).
 *  - GET  /exportar/:id → consulta status/download do job (Req. 17.5).
 *
 * Nenhum handler modifica o `AuditoriaLog` — a exportação apenas grava um
 * status transitório no Redis (Req. 17.7).
 */

/** Coerção segura de query/body para string não vazia. */
function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Coerção de query param para Date válido; undefined se ausente/inválido. */
function asDate(v: unknown): Date | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Coerção de query param para inteiro; undefined se não numérico. */
function asInt(v: unknown): number | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isInteger(n) ? n : undefined;
}

/** Extrai os filtros combináveis da query string (Req. 17.4). */
function parseFiltros(q: Request['query']): FiltrosAuditoria {
  return {
    dataInicio: asDate(q.dataInicio),
    dataFim: asDate(q.dataFim),
    tipoAcao: asString(q.tipoAcao),
    ator: asString(q.ator),
    atorId: asString(q.atorId),
    modulo: asString(q.modulo),
    protocolo: asString(q.protocolo),
  };
}

/** Extrai os filtros combináveis do corpo da requisição de exportação. */
function parseFiltrosBody(body: Record<string, unknown>): FiltrosAuditoria {
  return {
    dataInicio: asDate(body.dataInicio),
    dataFim: asDate(body.dataFim),
    tipoAcao: asString(body.tipoAcao),
    ator: asString(body.ator),
    atorId: asString(body.atorId),
    modulo: asString(body.modulo),
    protocolo: asString(body.protocolo),
  };
}

/** Serializa erros conhecidos na forma de resposta `ApiError`. */
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
      scope: 'auditoria.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * GET /api/v1/admin/auditoria
 * Listagem paginada (≤100/página) do log de auditoria com filtros (Req. 17.2, 17.4).
 */
export async function getAuditoria(req: Request, res: Response): Promise<void> {
  try {
    const paginacao = { page: asInt(req.query.page), pageSize: asInt(req.query.pageSize) };
    const resultado = await listarAuditoria(parseFiltros(req.query), paginacao);
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/auditoria/exportar
 * Solicita um job de exportação CSV/PDF, retornando `{ jobId }` (Req. 17.5).
 * NÃO modifica o log de auditoria — apenas registra o status no Redis.
 */
export async function postExportarAuditoria(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const formato = asString(body.formato) ?? 'csv';
    const { jobId } = await solicitarExportacao(formato, parseFiltrosBody(body));
    res.status(202).json({ jobId });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/admin/auditoria/exportar/:jobId
 * Consulta o status do job de exportação (Req. 17.5). 404 se desconhecido.
 */
export async function getStatusExportacaoAuditoria(req: Request, res: Response): Promise<void> {
  try {
    const jobId = asString(req.params.jobId);
    if (!jobId) {
      res.status(400).json({ error: 'jobId ausente', code: ErrorCodes.VALIDATION_ERROR });
      return;
    }
    const status = await statusExportacao(jobId);
    if (!status) {
      res
        .status(404)
        .json({ error: 'Exportação não encontrada', code: ErrorCodes.SERVICO_INDISPONIVEL });
      return;
    }
    res.status(200).json({ status: status.status, downloadUrl: status.downloadUrl });
  } catch (err) {
    handleError(err, res);
  }
}
