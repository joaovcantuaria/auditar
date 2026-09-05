import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import {
  gerarRelatorio,
  solicitarExportacao,
  statusExportacao,
  type FiltrosRelatorio,
} from './relatorios.service.js';

/**
 * Controller de Relatórios e Métricas (Req. 18).
 *
 *  - GET  /             → gera os cinco datasets com filtros (Req. 18.1, 18.2).
 *  - POST /exportar     → solicita job de exportação CSV/PDF (Req. 18.4, 18.5).
 *  - GET  /exportar/:id → consulta status/download do job (Req. 18.5).
 */

/** Coerção segura para string não vazia. */
function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Coerção para Date válido; undefined se ausente/inválido. */
function asDate(v: unknown): Date | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Extrai os filtros combináveis a partir de query/body (Req. 18.2). */
function parseFiltros(src: Record<string, unknown>): FiltrosRelatorio {
  return {
    dataInicio: asDate(src.dataInicio),
    dataFim: asDate(src.dataFim),
    categoriaId: asString(src.categoriaId),
    tipoProcessoId: asString(src.tipoProcessoId),
    unidadeId: asString(src.unidadeId),
    servidorId: asString(src.servidorId),
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
      scope: 'relatorios.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * GET /api/v1/admin/relatorios
 * Gera os cinco datasets do relatório com filtros e período padrão (Req. 18.1, 18.2).
 */
export async function getRelatorio(req: Request, res: Response): Promise<void> {
  try {
    const resultado = await gerarRelatorio(parseFiltros(req.query as Record<string, unknown>));
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/relatorios/exportar
 * Solicita um job de exportação CSV/PDF, retornando `{ jobId }` (Req. 18.4, 18.5).
 */
export async function postExportarRelatorio(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const formato = asString(body.formato) ?? 'csv';
    const servidorId = req.user?.sub ?? '';
    const { jobId } = await solicitarExportacao(formato, servidorId, parseFiltros(body));
    res.status(202).json({ jobId });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/admin/relatorios/exportar/:jobId
 * Consulta o status do job de exportação (Req. 18.5). 404 se desconhecido.
 */
export async function getStatusExportacaoRelatorio(req: Request, res: Response): Promise<void> {
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
