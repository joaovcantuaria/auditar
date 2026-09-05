import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { criarCategoriaSchema, editarCategoriaSchema } from './categorias.schema.js';
import {
  listar,
  criar,
  editar,
  desativar,
  type AtorCategoria,
} from './categorias.service.js';

/**
 * Controllers HTTP para o CRUD de Categorias.
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`ZodError`, `AppError`) na forma de resposta `ApiError` (`{ error, code, field? }`).
 */

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Extrai o ator autenticado (servidor) da requisição. */
function resolveAtor(req: Request): AtorCategoria {
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
      scope: 'categorias.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** GET /api/v1/admin/config/categorias */
export async function getCategorias(_req: Request, res: Response): Promise<void> {
  try {
    const categorias = await listar();
    res.status(200).json({ data: categorias });
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/admin/config/categorias */
export async function postCategoria(req: Request, res: Response): Promise<void> {
  try {
    const dto = criarCategoriaSchema.parse(req.body);
    const categoria = await criar(dto, resolveAtor(req));
    res.status(201).json(categoria);
  } catch (err) {
    handleError(err, res);
  }
}

/** PATCH /api/v1/admin/config/categorias/:id */
export async function patchCategoria(req: Request, res: Response): Promise<void> {
  try {
    const dto = editarCategoriaSchema.parse(req.body);
    const categoria = await editar(req.params.id, dto, resolveAtor(req));
    res.status(200).json(categoria);
  } catch (err) {
    handleError(err, res);
  }
}

/** DELETE /api/v1/admin/config/categorias/:id?confirmar=true */
export async function deleteCategoria(req: Request, res: Response): Promise<void> {
  try {
    const confirmar = req.query.confirmar === 'true';
    const resultado = await desativar(req.params.id, resolveAtor(req), confirmar);

    if (resultado.precisaConfirmacao) {
      // Impactados existem e a confirmação não foi dada: 409 sem persistir (Req. 14.6).
      res.status(409).json({
        precisaConfirmacao: true,
        processosImpactados: resultado.processosImpactados,
        message: `Existem ${resultado.processosImpactados} processo(s) em andamento nesta categoria. Confirme para prosseguir.`,
      });
      return;
    }

    res.status(200).json({
      precisaConfirmacao: false,
      processosImpactados: resultado.processosImpactados,
      categoria: resultado.categoria,
    });
  } catch (err) {
    handleError(err, res);
  }
}
