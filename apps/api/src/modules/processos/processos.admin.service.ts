import type { PrismaClient, Prisma } from '@prisma/client';
import { StatusProcesso } from '@auditar/shared';
import { desformatarCPF } from '@auditar/shared';
import { prisma as realPrisma } from '../../config/database.js';
import {
  buildPaginatedResult,
  getPaginationParams,
  badRequest,
} from '../../utils/index.js';
import type { PaginatedResult } from '@auditar/shared';
import { ErrorCodes } from '@auditar/shared';

/**
 * Serviço de Listagem e Busca de Processos no Painel Administrativo (Req. 10).
 *
 * Mantido em arquivo separado (`processos.admin.service.ts`) para não conflitar
 * com o fluxo de criação de processos pelo Cidadão (`processos.service.ts`,
 * tarefa 7.1). Cobre:
 *  - Listagem paginada (20/página) com filtros combináveis (Req. 10.1, 10.2).
 *  - Ordenação por qualquer coluna exibida, crescente/decrescente (Req. 10.3).
 *  - Linha com protocolo, cidadão, categoria, tipo, status+cor, prazo,
 *    servidor responsável e data da última movimentação (Req. 10.4).
 *  - Busca rápida ≥3 caracteres em protocolo/nome/CPF (Req. 10.5, 10.6).
 *  - Resultado vazio devolve `data` vazio + `meta` (Req. 10.8).
 */

// ---------------------------------------------------------------------------
// Cores por status (Req. 10.4)
// ---------------------------------------------------------------------------

/** Paleta de cores por status para exibição na listagem. */
export const CORES_STATUS: Record<StatusProcesso, string> = {
  [StatusProcesso.APROVADO]: '#27AE60', // verde
  [StatusProcesso.FINALIZADO]: '#27AE60', // verde
  [StatusProcesso.EM_ANDAMENTO]: '#F39C12', // amarelo
  [StatusProcesso.VENCIDO]: '#E74C3C', // vermelho
  [StatusProcesso.REJEITADO]: '#E74C3C', // vermelho
  [StatusProcesso.ABERTO]: '#0066CC', // azul
  [StatusProcesso.AGUARDANDO_DOCS]: '#0066CC', // azul
  [StatusProcesso.AGUARDANDO_CIDADAO]: '#0066CC', // azul
};

/** Cor neutra para status desconhecido/legado. */
const COR_PADRAO = '#7F8C8D'; // cinza

/**
 * Mapeia um status de processo para a cor de exibição correspondente (Req. 10.4).
 * Retorna uma cor neutra para valores não mapeados, evitando lançar exceção
 * sobre dados legados.
 */
export function corDoStatus(status: string): string {
  return CORES_STATUS[status as StatusProcesso] ?? COR_PADRAO;
}

// ---------------------------------------------------------------------------
// Filtros, ordenação e paginação
// ---------------------------------------------------------------------------

/** Filtros combináveis da listagem administrativa (Req. 10.2). */
export interface FiltrosAdmin {
  categoriaId?: string;
  tipoProcessoId?: string;
  status?: string;
  dataAberturaInicio?: Date;
  dataAberturaFim?: Date;
  prazoInicio?: Date;
  prazoFim?: Date;
  servidorResponsavelId?: string;
  nomeCidadao?: string;
  cpfCidadao?: string;
  unidadeId?: string;
  prioridade?: number;
}

/** Colunas ordenáveis expostas na listagem (Req. 10.3). */
export type OrdenarPor =
  | 'protocolo'
  | 'cidadao'
  | 'tipo'
  | 'status'
  | 'abertoEm'
  | 'prazoFinal'
  | 'servidor';

export type Direcao = 'asc' | 'desc';

/** Parâmetros de ordenação da listagem. */
export interface OrdenacaoAdmin {
  ordenarPor?: OrdenarPor;
  direcao?: Direcao;
}

/** Parâmetros de paginação (page/pageSize) recebidos do controller. */
export interface PaginacaoAdmin {
  page?: number;
  pageSize?: number;
}

/** Colunas ordenáveis válidas — usado para validar entrada e testes. */
export const COLUNAS_ORDENAVEIS: readonly OrdenarPor[] = [
  'protocolo',
  'cidadao',
  'tipo',
  'status',
  'abertoEm',
  'prazoFinal',
  'servidor',
];

/** Tamanho de página padrão na listagem administrativa (Req. 10.1). */
export const PAGE_SIZE_PADRAO = 20;

/** Mínimo de caracteres exigido na busca rápida (Req. 10.5, 10.6). */
export const BUSCA_RAPIDA_MIN_CHARS = 3;

/** Mensagem orientativa quando o termo é curto demais (Req. 10.6). */
export const BUSCA_RAPIDA_MSG_CURTO =
  'Informe no mínimo 3 caracteres para realizar a busca rápida.';

