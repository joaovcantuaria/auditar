import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { criarFluxoSchema, editarFluxoSchema } from './fluxos.schema.js';
import { listar, obter, criar, salvarEdicao, calcularPrazoTotal, type Ator } from './fluxos.service.js';

/**
 * Controllers HTTP para o CRUD de Fluxos e Etapas.
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`AppError`, `ZodError`) na forma de resposta `ApiError` (`{ error, code, field? }`).
 */

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Extrai o ator (servidor autenticado) a partir do `req.user`. */
function resolveAtor(req: Request): Ator {
  return { servidorId: req.user?.sub ?? 'desconhecido', enderecoIp: resolveIp(req) };
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
      scope: 'fluxos.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** GET /api/v1/fluxos */
export async function getFluxos(_req: Request, res: Response): Promise<void> {
  try {
    const fluxos = await listar();
    res.status(200).json(fluxos);
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /api/v1/fluxos/:id */
export async function getFluxo(req: Request, res: Response): Promise<void> {
  try {
    const fluxo = await obter(req.params.id);
    res.status(200).json(fluxo);
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/fluxos */
export async function postFluxo(req: Request, res: Response): Promise<void> {
  try {
    const dto = criarFluxoSchema.parse(req.body);
    const fluxo = await criar(dto, resolveAtor(req));
    // Confirmação de salvamento com prazo total e timestamp (Req. 15.5 / 15.8).
    res.status(201).json({
      salvo: true,
      fluxo,
      prazoTotalDiasUteis: calcularPrazoTotal(fluxo.etapas),
      salvoEm: new Date().toISOString(),
    });
  } catch (err) {
    handleError(err, res);
  }
}

/** PUT /api/v1/fluxos/:id — salva uma nova versão do fluxo (Req. 15.4). */
export async function putFluxo(req: Request, res: Response): Promise<void> {
  try {
    const dto = editarFluxoSchema.parse(req.body);
    const fluxo = await salvarEdicao(req.params.id, dto, resolveAtor(req));
    res.status(200).json({
      salvo: true,
      fluxo,
      prazoTotalDiasUteis: calcularPrazoTotal(fluxo.etapas),
      salvoEm: new Date().toISOString(),
    });
  } catch (err) {
    handleError(err, res);
  }
}
