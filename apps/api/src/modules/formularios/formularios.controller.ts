import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { criarFormularioSchema, editarFormularioSchema } from './formularios.schema.js';
import {
  listar,
  obterPorTipoUnidade,
  criar,
  salvar,
  type AtorFormulario,
} from './formularios.service.js';

/**
 * Controllers HTTP para Formulários Dinâmicos.
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`ZodError`, `AppError`) na forma de resposta `ApiError` (`{ error, code, field? }`).
 */

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Extrai o ator autenticado (servidor) da requisição. */
function resolveAtor(req: Request): AtorFormulario {
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
      scope: 'formularios.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** GET /api/v1/admin/config/formularios */
export async function getFormularios(_req: Request, res: Response): Promise<void> {
  try {
    const formularios = await listar();
    res.status(200).json({ data: formularios });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/formularios?tipoId=&unidadeId= (público — Portal do Cidadão).
 * Responde 400 quando os parâmetros estão ausentes; 404 quando não há
 * formulário ativo para o par Tipo+Unidade (indisponibilidade — Req. 16.6).
 */
export async function getFormularioPorTipoUnidade(req: Request, res: Response): Promise<void> {
  try {
    const tipoId = typeof req.query.tipoId === 'string' ? req.query.tipoId : '';
    const unidadeId = typeof req.query.unidadeId === 'string' ? req.query.unidadeId : '';

    if (!tipoId || !unidadeId) {
      res.status(400).json({
        error: 'Parâmetros tipoId e unidadeId são obrigatórios',
        code: ErrorCodes.VALIDATION_ERROR,
      });
      return;
    }

    const formulario = await obterPorTipoUnidade(tipoId, unidadeId);
    if (!formulario) {
      res.status(404).json({
        error: 'Formulário indisponível para o tipo de processo e unidade selecionados',
        code: ErrorCodes.VALIDATION_ERROR,
      });
      return;
    }

    res.status(200).json({ data: formulario });
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/admin/config/formularios */
export async function postFormulario(req: Request, res: Response): Promise<void> {
  try {
    const dto = criarFormularioSchema.parse(req.body);
    const formulario = await criar(dto, resolveAtor(req));
    res.status(201).json(formulario);
  } catch (err) {
    handleError(err, res);
  }
}

/** PUT /api/v1/admin/config/formularios/:id */
export async function putFormulario(req: Request, res: Response): Promise<void> {
  try {
    const dto = editarFormularioSchema.parse(req.body);
    const formulario = await salvar(req.params.id, dto, resolveAtor(req));
    res.status(200).json(formulario);
  } catch (err) {
    handleError(err, res);
  }
}
