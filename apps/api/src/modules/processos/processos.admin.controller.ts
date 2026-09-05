import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import {
  listarAdmin,
  buscaRapida,
  COLUNAS_ORDENAVEIS,
  type FiltrosAdmin,
  type OrdenacaoAdmin,
  type OrdenarPor,
  type Direcao,
  type PaginacaoAdmin,
} from './processos.admin.service.js';

/**
 * Controller da listagem/busca administrativa de processos (Req. 10).
 *
 * `GET /api/v1/admin/processos` aceita filtros, paginação e ordenação por query
 * string. Quando `q` está presente, delega para a busca rápida (Req. 10.5);
 * caso contrário, usa a listagem filtrada (Req. 10.2). Resultado vazio inclui
 * um campo `mensagem` orientando o servidor (Req. 10.8).
 */

/** Mensagem exibida quando os filtros não retornam nenhum processo (Req. 10.8). */
export const MSG_SEM_RESULTADOS =
  'Nenhum processo encontrado para os critérios informados.';

/** Coerção segura de query param para string (ignora arrays/objetos). */
function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Coerção de query param para Date válido; retorna undefined se inválido. */
function asDate(v: unknown): Date | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Coerção de query param para inteiro; retorna undefined se não numérico. */
function asInt(v: unknown): number | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isInteger(n) ? n : undefined;
}

/** Extrai os filtros combináveis da query string (Req. 10.2). */
function parseFiltros(q: Request['query']): FiltrosAdmin {
  return {
    categoriaId: asString(q.categoriaId),
    tipoProcessoId: asString(q.tipoProcessoId),
    status: asString(q.status),
    dataAberturaInicio: asDate(q.dataAberturaInicio),
    dataAberturaFim: asDate(q.dataAberturaFim),
    prazoInicio: asDate(q.prazoInicio),
    prazoFim: asDate(q.prazoFim),
    servidorResponsavelId: asString(q.servidorResponsavelId),
    nomeCidadao: asString(q.nomeCidadao),
    cpfCidadao: asString(q.cpfCidadao),
    unidadeId: asString(q.unidadeId),
    prioridade: asInt(q.prioridade),
  };
}

/** Extrai a paginação da query string. */
function parsePaginacao(q: Request['query']): PaginacaoAdmin {
  return { page: asInt(q.page), pageSize: asInt(q.pageSize) };
}

/** Extrai a ordenação da query string, validando a coluna (Req. 10.3). */
function parseOrdenacao(q: Request['query']): OrdenacaoAdmin {
  const ordenarPor = asString(q.ordenarPor);
  const direcao = asString(q.direcao);
  return {
    ordenarPor: COLUNAS_ORDENAVEIS.includes(ordenarPor as OrdenarPor)
      ? (ordenarPor as OrdenarPor)
      : undefined,
    direcao: direcao === 'asc' || direcao === 'desc' ? (direcao as Direcao) : undefined,
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
      scope: 'processos.admin.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * GET /api/v1/admin/processos
 *
 * Se `q` estiver presente, executa a busca rápida (Req. 10.5/10.6); caso
 * contrário, a listagem filtrada e ordenada (Req. 10.1–10.4). Em ambos os
 * casos, quando não há resultados, inclui `mensagem` no corpo (Req. 10.8).
 */
export async function getProcessosAdmin(req: Request, res: Response): Promise<void> {
  try {
    const paginacao = parsePaginacao(req.query);
    const termo = asString(req.query.q);

    const resultado = termo
      ? await buscaRapida(termo, paginacao)
      : await listarAdmin(parseFiltros(req.query), paginacao, parseOrdenacao(req.query));

    const corpo =
      resultado.data.length === 0
        ? { ...resultado, mensagem: MSG_SEM_RESULTADOS }
        : resultado;

    res.status(200).json(corpo);
  } catch (err) {
    handleError(err, res);
  }
}
