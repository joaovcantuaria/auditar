import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { criarTipoSchema, editarTipoSchema } from './tipos.schema.js';
import { listar, criar, editar, desativar, type Ator } from './tipos.service.js';

/**
 * Controllers HTTP para o CRUD de Tipos de Processo.
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
      scope: 'tipos-processo.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** GET /api/v1/tipos-processo?categoriaId=... */
export async function getTipos(req: Request, res: Response): Promise<void> {
  try {
    const categoriaId = typeof req.query.categoriaId === 'string' ? req.query.categoriaId : undefined;
    const tipos = await listar(categoriaId);
    res.status(200).json(tipos);
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/tipos-processo */
export async function postTipo(req: Request, res: Response): Promise<void> {
  try {
    const dto = criarTipoSchema.parse(req.body);
    const tipo = await criar(dto, resolveAtor(req));
    res.status(201).json(tipo);
  } catch (err) {
    handleError(err, res);
  }
}

/** PATCH /api/v1/tipos-processo/:id */
export async function patchTipo(req: Request, res: Response): Promise<void> {
  try {
    const dto = editarTipoSchema.parse(req.body);
    const tipo = await editar(req.params.id, dto, resolveAtor(req));
    res.status(200).json(tipo);
  } catch (err) {
    handleError(err, res);
  }
}

/** DELETE /api/v1/tipos-processo/:id?confirmar=true (desativação lógica) */
export async function deleteTipo(req: Request, res: Response): Promise<void> {
  try {
    const confirmar = req.query.confirmar === 'true';
    const result = await desativar(req.params.id, confirmar, resolveAtor(req));

    if (result.requerConfirmacao) {
      // 409: a operação exige confirmação explícita (Req. 14.6).
      res.status(409).json({
        requerConfirmacao: true,
        processosImpactados: result.processosImpactados,
      });
      return;
    }

    res.status(200).json(result.tipo);
  } catch (err) {
    handleError(err, res);
  }
}
