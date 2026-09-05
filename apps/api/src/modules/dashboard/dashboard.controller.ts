import { createRequire } from 'node:module';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ErrorCodes, NivelAcesso } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import {
  dashboardAnalista,
  dashboardGestorUnidade,
  dashboardGestorCategoria,
  dashboardGestorGeral,
  dashboardResumo,
  dashboardDesempenhoEquipe,
  type EscopoDashboard,
  type FiltrosDashboard,
  type OrdenarDesempenhoPor,
} from './dashboard.service.js';

/**
 * Controllers HTTP dos dashboards por perfil (Task 10.1, Req 9.1–9.4).
 *
 * Todas as rotas estão sob `/api/v1/admin/dashboard` e já passaram por
 * `authenticate` + `requireServidor` + `requirePermission(ACESSAR_RELATORIOS)`
 * no router. O escopo de cada perfil é derivado do JWT e/ou de um lookup do
 * Servidor:
 *  - `sub` (JWT): id do Servidor autenticado → usado como servidorId (analista)
 *    e como chave de escopo do gestor-geral.
 *  - `nivel` (JWT): nível de acesso (não determina o escopo aqui, apenas a
 *    permissão via RBAC no router).
 *  - `unidadeId` / `categoria`: NÃO estão no JWT. Para os perfis de
 *    gestor-unidade e gestor-categoria buscamos a linha do Servidor por `sub`
 *    para obter a `unidadeId`. A categoria do gestor-categoria é resolvida a
 *    partir da unidade do Servidor (via o primeiro TipoProcesso atendido pela
 *    unidade) — documentado como heurística até existir vínculo direto
 *    Servidor↔Categoria no schema.
 */

/** Lookup mínimo do Servidor usado para resolver escopo. */
export interface ServidorLookup {
  buscarServidor(sub: string): Promise<{ unidadeId: string } | null>;
  buscarCategoriaDaUnidade(unidadeId: string): Promise<string | null>;
}

/** Resolve o lookup real preguiçosamente (sem abrir conexão ao importar). */
function resolveLookup(lookup?: Partial<ServidorLookup>): ServidorLookup {
  if (lookup?.buscarServidor && lookup?.buscarCategoriaDaUnidade) {
    return lookup as ServidorLookup;
  }
  const requireLocal = createRequire(import.meta.url);
  const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };

  const real: ServidorLookup = {
    async buscarServidor(sub) {
      return prisma.servidor.findUnique({
        where: { id: sub },
        select: { unidadeId: true },
      });
    },
    async buscarCategoriaDaUnidade(unidadeId) {
      const vinculo = await prisma.tipoProcessoUnidade.findFirst({
        where: { unidadeId },
        select: { tipoProcesso: { select: { categoriaId: true } } },
      });
      return vinculo?.tipoProcesso?.categoriaId ?? null;
    },
  };
  return {
    buscarServidor: lookup?.buscarServidor ?? real.buscarServidor,
    buscarCategoriaDaUnidade: lookup?.buscarCategoriaDaUnidade ?? real.buscarCategoriaDaUnidade,
  };
}

