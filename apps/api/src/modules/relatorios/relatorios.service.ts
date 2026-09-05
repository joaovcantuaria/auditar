import { createRequire } from 'node:module';
import type { PrismaClient, Prisma } from '@prisma/client';
import { ErrorCodes, StatusProcesso } from '@auditar/shared';
import { prisma as realPrisma } from '../../config/database.js';
import { badRequest } from '../../utils/index.js';

/**
 * Serviço de Relatórios e Métricas (Req. 18).
 *
 * Estruturado de forma quase idêntica ao serviço de consulta de auditoria
 * (`auditoria.query.service.ts`): leitura filtrada + solicitação de exportação
 * (CSV/PDF) via enfileiramento em background com registro de status no Redis
 * (chave `relatorio:job:{jobId}` TTL 1h) + consulta de status. Todas as
 * dependências externas (prisma, redis, enqueue) são injetáveis, com defaults
 * resolvidos preguiçosamente via `createRequire` — importar este módulo não
 * abre nenhuma conexão.
 *
 * Cobre:
 *  - Geração dos cinco datasets de relatório com filtros combináveis, período
 *    padrão de 30 dias e validação de intervalo (Req. 18.1, 18.2, 18.7).
 *  - Exportação CSV/PDF via job em background com jobId (Req. 18.4, 18.5).
 *  - Consulta de status da exportação (Req. 18.5).
 *
 * As consultas usam `groupBy`/`count`/`aggregate` (agregação no banco) para
 * atender ao alvo de ≤5s em conjuntos ≤10.000 registros (Req. 18.2) sem
 * carregar todas as linhas em memória.
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Prefixo da chave de status do job de exportação no Redis (Req. 18.5). */
export const RELATORIO_STATUS_PREFIX = 'relatorio:job:';

/** TTL (segundos) do registro de status de exportação — 1 hora (Req. 18.5). */
export const RELATORIO_STATUS_TTL_SEG = 3600;

/** Nome da fila de relatórios (compartilhada por auditoria também). */
export const RELATORIO_QUEUE = 'relatorio';

/** Nome do job de exportação de relatório dentro da fila. */
export const RELATORIO_EXPORT_JOB = 'relatorio-export';

/** Formatos de exportação suportados (Req. 18.4). */
export const FORMATOS_RELATORIO = ['csv', 'pdf'] as const;
export type FormatoRelatorio = (typeof FORMATOS_RELATORIO)[number];

/** Período padrão aplicado quando nenhuma data é informada — 30 dias (Req. 18.2). */
export const PERIODO_PADRAO_DIAS = 30;

/** Intervalo máximo permitido entre dataInicio e dataFim — 366 dias (Req. 18.7). */
export const INTERVALO_MAX_DIAS = 366;

/** Milissegundos em um dia. */
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Estados possíveis de um job de exportação. */
export type RelatorioStatus = 'pendente' | 'processando' | 'concluido' | 'falhou';

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

/** Filtros combináveis dos relatórios (Req. 18.2). */
export interface FiltrosRelatorio {
  /** Início do intervalo sobre `abertoEm`. */
  dataInicio?: Date;
  /** Fim do intervalo sobre `abertoEm`. */
  dataFim?: Date;
  /** Categoria (via relação TipoProcesso.categoriaId). */
  categoriaId?: string;
  tipoProcessoId?: string;
  unidadeId?: string;
  servidorId?: string;
}

/** Filtros serializados (datas como ISO string) para transporte na fila. */
export interface FiltrosRelatorioSerializado {
  dataInicio?: string;
  dataFim?: string;
  categoriaId?: string;
  tipoProcessoId?: string;
  unidadeId?: string;
  servidorId?: string;
}

/** Registro de status persistido no Redis (Req. 18.5). */
export interface RelatorioStatusRecord {
  jobId: string;
  status: RelatorioStatus;
  formato: FormatoRelatorio;
  downloadUrl?: string;
  criadoEm: string;
}

// ---------------------------------------------------------------------------
// Período padrão + validação de intervalo (Req. 18.2, 18.7)
// ---------------------------------------------------------------------------

/**
 * Aplica o período padrão de 30 dias quando NENHUMA data é informada (Req. 18.2).
 * Quando o chamador informa ao menos uma das datas, os valores são preservados
 * como recebidos (a validação de intervalo é responsabilidade de
 * {@link validarIntervalo}).
 *
 * @param filtros filtros recebidos
 * @param agora   provedor de "agora" (injetável para testes determinísticos)
 */