/**
 * Traduz a ordenação de domínio para o `orderBy` do Prisma (Req. 10.3).
 * Colunas de relação (cidadão, tipo, servidor) usam ordenação aninhada.
 * `null`/desconhecido cai no padrão `abertoEm desc` (mais recentes primeiro).
 */
export function montarOrderBy(
  ordenacao?: OrdenacaoAdmin,
): Prisma.ProcessoOrderByWithRelationInput {
  const direcao: Direcao = ordenacao?.direcao === 'asc' ? 'asc' : 'desc';
  switch (ordenacao?.ordenarPor) {
    case 'protocolo':
      return { protocolo: direcao };
    case 'cidadao':
      return { cidadao: { nome: direcao } };
    case 'tipo':
      return { tipoProcesso: { nome: direcao } };
    case 'status':
      return { status: direcao };
    case 'prazoFinal':
      return { prazoFinal: direcao };
    case 'servidor':
      return { servidorResponsavel: { nome: direcao } };
    case 'abertoEm':
      return { abertoEm: direcao };
    default:
      return { abertoEm: 'desc' };
  }
}

/**
 * Monta a cláusula `where` do Prisma a partir dos filtros combináveis (Req. 10.2).
 * Todos os filtros são opcionais e combináveis simultaneamente. Filtros de
 * intervalo (data de abertura e prazo) suportam limites inicial e final
 * independentes. CPF é normalizado para dígitos antes do match.
 */
export function montarWhere(filtros: FiltrosAdmin = {}): Prisma.ProcessoWhereInput {
  const where: Prisma.ProcessoWhereInput = {};

  if (filtros.tipoProcessoId) where.tipoProcessoId = filtros.tipoProcessoId;
  if (filtros.status) where.status = filtros.status;
  if (filtros.servidorResponsavelId) {
    where.servidorResponsavelId = filtros.servidorResponsavelId;
  }
  if (filtros.unidadeId) where.unidadeId = filtros.unidadeId;
  if (typeof filtros.prioridade === 'number') where.prioridade = filtros.prioridade;

  // Categoria não é coluna direta do Processo: filtra via relação com TipoProcesso.
  if (filtros.categoriaId) {
    where.tipoProcesso = { categoriaId: filtros.categoriaId };
  }

  // Intervalo de data de abertura (Req. 10.2).
  if (filtros.dataAberturaInicio || filtros.dataAberturaFim) {
    where.abertoEm = {
      ...(filtros.dataAberturaInicio ? { gte: filtros.dataAberturaInicio } : {}),
      ...(filtros.dataAberturaFim ? { lte: filtros.dataAberturaFim } : {}),
    };
  }

  // Intervalo de prazo (sobre prazoFinal) (Req. 10.2).
  if (filtros.prazoInicio || filtros.prazoFim) {
    where.prazoFinal = {
      ...(filtros.prazoInicio ? { gte: filtros.prazoInicio } : {}),
      ...(filtros.prazoFim ? { lte: filtros.prazoFim } : {}),
    };
  }

  // Nome do cidadão: correspondência parcial case-insensitive.
  if (filtros.nomeCidadao) {
    where.cidadao = {
      ...(where.cidadao ?? {}),
      nome: { contains: filtros.nomeCidadao, mode: 'insensitive' },
    };
  }

  // CPF do cidadão: normalizado para dígitos.
  if (filtros.cpfCidadao) {
    const cpf = desformatarCPF(filtros.cpfCidadao);
    where.cidadao = {
      ...(where.cidadao ?? {}),
      cpf,
    };
  }

  return where;
}

// ---------------------------------------------------------------------------
// Injeção de dependências (testes injetam prisma mockado)
// ---------------------------------------------------------------------------

export interface ProcessosAdminDeps {
  prisma: Pick<PrismaClient, 'processo'>;
}

function resolveDeps(deps?: Partial<ProcessosAdminDeps>): ProcessosAdminDeps {
  return {
    prisma: deps?.prisma ?? (realPrisma as unknown as ProcessosAdminDeps['prisma']),
  };
}

/** Include usado em todas as consultas de listagem (Req. 10.4). */
const INCLUDE_LISTAGEM = {
  cidadao: { select: { nome: true, cpf: true } },
  tipoProcesso: {
    select: { nome: true, categoria: { select: { nome: true } } },
  },
  servidorResponsavel: { select: { nome: true } },
  movimentacoes: {
    orderBy: { realizadoEm: 'desc' as const },
    take: 1,
    select: { realizadoEm: true },
  },
} satisfies Prisma.ProcessoInclude;

/** Linha da listagem administrativa (Req. 10.4). */
export interface ProcessoListaItem {
  protocolo: string;
  cidadao: string;
  categoria: string | null;
  tipoProcesso: string;
  status: string;
  statusCor: string;
  prazoFinal: Date;
  servidorResponsavel: string | null;
  ultimaMovimentacao: Date;
}

