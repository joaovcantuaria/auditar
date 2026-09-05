import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { atribuirSchema, reatribuirSchema } from './processos.atribuicao.schema.js';
import {
  atribuir,
  reatribuir,
  listarCargasDisponiveis,
} from './processos.atribuicao.service.js';

/**
 * Controllers HTTP da Atribuição/Reatribuição de Processos (Task 7.7, Req 12).
 *
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`ZodError`, `AppError`) na forma de resposta `ApiError`
 * (`{ error, code, field? }`), mesmo padrão de
 * `processos.tramitacao.controller.ts`.
 */

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Resolve o id do Servidor autenticado a partir do token. */
function resolveServidorId(req: Request): string {
  return req.user?.sub ?? '';
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
      scope: 'processos.atribuicao.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * GET /api/v1/admin/processos/:id/atribuir/cargas
 *
 * Lista a carga ativa de cada Servidor da Unidade do Processo, para exibição
 * antes da confirmação da atribuição manual (Req 12.4).
 */
export async function getCargasDisponiveis(req: Request, res: Response): Promise<void> {
  try {
    const data = await listarCargasDisponiveis(req.params.id);
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/processos/:id/atribuir
 *
 * Atribui o Processo pelo modo informado: automático (menor carga), manual
 * (Servidor escolhido) ou fila_geral (Req 12.1, 12.2, 12.5, 12.7).
 */
export async function postAtribuir(req: Request, res: Response): Promise<void> {
  try {
    const dto = atribuirSchema.parse(req.body);
    const data = await atribuir(req.params.id, dto, resolveServidorId(req), resolveIp(req));
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/processos/:id/reatribuir
 *
 * Reatribui o Processo para outro Servidor, exigindo justificativa 20–500
 * chars validada antes de qualquer alteração de estado (Req 12.8, 12.9, 12.10).
 */
export async function postReatribuir(req: Request, res: Response): Promise<void> {
  try {
    const dto = reatribuirSchema.parse(req.body);
    const data = await reatribuir(req.params.id, dto, resolveServidorId(req), resolveIp(req));
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}
