import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/errors.js';
import { criarUnidadeSchema, editarUnidadeSchema } from './unidades.schema.js';
import {
  listar,
  criar,
  editar,
  desativar,
  type Ator,
  type ListarUnidadesFiltros,
} from './unidades.service.js';

/**
 * Controllers HTTP do CRUD de Unidades.
 *
 * Cada handler: (1) valida a entrada, (2) chama o serviço, (3) mapeia erros
 * conhecidos para a estrutura `{ error, code, field }`.
 *
 * _Requirements: 14.5, 14.6, 14.7_
 */

/** Serializa erros conhecidos para a resposta padrão da API. */
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

  console.error('[unidades] erro inesperado:', err instanceof Error ? err.message : err);
  res
    .status(500)
    .json({ error: 'Erro interno do servidor', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Extrai o ator (servidor autenticado) + IP a partir da requisição. */
function extrairAtor(req: Request): Ator {
  return { servidorId: req.user?.sub ?? 'desconhecido', enderecoIp: resolveIp(req) };
}

/** GET /  — lista Unidades, com filtros opcionais `ativa` e `secretaria`. */
export async function getUnidades(req: Request, res: Response): Promise<void> {
  try {
    const filtros: ListarUnidadesFiltros = {};
    if (req.query.ativa !== undefined) {
      filtros.ativa = req.query.ativa === 'true';
    }
    if (typeof req.query.secretaria === 'string' && req.query.secretaria) {
      filtros.secretaria = req.query.secretaria;
    }

    const unidades = await listar(filtros);
    res.status(200).json({ data: unidades });
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /  — cria uma Unidade. */
export async function postUnidade(req: Request, res: Response): Promise<void> {
  try {
    const dto = criarUnidadeSchema.parse(req.body);
    const unidade = await criar(dto, extrairAtor(req));
    res.status(201).json(unidade);
  } catch (err) {
    handleError(err, res);
  }
}

/** PATCH /:id  — edita uma Unidade. */
export async function patchUnidade(req: Request, res: Response): Promise<void> {
  try {
    const dto = editarUnidadeSchema.parse(req.body);
    const unidade = await editar(req.params.id, dto, extrairAtor(req));
    res.status(200).json(unidade);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * DELETE /:id  — desativa uma Unidade.
 *
 * Aceita `?confirmar=true`. Quando há Processos em andamento e a confirmação
 * está ausente, responde 409 com o número de Processos impactados (Req. 14.6).
 */
export async function deleteUnidade(req: Request, res: Response): Promise<void> {
  try {
    const confirmar = req.query.confirmar === 'true';
    const resultado = await desativar(req.params.id, confirmar, extrairAtor(req));

    if ('requerConfirmacao' in resultado) {
      res.status(409).json({
        requerConfirmacao: true,
        processosImpactados: resultado.processosImpactados,
        mensagem: `Existem ${resultado.processosImpactados} processo(s) em andamento nesta unidade. Confirme para prosseguir.`,
      });
      return;
    }

    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}