/** Formata uma linha crua do Prisma no formato de exibição da listagem. */
function formatarLinha(p: {
  protocolo: string;
  status: string;
  prazoFinal: Date;
  atualizadoEm: Date;
  cidadao: { nome: string } | null;
  tipoProcesso: { nome: string; categoria: { nome: string } | null } | null;
  servidorResponsavel: { nome: string } | null;
  movimentacoes: { realizadoEm: Date }[];
}): ProcessoListaItem {
  const ultimaMov = p.movimentacoes[0]?.realizadoEm ?? p.atualizadoEm;
  return {
    protocolo: p.protocolo,
    cidadao: p.cidadao?.nome ?? '',
    categoria: p.tipoProcesso?.categoria?.nome ?? null,
    tipoProcesso: p.tipoProcesso?.nome ?? '',
    status: p.status,
    statusCor: corDoStatus(p.status),
    prazoFinal: p.prazoFinal,
    servidorResponsavel: p.servidorResponsavel?.nome ?? null,
    ultimaMovimentacao: ultimaMov,
  };
}

// ---------------------------------------------------------------------------
// Listagem administrativa (Req. 10.1 – 10.4, 10.8)
// ---------------------------------------------------------------------------

/**
 * Lista processos de forma paginada aplicando filtros combináveis e ordenação
 * (Req. 10.1, 10.2, 10.3, 10.4). Quando nenhum processo corresponde aos
 * critérios, devolve `data` vazio junto do `meta` de paginação (Req. 10.8).
 */
export async function listarAdmin(
  filtros: FiltrosAdmin = {},
  paginacao: PaginacaoAdmin = {},
  ordenacao?: OrdenacaoAdmin,
  deps?: Partial<ProcessosAdminDeps>,
): Promise<PaginatedResult<ProcessoListaItem>> {
  const { prisma } = resolveDeps(deps);
  const { skip, take, page, pageSize } = getPaginationParams(
    paginacao.page,
    paginacao.pageSize ?? PAGE_SIZE_PADRAO,
  );

  const where = montarWhere(filtros);
  const orderBy = montarOrderBy(ordenacao);

  const [rows, total] = await Promise.all([
    prisma.processo.findMany({ where, include: INCLUDE_LISTAGEM, orderBy, skip, take }),
    prisma.processo.count({ where }),
  ]);

  const data = (rows as Parameters<typeof formatarLinha>[0][]).map(formatarLinha);
  return buildPaginatedResult(data, total, page, pageSize);
}

// ---------------------------------------------------------------------------
// Busca rápida (Req. 10.5, 10.6)
// ---------------------------------------------------------------------------

/**
 * Busca rápida por termo em protocolo, nome ou CPF do cidadão (Req. 10.5).
 *
 * Exige no mínimo 3 caracteres; termos menores lançam `badRequest` com mensagem
 * orientativa e a busca não é executada (Req. 10.6). A correspondência é parcial
 * e case-insensitive. O termo é normalizado para dígitos ao comparar com o CPF,
 * de modo que máscaras (pontos/traço) também funcionem. Resultado paginado
 * (Req. 10.1); meta preservada quando vazio (Req. 10.8).
 *
 * Alvo de desempenho ≤1s (Req. 10.5) depende dos índices de `protocolo` e
 * `cidadao.nome/cpf` definidos no schema.
 */
export async function buscaRapida(
  termo: string,
  paginacao: PaginacaoAdmin = {},
  deps?: Partial<ProcessosAdminDeps>,
): Promise<PaginatedResult<ProcessoListaItem>> {
  const termoLimpo = (termo ?? '').trim();
  if (termoLimpo.length < BUSCA_RAPIDA_MIN_CHARS) {
    throw badRequest(ErrorCodes.VALIDATION_ERROR, BUSCA_RAPIDA_MSG_CURTO, 'q');
  }

  const { prisma } = resolveDeps(deps);
  const { skip, take, page, pageSize } = getPaginationParams(
    paginacao.page,
    paginacao.pageSize ?? PAGE_SIZE_PADRAO,
  );

  // Só inclui a busca por CPF quando o termo contém dígitos.
  const digitos = desformatarCPF(termoLimpo);
  const or: Prisma.ProcessoWhereInput[] = [
    { protocolo: { contains: termoLimpo, mode: 'insensitive' } },
    { cidadao: { nome: { contains: termoLimpo, mode: 'insensitive' } } },
  ];
  if (digitos.length > 0) {
    or.push({ cidadao: { cpf: { contains: digitos } } });
  }

  const where: Prisma.ProcessoWhereInput = { OR: or };

  const [rows, total] = await Promise.all([
    prisma.processo.findMany({
      where,
      include: INCLUDE_LISTAGEM,
      orderBy: { abertoEm: 'desc' },
      skip,
      take,
    }),
    prisma.processo.count({ where }),
  ]);

  const data = (rows as Parameters<typeof formatarLinha>[0][]).map(formatarLinha);
  return buildPaginatedResult(data, total, page, pageSize);
}
