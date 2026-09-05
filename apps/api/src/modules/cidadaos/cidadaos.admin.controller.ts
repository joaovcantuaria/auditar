import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { buscarPorCpf } from './cidadaos.service.js';

/**
 * Controller administrativo da busca de Cidadão por CPF (tarefa 20.1, Req. 23.2,
 * 23.3). Usado pelo Servidor autorizado antes de abrir um Processo em nome de
 * um Cidadão.
 *
 * `GET /api/v1/admin/cidadaos?cpf={cpf}` retorna os dados de identificação do
 * Cidadão encontrado (200) ou 404 sinalizando que um novo Cidadão pode ser
 * cadastrado (Req. 23.3).
 */

/** Coerção segura de query param para string. */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
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
      scope: 'cidadaos.admin.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * GET /api/v1/admin/cidadaos?cpf={cpf} — localiza um Cidadão por CPF para a
 * abertura administrativa de Processo (Req. 23.2, 23.3).
 */
export async function getCidadaoPorCpf(req: Request, res: Response): Promise<void> {
  try {
    const cidadao = await buscarPorCpf(asString(req.query.cpf));
    res.status(200).json({ data: cidadao });
  } catch (err) {
    handleError(err, res);
  }
}