export function aplicarPeriodoPadrao(
  filtros: FiltrosRelatorio = {},
  agora: () => Date = () => new Date(),
): FiltrosRelatorio {
  if (filtros.dataInicio || filtros.dataFim) {
    return { ...filtros };
  }
  const fim = agora();
  const inicio = new Date(fim.getTime() - PERIODO_PADRAO_DIAS * MS_POR_DIA);
  return { ...filtros, dataInicio: inicio, dataFim: fim };
}

/**
 * Valida o intervalo de datas (Req. 18.7):
 *  - `dataFim` deve ser ≥ `dataInicio`;
 *  - o intervalo não pode exceder 366 dias.
 * Lança `badRequest` em qualquer violação, impedindo a geração do relatório.
 */
export function validarIntervalo(filtros: FiltrosRelatorio): void {
  const { dataInicio, dataFim } = filtros;
  if (dataInicio && dataFim) {
    if (dataFim < dataInicio) {
      throw badRequest(
        ErrorCodes.VALIDATION_ERROR,
        'A data final deve ser maior ou igual à data inicial.',
        'dataFim',
      );
    }
    const dias = (dataFim.getTime() - dataInicio.getTime()) / MS_POR_DIA;
    if (dias > INTERVALO_MAX_DIAS) {
      throw badRequest(
        ErrorCodes.VALIDATION_ERROR,
        `O intervalo de datas não pode exceder ${INTERVALO_MAX_DIAS} dias.`,
        'dataFim',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Construção do `where` (Req. 18.2)
// ---------------------------------------------------------------------------

/**
 * Monta a cláusula `where` do Prisma a partir dos filtros combináveis (Req. 18.2).
 * O intervalo de datas incide sobre `abertoEm`. Categoria não é coluna direta do
 * Processo: é filtrada via relação com TipoProcesso (mesmo padrão da listagem
 * administrativa).
 */
export function montarWhereRelatorio(filtros: FiltrosRelatorio = {}): Prisma.ProcessoWhereInput {
  const where: Prisma.ProcessoWhereInput = {};

  if (filtros.tipoProcessoId) where.tipoProcessoId = filtros.tipoProcessoId;
  if (filtros.unidadeId) where.unidadeId = filtros.unidadeId;
  if (filtros.servidorId) where.servidorResponsavelId = filtros.servidorId;
  if (filtros.categoriaId) where.tipoProcesso = { categoriaId: filtros.categoriaId };

  if (filtros.dataInicio || filtros.dataFim) {
    where.abertoEm = {
      ...(filtros.dataInicio ? { gte: filtros.dataInicio } : {}),
      ...(filtros.dataFim ? { lte: filtros.dataFim } : {}),
    };
  }

  return where;
}

// ---------------------------------------------------------------------------
// Injeção de dependências
// ---------------------------------------------------------------------------

/** Interface mínima do Redis usada aqui (facilita testes/mocks). */
export interface RedisPort {
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

/** Interface mínima da fila usada pela exportação (injetável em testes). */
export interface RelatorioEnqueuer {
  add(name: string, data: RelatorioExportJobData): Promise<unknown>;
}

/** Payload enfileirado para o job de exportação de relatório. */
export interface RelatorioExportJobData {
  jobId: string;
  formato: FormatoRelatorio;
  filtros: FiltrosRelatorioSerializado;
  servidorId: string;
}

/** Superfície mínima do Prisma usada pelos relatórios. */
export type RelatorioPrisma = Pick<PrismaClient, 'processo' | 'tipoProcesso' | 'unidade' | 'servidor'>;

/** Dependências injetáveis do serviço de relatórios (testes injetam mocks). */
export interface RelatorioDeps {
  prisma: RelatorioPrisma;
  redis: RedisPort;
  enqueue: RelatorioEnqueuer;
}

/** Resolve o Redis real preguiçosamente (sem abrir conexão ao importar). */
function resolveRedis(): RedisPort {
  const requireLocal = createRequire(import.meta.url);
  const { redis } = requireLocal('../../config/redis.js') as { redis: RedisPort };
  return redis;
}

/** Resolve a fila real de exportação preguiçosamente. */
function resolveEnqueue(): RelatorioEnqueuer {
  const requireLocal = createRequire(import.meta.url);
  const { getQueue } = requireLocal('../../jobs/queues.js') as {
    getQueue: (name: string) => RelatorioEnqueuer;
  };
  return getQueue(RELATORIO_QUEUE);
}

function resolveDeps(deps?: Partial<RelatorioDeps>): RelatorioDeps {
  return {
    prisma: deps?.prisma ?? (realPrisma as unknown as RelatorioPrisma),
    redis: deps?.redis ?? resolveRedis(),
    enqueue: deps?.enqueue ?? resolveEnqueue(),
  };
}

// ---------------------------------------------------------------------------
// Datasets do relatório (Req. 18.1)
// ---------------------------------------------------------------------------

/** Volume de processos abertos por dia dentro do período (Req. 18.1). */
export interface VolumePorPeriodoItem {
  data: string; // YYYY-MM-DD
  total: number;
}

/** Tempo médio de resolução (em dias) por Tipo de Processo (Req. 18.1). */
export interface TempoMedioPorTipoItem {
  tipoProcessoId: string;
  tipoProcesso: string;
  tempoMedioDias: number | null;
  totalResolvidos: number;
}

/** Taxa de aprovação/rejeição por Unidade (Req. 18.1). */
export interface TaxaPorUnidadeItem {
  unidadeId: string;
  unidade: string;
  aprovados: number;
  rejeitados: number;
  total: number;
  taxaAprovacao: number; // 0..1
  taxaRejeicao: number; // 0..1
}

/** Processos vencidos por Servidor responsável (Req. 18.1). */
export interface VencidosPorServidorItem {
  servidorId: string | null;
  servidor: string;
  totalVencidos: number;
}

/** Volume de processos por Categoria (Req. 18.1). */
export interface VolumePorCategoriaItem {
  categoriaId: string;
  categoria: string;
  total: number;
}

/** Payload agregado com os cinco datasets do relatório (Req. 18.1). */
export interface RelatorioResultado {
  periodo: { dataInicio: string | null; dataFim: string | null };
  volumePorPeriodo: VolumePorPeriodoItem[];
  tempoMedioPorTipo: TempoMedioPorTipoItem[];
  taxaPorUnidade: TaxaPorUnidadeItem[];
  vencidosPorServidor: VencidosPorServidorItem[];
  volumePorCategoria: VolumePorCategoriaItem[];
}

/** Status considerados "aprovado" para efeito de taxa (Req. 18.1). */
const STATUS_APROVADO = [StatusProcesso.APROVADO, StatusProcesso.FINALIZADO] as string[];
const STATUS_REJEITADO = [StatusProcesso.REJEITADO] as string[];

/**
 * Volume de processos abertos por dia no período filtrado (Req. 18.1).
 * Agrupa por `abertoEm` no banco e consolida por data (YYYY-MM-DD) na aplicação
 * — o consolidado por dia mantém o resultado compacto para o alvo de ≤5s.
 */
export async function volumePorPeriodo(
  filtros: FiltrosRelatorio,
  prisma: RelatorioPrisma,
): Promise<VolumePorPeriodoItem[]> {
  const grupos = await prisma.processo.groupBy({
    by: ['abertoEm'],
    where: montarWhereRelatorio(filtros),
    _count: { _all: true },
  });

  const porDia = new Map<string, number>();
  for (const g of grupos as Array<{ abertoEm: Date; _count: { _all: number } }>) {
    const dia = toDiaISO(g.abertoEm);
    porDia.set(dia, (porDia.get(dia) ?? 0) + g._count._all);
  }

  return [...porDia.entries()]
    .map(([data, total]) => ({ data, total }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Tempo médio de resolução (em dias) por Tipo de Processo (Req. 18.1).
 * Considera apenas processos encerrados (`encerradoEm != null`) e calcula a
 * média de `encerradoEm - abertoEm`. Agrupa por `tipoProcessoId` no banco e
 * resolve os nomes dos tipos com uma consulta adicional.
 */
export async function tempoMedioPorTipo(
  filtros: FiltrosRelatorio,
  prisma: RelatorioPrisma,
): Promise<TempoMedioPorTipoItem[]> {
  const where: Prisma.ProcessoWhereInput = {
    ...montarWhereRelatorio(filtros),
    encerradoEm: { not: null },
  };

  const grupos = await prisma.processo.groupBy({
    by: ['tipoProcessoId'],
    where,
    _count: { _all: true },
  });

  const tipoIds = (grupos as Array<{ tipoProcessoId: string }>).map((g) => g.tipoProcessoId);
  const nomes = await mapaNomesTipo(tipoIds, prisma);

  // Média de duração calculada por tipo. Como o Prisma não agrega diferença de
  // datas nativamente, buscamos apenas as datas (colunas indexadas/leves) por
  // tipo e calculamos a média em memória — o filtro mantém o conjunto pequeno.
  const resultado: TempoMedioPorTipoItem[] = [];
  for (const g of grupos as Array<{ tipoProcessoId: string; _count: { _all: number } }>) {
    const rows = (await prisma.processo.findMany({
      where: { ...where, tipoProcessoId: g.tipoProcessoId },
      select: { abertoEm: true, encerradoEm: true },
    })) as Array<{ abertoEm: Date; encerradoEm: Date | null }>;

    const duracoes = rows
      .filter((r) => r.encerradoEm != null)
      .map((r) => (r.encerradoEm!.getTime() - r.abertoEm.getTime()) / MS_POR_DIA)
      .filter((d) => Number.isFinite(d) && d >= 0);

    const tempoMedioDias =
      duracoes.length > 0
        ? duracoes.reduce((acc, d) => acc + d, 0) / duracoes.length
        : null;

    resultado.push({
      tipoProcessoId: g.tipoProcessoId,
      tipoProcesso: nomes.get(g.tipoProcessoId) ?? g.tipoProcessoId,
      tempoMedioDias: tempoMedioDias === null ? null : arredondar(tempoMedioDias, 2),
      totalResolvidos: duracoes.length,
    });
  }

  return resultado.sort((a, b) => a.tipoProcesso.localeCompare(b.tipoProcesso));
}

/**
 * Taxa de aprovação e rejeição por Unidade (Req. 18.1).
 * Agrupa por `unidadeId` + `status` no banco, consolidando as contagens de
 * aprovados/rejeitados por unidade e derivando as taxas.
 */
export async function taxaPorUnidade(
  filtros: FiltrosRelatorio,
  prisma: RelatorioPrisma,
): Promise<TaxaPorUnidadeItem[]> {
  const grupos = await prisma.processo.groupBy({
    by: ['unidadeId', 'status'],
    where: montarWhereRelatorio(filtros),
    _count: { _all: true },
  });

  const acc = new Map<string, { aprovados: number; rejeitados: number; total: number }>();
  for (const g of grupos as Array<{ unidadeId: string; status: string; _count: { _all: number } }>) {
    const atual = acc.get(g.unidadeId) ?? { aprovados: 0, rejeitados: 0, total: 0 };
    atual.total += g._count._all;
    if (STATUS_APROVADO.includes(g.status)) atual.aprovados += g._count._all;
    if (STATUS_REJEITADO.includes(g.status)) atual.rejeitados += g._count._all;
    acc.set(g.unidadeId, atual);
  }

  const nomes = await mapaNomesUnidade([...acc.keys()], prisma);

  return [...acc.entries()]
    .map(([unidadeId, c]) => ({
      unidadeId,
      unidade: nomes.get(unidadeId) ?? unidadeId,
      aprovados: c.aprovados,
      rejeitados: c.rejeitados,
      total: c.total,
      taxaAprovacao: c.total > 0 ? arredondar(c.aprovados / c.total, 4) : 0,
      taxaRejeicao: c.total > 0 ? arredondar(c.rejeitados / c.total, 4) : 0,
    }))
    .sort((a, b) => a.unidade.localeCompare(b.unidade));
}

/**
 * Processos vencidos por Servidor responsável (Req. 18.1).
 * Vencido = status `vencido`. Agrupa por `servidorResponsavelId` no banco.
 */
export async function vencidosPorServidor(
  filtros: FiltrosRelatorio,
  prisma: RelatorioPrisma,
): Promise<VencidosPorServidorItem[]> {
  const where: Prisma.ProcessoWhereInput = {
    ...montarWhereRelatorio(filtros),
    status: StatusProcesso.VENCIDO,
  };

  const grupos = await prisma.processo.groupBy({
    by: ['servidorResponsavelId'],
    where,
    _count: { _all: true },
  });

  const ids = (grupos as Array<{ servidorResponsavelId: string | null }>)
    .map((g) => g.servidorResponsavelId)
    .filter((id): id is string => typeof id === 'string');
  const nomes = await mapaNomesServidor(ids, prisma);

  return (grupos as Array<{ servidorResponsavelId: string | null; _count: { _all: number } }>)
    .map((g) => ({
      servidorId: g.servidorResponsavelId,
      servidor:
        g.servidorResponsavelId === null
          ? 'Sem responsável'
          : nomes.get(g.servidorResponsavelId) ?? g.servidorResponsavelId,
      totalVencidos: g._count._all,
    }))
    .sort((a, b) => b.totalVencidos - a.totalVencidos);
}

/**
 * Volume de processos por Categoria (Req. 18.1).
 * Categoria não é coluna do Processo — agrupamos por `tipoProcessoId` no banco e
 * consolidamos por categoria através do mapa Tipo → Categoria.
 */
export async function volumePorCategoria(
  filtros: FiltrosRelatorio,
  prisma: RelatorioPrisma,
): Promise<VolumePorCategoriaItem[]> {
  const grupos = await prisma.processo.groupBy({
    by: ['tipoProcessoId'],
    where: montarWhereRelatorio(filtros),
    _count: { _all: true },
  });

  const tipoIds = (grupos as Array<{ tipoProcessoId: string }>).map((g) => g.tipoProcessoId);
  const tipos = (await prisma.tipoProcesso.findMany({
    where: { id: { in: tipoIds } },
    select: { id: true, categoriaId: true, categoria: { select: { nome: true } } },
  })) as Array<{ id: string; categoriaId: string; categoria: { nome: string } | null }>;

  const tipoParaCategoria = new Map<string, { categoriaId: string; nome: string }>();
  for (const t of tipos) {
    tipoParaCategoria.set(t.id, {
      categoriaId: t.categoriaId,
      nome: t.categoria?.nome ?? t.categoriaId,
    });
  }

  const acc = new Map<string, { categoria: string; total: number }>();
  for (const g of grupos as Array<{ tipoProcessoId: string; _count: { _all: number } }>) {
    const cat = tipoParaCategoria.get(g.tipoProcessoId);
    if (!cat) continue;
    const atual = acc.get(cat.categoriaId) ?? { categoria: cat.nome, total: 0 };
    atual.total += g._count._all;
    acc.set(cat.categoriaId, atual);
  }

  return [...acc.entries()]
    .map(([categoriaId, c]) => ({ categoriaId, categoria: c.categoria, total: c.total }))
    .sort((a, b) => a.categoria.localeCompare(b.categoria));
}

// ---------------------------------------------------------------------------
// Helpers de resolução de nomes
// ---------------------------------------------------------------------------

async function mapaNomesTipo(
  ids: string[],
  prisma: RelatorioPrisma,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = (await prisma.tipoProcesso.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true },
  })) as Array<{ id: string; nome: string }>;
  return new Map(rows.map((r) => [r.id, r.nome]));
}

async function mapaNomesUnidade(
  ids: string[],
  prisma: RelatorioPrisma,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = (await prisma.unidade.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true },
  })) as Array<{ id: string; nome: string }>;
  return new Map(rows.map((r) => [r.id, r.nome]));
}

async function mapaNomesServidor(
  ids: string[],
  prisma: RelatorioPrisma,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = (await prisma.servidor.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true },
  })) as Array<{ id: string; nome: string }>;
  return new Map(rows.map((r) => [r.id, r.nome]));
}

