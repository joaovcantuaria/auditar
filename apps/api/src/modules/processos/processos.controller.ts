import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { criarProcessoSchema, filtroProcessoCidadaoSchema } from './processos.schema.js';
import { criarProcesso, listarDoCidadao, type Ator } from './processos.service.js';

/**
 * Controllers HTTP da criação e listagem de Processos pelo Cidadão (Req. 4, 3).
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`ZodError`, `AppError`) na forma de resposta `ApiError` (`{ error, code, field? }`).
 * O id do Cidadão é sempre extraído do token autenticado (`req.user.sub`).
 */

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Extrai o Cidadão autenticado da requisição. */
function resolveAtor(req: Request): Ator {
  return { cidadaoId: req.user?.sub ?? 'desconhecido', enderecoIp: resolveIp(req) };
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
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      field: err.field,
    });
    return;
  }

  console.error(
    JSON.stringify({
      level: 'error',
      scope: 'processos.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * POST /api/v1/processos — cria um novo Processo a partir da submissão da
 * etapa 6 do wizard (Req. 4.8: retorna o Protocolo gerado).
 */
export async function postProcesso(req: Request, res: Response): Promise<void> {
  try {
    const dto = criarProcessoSchema.parse(req.body);
    const ator = resolveAtor(req);
    const resultado = await criarProcesso(ator.cidadaoId, dto, ator);
    res.status(201).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/processos — lista os Processos do Cidadão autenticado, com
 * filtros opcionais de status, categoria e período de abertura (Req. 3.7, 3.8).
 */
export async function getMeusProcessos(req: Request, res: Response): Promise<void> {
  try {
    const filtros = filtroProcessoCidadaoSchema.parse(req.query);
    const data = await listarDoCidadao(req.user?.sub ?? '', filtros);
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}
