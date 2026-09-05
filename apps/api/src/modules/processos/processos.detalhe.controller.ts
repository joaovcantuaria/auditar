import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { obterDetalhe, obterHistorico, obterMensagens } from './processos.detalhe.service.js';

/**
 * Controllers HTTP da Consulta e Acompanhamento de Processo pelo Cidadão
 * (Task 7.3). Traduzem a requisição Express para o serviço e serializam
 * erros conhecidos (`ZodError`, `AppError`) na forma de resposta `ApiError`
 * (`{ error, code, field? }`). O id do Cidadão é sempre extraído do token
 * autenticado (`req.user.sub`).
 *
 * Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.10
 */

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
      scope: 'processos.detalhe.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * GET /api/v1/processos/:id
 *
 * Detalhe completo do Processo para a aba Informações (Req 5.1, 5.2). 404
 * quando o Processo não existe ou não pertence ao Cidadão autenticado.
 */
export async function getProcessoDetalhe(req: Request, res: Response): Promise<void> {
  try {
    const data = await obterDetalhe(req.params.id, req.user?.sub ?? '');
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/processos/:id/historico
 *
 * Cronologia de movimentações em ordem crescente para a aba Histórico
 * (Req 5.3).
 */
export async function getProcessoHistorico(req: Request, res: Response): Promise<void> {
  try {
    const data = await obterHistorico(req.params.id, req.user?.sub ?? '');
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/processos/:id/mensagens
 *
 * Mensagens do canal público em ordem crescente para a aba Comunicação
 * (Req 5.5).
 */
export async function getProcessoMensagensPublico(req: Request, res: Response): Promise<void> {
  try {
    const data = await obterMensagens(req.params.id, req.user?.sub ?? '');
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}