/** Mapeia erros conhecidos para resposta HTTP; loga e responde 500 caso contrário. */
function handleError(err: unknown, res: Response): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code, field: err.field });
    return;
  }
  console.error(
    JSON.stringify({
      level: 'error',
      scope: 'dashboard.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** Extrai o `sub` (id do Servidor) do JWT, ou lança 401. */
function requireSub(req: Request): string {
  const sub = req.user?.sub;
  if (!sub) {
    throw new AppError(401, ErrorCodes.TOKEN_EXPIRED, 'Não autenticado');
  }
  return sub;
}

/** GET /api/v1/admin/dashboard/analista (Req 9.1) */
export async function getDashboardAnalista(req: Request, res: Response): Promise<void> {
  try {
    const servidorId = requireSub(req);
    const data = await dashboardAnalista(servidorId);
    res.status(200).json(data);
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /api/v1/admin/dashboard/gestor-unidade (Req 9.2) */
export async function getDashboardGestorUnidade(
  req: Request,
  res: Response,
  lookup?: Partial<ServidorLookup>,
): Promise<void> {
  try {
    const sub = requireSub(req);
    const servidor = await resolveLookup(lookup).buscarServidor(sub);
    if (!servidor) {
      throw new AppError(404, ErrorCodes.VALIDATION_ERROR, 'Servidor não encontrado');
    }
    const data = await dashboardGestorUnidade(servidor.unidadeId);
    res.status(200).json(data);
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /api/v1/admin/dashboard/gestor-categoria (Req 9.3) */
export async function getDashboardGestorCategoria(
  req: Request,
  res: Response,
  lookup?: Partial<ServidorLookup>,
): Promise<void> {
  try {
    const sub = requireSub(req);
    const l = resolveLookup(lookup);
    const servidor = await l.buscarServidor(sub);
    if (!servidor) {
      throw new AppError(404, ErrorCodes.VALIDATION_ERROR, 'Servidor não encontrado');
    }
    const categoriaId = await l.buscarCategoriaDaUnidade(servidor.unidadeId);
    if (!categoriaId) {
      throw new AppError(
        404,
        ErrorCodes.VALIDATION_ERROR,
        'Não foi possível resolver a categoria do gestor',
      );
    }
    const data = await dashboardGestorCategoria(categoriaId);
    res.status(200).json(data);
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /api/v1/admin/dashboard/gestor-geral (Req 9.4) */
export async function getDashboardGestorGeral(req: Request, res: Response): Promise<void> {
  try {
    const sub = requireSub(req);
    const data = await dashboardGestorGeral(sub);
    res.status(200).json(data);
  } catch (err) {
    handleError(err, res);
  }
}

// ===========================================================================
// Dashboard Estendida — Resumo e Desempenho da Equipe (Tasks 23.1, 23.2)
// Req 9.7, 9.8, 9.9, 9.10, 9.11, 9.12
// ===========================================================================

/**
 * Resolve o escopo RBAC do Dashboard estendido a partir do JWT (Req 9.12):
 *  - Administrador (`nivel === ADMINISTRADOR`) ⇒ sem restrição (`unidadeId: null`):
 *    vê todas as Unidades/Categorias;
 *  - demais Servidores (Gestor_de_Unidade e afins) ⇒ restritos à sua Unidade,
 *    obtida via lookup por `sub`. Sem Unidade resolvível ⇒ 404.
 *
 * O escopo é SOBERANO no serviço: um filtro de Unidade divergente não vaza dados
 * de outra Unidade (base da Property 11).
 */
async function resolverEscopo(
  req: Request,
  lookup?: Partial<ServidorLookup>,
): Promise<EscopoDashboard> {
  const sub = requireSub(req);
  const nivel = req.user?.nivel;

  if (nivel === NivelAcesso.ADMINISTRADOR) {
    return { unidadeId: null };
  }

  const servidor = await resolveLookup(lookup).buscarServidor(sub);
  if (!servidor) {
    throw new AppError(404, ErrorCodes.VALIDATION_ERROR, 'Servidor não encontrado');
  }
  return { unidadeId: servidor.unidadeId };
}

/** Converte `?de=`/`?ate=` (ISO ou data) em Date válido, ou `undefined`. */
function parseData(v: unknown): Date | undefined {
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Extrai os filtros combináveis (`unidadeId`/`categoriaId`/`de`/`ate`) da query. */
function extrairFiltros(req: Request): FiltrosDashboard {
  const q = req.query;
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v : undefined;
  return {
    unidadeId: str(q.unidadeId),
    categoriaId: str(q.categoriaId),
    de: parseData(q.de),
    ate: parseData(q.ate),
  };
}

/** GET /api/v1/admin/dashboard/resumo (Task 23.1, Req 9.7/9.8/9.11/9.12) */
export async function getDashboardResumo(
  req: Request,
  res: Response,
  lookup?: Partial<ServidorLookup>,
): Promise<void> {
  try {
    const escopo = await resolverEscopo(req, lookup);
    const filtros = extrairFiltros(req);
    const data = await dashboardResumo(escopo, filtros);
    res.status(200).json(data);
  } catch (err) {
    handleError(err, res);
  }
}

/** Valida `?ordenarPor=` contra os campos permitidos, com fallback para `nome`. */
function parseOrdenarPor(v: unknown): OrdenarDesempenhoPor {
  const permitidos: OrdenarDesempenhoPor[] = [
    'nome',
    'atribuidos',
    'emAndamento',
    'concluidos',
    'atrasados',
    'tempoMedioConclusaoHoras',
    'tarefasPendentes',
  ];
  return typeof v === 'string' && (permitidos as string[]).includes(v)
    ? (v as OrdenarDesempenhoPor)
    : 'nome';
}

/** GET /api/v1/admin/dashboard/desempenho-equipe (Task 23.2, Req 9.9/9.10/9.11/9.12) */
export async function getDashboardDesempenhoEquipe(
  req: Request,
  res: Response,
  lookup?: Partial<ServidorLookup>,
): Promise<void> {
  try {
    const escopo = await resolverEscopo(req, lookup);
    const filtros = extrairFiltros(req);
    const ordenarPor = parseOrdenarPor(req.query.ordenarPor);
    const data = await dashboardDesempenhoEquipe(escopo, filtros, ordenarPor);
    res.status(200).json(data);
  } catch (err) {
    handleError(err, res);
  }
}