/** Converte um Date para a string de dia ISO (YYYY-MM-DD, UTC). */
function toDiaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Arredonda `n` para `casas` casas decimais. */
function arredondar(n: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Geração do relatório (Req. 18.1, 18.2, 18.7)
// ---------------------------------------------------------------------------

/**
 * Gera os cinco datasets do relatório aplicando o período padrão de 30 dias
 * (quando nenhuma data é informada) e validando o intervalo (Req. 18.1, 18.2,
 * 18.7). Cada dataset é computado por um helper individualmente testável. As
 * consultas rodam em paralelo para reduzir a latência total (alvo ≤5s).
 */
export async function gerarRelatorio(
  filtros: FiltrosRelatorio = {},
  deps?: Partial<RelatorioDeps>,
  agora: () => Date = () => new Date(),
): Promise<RelatorioResultado> {
  const comPeriodo = aplicarPeriodoPadrao(filtros, agora);
  validarIntervalo(comPeriodo);

  const { prisma } = resolveDeps(deps);

  const [porPeriodo, porTipo, porUnidade, porServidor, porCategoria] = await Promise.all([
    volumePorPeriodo(comPeriodo, prisma),
    tempoMedioPorTipo(comPeriodo, prisma),
    taxaPorUnidade(comPeriodo, prisma),
    vencidosPorServidor(comPeriodo, prisma),
    volumePorCategoria(comPeriodo, prisma),
  ]);

  return {
    periodo: {
      dataInicio: comPeriodo.dataInicio?.toISOString() ?? null,
      dataFim: comPeriodo.dataFim?.toISOString() ?? null,
    },
    volumePorPeriodo: porPeriodo,
    tempoMedioPorTipo: porTipo,
    taxaPorUnidade: porUnidade,
    vencidosPorServidor: porServidor,
    volumePorCategoria: porCategoria,
  };
}

// ---------------------------------------------------------------------------
// Exportação (Req. 18.4, 18.5)
// ---------------------------------------------------------------------------

/** Serializa filtros para transporte na fila (datas → ISO string). */
export function serializarFiltros(filtros: FiltrosRelatorio): FiltrosRelatorioSerializado {
  return {
    dataInicio: filtros.dataInicio?.toISOString(),
    dataFim: filtros.dataFim?.toISOString(),
    categoriaId: filtros.categoriaId,
    tipoProcessoId: filtros.tipoProcessoId,
    unidadeId: filtros.unidadeId,
    servidorId: filtros.servidorId,
  };
}

/** Desserializa filtros vindos da fila (ISO string → Date). */
export function desserializarFiltros(f: FiltrosRelatorioSerializado): FiltrosRelatorio {
  return {
    dataInicio: f.dataInicio ? new Date(f.dataInicio) : undefined,
    dataFim: f.dataFim ? new Date(f.dataFim) : undefined,
    categoriaId: f.categoriaId,
    tipoProcessoId: f.tipoProcessoId,
    unidadeId: f.unidadeId,
    servidorId: f.servidorId,
  };
}

/** Gera um identificador de job de exportação. */
function gerarJobId(): string {
  const requireLocal = createRequire(import.meta.url);
  const { randomUUID } = requireLocal('node:crypto') as typeof import('node:crypto');
  return randomUUID();
}

/** Chave Redis do status de um job de exportação. */
export function chaveStatusRelatorio(jobId: string): string {
  return `${RELATORIO_STATUS_PREFIX}${jobId}`;
}

/**
 * Solicita a exportação de um relatório (Req. 18.4, 18.5).
 *
 * Valida o formato (csv|pdf) e o intervalo de datas (com o período padrão de 30
 * dias aplicado quando ausente), grava um registro de status inicial no Redis
 * (`relatorio:job:{jobId}`, TTL 1h) e enfileira um job na fila `relatorio`.
 * Mesmo para conjuntos ≤10.000 registros (que o design permite processar de
 * forma síncrona), a geração é sempre enfileirada para uniformizar o caminho de
 * exportação com o de auditoria (Req. 18.5).
 *
 * @returns o `jobId` para acompanhamento posterior via {@link statusExportacao}.
 */
export async function solicitarExportacao(
  formato: string,
  servidorId: string,
  filtros: FiltrosRelatorio = {},
  deps?: Partial<RelatorioDeps>,
  agora: () => Date = () => new Date(),
): Promise<{ jobId: string }> {
  if (!FORMATOS_RELATORIO.includes(formato as FormatoRelatorio)) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `Formato inválido. Use um de: ${FORMATOS_RELATORIO.join(', ')}.`,
      'formato',
    );
  }

  const comPeriodo = aplicarPeriodoPadrao(filtros, agora);
  validarIntervalo(comPeriodo);

  const { redis, enqueue } = resolveDeps(deps);
  const jobId = gerarJobId();
  const formatoValido = formato as FormatoRelatorio;

  const statusInicial: RelatorioStatusRecord = {
    jobId,
    status: 'pendente',
    formato: formatoValido,
    criadoEm: agora().toISOString(),
  };

  await redis.set(
    chaveStatusRelatorio(jobId),
    JSON.stringify(statusInicial),
    'EX',
    RELATORIO_STATUS_TTL_SEG,
  );

  await enqueue.add(RELATORIO_EXPORT_JOB, {
    jobId,
    formato: formatoValido,
    filtros: serializarFiltros(comPeriodo),
    servidorId,
  });

  return { jobId };
}

/**
 * Lê o status de um job de exportação a partir do Redis (Req. 18.5).
 * Retorna `null` quando a chave não existe (job desconhecido/expirado).
 */
export async function statusExportacao(
  jobId: string,
  deps?: Partial<RelatorioDeps>,
): Promise<RelatorioStatusRecord | null> {
  const { redis } = resolveDeps(deps);
  const raw = await redis.get(chaveStatusRelatorio(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RelatorioStatusRecord;
  } catch {
    return null;
  }
}
