import { createRequire } from 'node:module';
import type { PrismaClient, Prisma } from '@prisma/client';
import { StatusProcesso, StatusTarefa, calcularPrazoFinal } from '@auditar/shared';
import { prisma as realPrisma } from '../../config/database.js';

/**
 * Serviço de Dashboard por perfil (Task 10.1, Requisito 9).
 *
 * Expõe quatro funções de agregação, uma por perfil:
 *  - {@link dashboardAnalista}       (Req 9.1)
 *  - {@link dashboardGestorUnidade}  (Req 9.2)
 *  - {@link dashboardGestorCategoria}(Req 9.3)
 *  - {@link dashboardGestorGeral}    (Req 9.4)
 *
 * Cada função:
 *  - é injetável por dependências (`prisma`, `redis`, `emit`) com defaults reais
 *    resolvidos preguiçosamente — importar este módulo NÃO abre conexão com
 *    Prisma/Redis nem exige o servidor Socket.io;
 *  - envolve a resposta em cache Redis `cache:dashboard:{role}:{id}` TTL 300s
 *    (Req 9.5): cache hit devolve o valor sem recomputar; cache miss computa e
 *    grava;
 *  - computa cada indicador via {@link safe}, de modo que a falha de UM
 *    indicador o marca como `{ value: null, erro: true }` sem derrubar os
 *    demais (Req 9.6).
 *
 * A cada indicador corresponde uma pequena função pura-ish (recebe `prisma` +
 * `where`/janela) individualmente testável com um Prisma mockado.
 *
 * Requisitos: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Prefixo da chave de cache do dashboard no Redis (Req 9.5). */
export const DASHBOARD_CACHE_PREFIX = 'cache:dashboard:';

/** TTL do cache do dashboard — 5 minutos, em segundos (Req 9.5). */
export const DASHBOARD_CACHE_TTL_SEG = 300;

/** Milissegundos em um dia (para janelas de tempo). */
const MS_DIA = 24 * 60 * 60 * 1000;

/** Perfis de dashboard suportados. */
export type DashboardRole =
  | 'analista'
  | 'gestor-unidade'
  | 'gestor-categoria'
  | 'gestor-geral';

// ---------------------------------------------------------------------------
// Injeção de dependências
// ---------------------------------------------------------------------------

/** Interface mínima do Redis usada aqui (facilita testes/mocks). */
export interface RedisPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** Assinatura da emissão de eventos em tempo real via Socket.io. */
export type EmitFn = (room: string, event: string, payload: unknown) => void;

/** Prisma mínimo exigido pelas agregações do dashboard. */
export type PrismaDashboard = Pick<
  PrismaClient,
  'processo' | 'servidor' | 'unidade' | 'categoria'
>;

/** Dependências injetáveis (testes injetam mocks). */
export interface DashboardDeps {
  prisma: PrismaDashboard;
  redis: RedisPort;
  emit: EmitFn;
}

/** Resolve o Redis real preguiçosamente (sem abrir conexão ao importar). */
function resolveRedis(): RedisPort {
  const requireLocal = createRequire(import.meta.url);
  const { redis } = requireLocal('../../config/redis.js') as { redis: RedisPort };
  return redis;
}

/**
 * Resolve preguiçosamente a função de emissão do Socket.io (tarefa 9.3). Se o
 * servidor Socket.io ainda não existir, cai silenciosamente em um no-op — assim
 * um futuro scheduler/bootstrap pode chamar {@link emitirAtualizacaoDashboard}
 * sem alterar este arquivo.
 */
function resolveEmit(): EmitFn {
  try {
    const requireLocal = createRequire(import.meta.url);
    const { getIO } = requireLocal('../../socket/socket.server.js') as {
      getIO: () => { to: (room: string) => { emit: (e: string, p: unknown) => void } };
    };
    return (room, event, payload) => {
      getIO().to(room).emit(event, payload);
    };
  } catch {
    return () => {}; /* Socket.io (tarefa 9.3) ainda não existe — no-op */
  }
}

function resolveDeps(deps?: Partial<DashboardDeps>): DashboardDeps {
  return {
    prisma: deps?.prisma ?? (realPrisma as unknown as PrismaDashboard),
    redis: deps?.redis ?? resolveRedis(),
    emit: deps?.emit ?? resolveEmit(),
  };
}

// ---------------------------------------------------------------------------
// Resiliência por indicador (Req 9.6)
// ---------------------------------------------------------------------------

/** Envelope de um indicador: valor calculado OU sentinela de erro (Req 9.6). */
export interface Indicador<T> {
  value: T | null;
  erro: boolean;
}

/**
 * Executa a computação de um indicador capturando qualquer erro. Em caso de
 * falha, devolve `{ value: null, erro: true }` para que a resposta do dashboard
 * continue entregando os demais indicadores (Req 9.6).
 */
export async function safe<T>(fn: () => Promise<T>): Promise<Indicador<T>> {
  try {
    return { value: await fn(), erro: false };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'dashboard.service',
        event: 'indicador_falhou',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { value: null, erro: true };
  }
}

// ---------------------------------------------------------------------------
// Camada de cache (Req 9.5)
// ---------------------------------------------------------------------------

/** Monta a chave de cache do dashboard para um perfil e id de escopo. */
export function chaveCacheDashboard(role: DashboardRole, id: string): string {
  return `${DASHBOARD_CACHE_PREFIX}${role}:${id}`;
}

/**
 * Lê do cache (hit → devolve valor desserializado sem recomputar); em miss,
 * executa `compute`, grava o resultado com TTL 300s e o devolve (Req 9.5).
 * A camada é injetável (via `redis`) para os testes exercitarem hit e miss.
 */
export async function comCache<T>(
  redis: RedisPort,
  role: DashboardRole,
  id: string,
  compute: () => Promise<T>,
): Promise<T> {
  const chave = chaveCacheDashboard(role, id);

  const cacheado = await redis.get(chave);
  if (cacheado) {
    try {
      return JSON.parse(cacheado) as T;
    } catch {
      /* cache corrompido: recomputa abaixo */
    }
  }

  const resultado = await compute();
  await redis.set(chave, JSON.stringify(resultado), 'EX', DASHBOARD_CACHE_TTL_SEG);
  return resultado;
}

/**
 * Invalida o cache do dashboard de um perfil/escopo (Req 9.5). Deve ser chamado
 * por escritas relevantes em outros módulos (ex.: avanço de etapa, atribuição).
 */
export async function invalidarCacheDashboard(
  role: DashboardRole,
  id: string,
  deps?: Partial<DashboardDeps>,
): Promise<void> {
  const { redis } = resolveDeps(deps);
  await redis.del(chaveCacheDashboard(role, id));
}

/**
 * Emite o evento `dashboard:atualizar` para uma room, sinalizando ao frontend
 * que atualize os indicadores sem reload (Req 9.5). Nunca propaga erro. NÃO
 * agenda nada — um futuro scheduler/bootstrap deve invocá-lo a cada 5 min.
 */
export function emitirAtualizacaoDashboard(
  room: string,
  deps?: Partial<DashboardDeps>,
): void {
  // Resolve apenas o emit — não força a resolução de prisma/redis, que abririam
  // conexões desnecessárias (e falhariam em contextos de teste sem Redis).
  const emit = deps?.emit ?? resolveEmit();
  try {
    emit(room, 'dashboard:atualizar', { room, em: new Date().toISOString() });
  } catch {
    /* nunca propaga */
  }
}

// ---------------------------------------------------------------------------
// Utilidades de janela temporal
// ---------------------------------------------------------------------------

/** Retorna a data de `dias` atrás a partir de `agora`. */
export function desdeDiasAtras(dias: number, agora: Date = new Date()): Date {
  return new Date(agora.getTime() - dias * MS_DIA);
}

/** Chave de dia (YYYY-MM-DD) em UTC para agrupamento diário. */
function chaveDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Chave de semana (ano-Wsemana ISO simplificada) em UTC. */
function chaveSemana(d: Date): string {
  const ms = d.getTime();
  const inicioAno = Date.UTC(d.getUTCFullYear(), 0, 1);
  const semana = Math.floor((ms - inicioAno) / (7 * MS_DIA)) + 1;
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Helpers de agregação (individualmente testáveis)
// ---------------------------------------------------------------------------

/** Contagem por status: `{ [status]: total }`. */
export type PorStatus = Record<string, number>;

/**
 * Agrupa processos por status dentro de um `where` (Req 9.1, 9.2). Usa
 * `groupBy` do Prisma e reduz para um mapa status → contagem.
 */
export async function processosPorStatus(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
): Promise<PorStatus> {
  const grupos = (await prisma.processo.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  } as never)) as unknown as Array<{ status: string; _count: { _all: number } }>;

  const out: PorStatus = {};
  for (const g of grupos) out[g.status] = g._count._all;
  return out;
}

/** Contagem simples de processos que satisfazem `where`. */
export async function contarProcessos(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
): Promise<number> {
  return prisma.processo.count({ where });
}

/**
 * Processos vencendo em ≤ `horas` horas (por padrão 24h) que ainda não foram
 * encerrados (Req 9.1). Filtra por `prazoFinal` entre agora e agora+horas.
 */
export async function contarVencendoEm(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
  horas = 24,
  agora: Date = new Date(),
): Promise<number> {
  const limite = new Date(agora.getTime() + horas * 60 * 60 * 1000);
  return prisma.processo.count({
    where: {
      ...where,
      encerradoEm: null,
      prazoFinal: { gte: agora, lte: limite },
    },
  });
}

/**
 * Tempo médio de resolução, em horas, dos processos encerrados desde `desde`
 * (Req 9.1). Lê `abertoEm`/`encerradoEm` e calcula a média das diferenças.
 * Retorna 0 quando não há processos encerrados na janela.
 */
export async function tempoMedioResolucao(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
  desde: Date,
): Promise<number> {
  const rows = (await prisma.processo.findMany({
    where: { ...where, encerradoEm: { not: null, gte: desde } },
    select: { abertoEm: true, encerradoEm: true },
  })) as Array<{ abertoEm: Date; encerradoEm: Date | null }>;

  if (rows.length === 0) return 0;

  const totalHoras = rows.reduce((acc, r) => {
    if (!r.encerradoEm) return acc;
    return acc + (r.encerradoEm.getTime() - r.abertoEm.getTime()) / (60 * 60 * 1000);
  }, 0);

  return Math.round((totalHoras / rows.length) * 100) / 100;
}

/** Item de série diária: dia (YYYY-MM-DD) + total. */
export interface SerieDia {
  dia: string;
  total: number;
}

/**
 * Produtividade/volume diário desde `desde` (Req 9.1, 9.2). Agrupa processos
 * por dia de `abertoEm` (em memória, a partir do `findMany`) e devolve uma
 * série ordenada por dia crescente.
 */
export async function produtividadeDiaria(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
  desde: Date,
  campo: 'abertoEm' | 'encerradoEm' = 'abertoEm',
): Promise<SerieDia[]> {
  const rows = (await prisma.processo.findMany({
    where: { ...where, [campo]: { gte: desde } },
    select: { [campo]: true } as never,
  })) as Array<Record<string, Date | null>>;

  const contagem = new Map<string, number>();
  for (const r of rows) {
    const d = r[campo];
    if (!d) continue;
    const k = chaveDia(d);
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .map(([dia, total]) => ({ dia, total }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Item de série semanal: semana (YYYY-Wnn) + total. */
export interface SerieSemana {
  semana: string;
  total: number;
}

/**
 * Volume semanal desde `desde` (Req 9.4). Agrupa por semana de `abertoEm`.
 */
export async function volumeSemanal(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
  desde: Date,
): Promise<SerieSemana[]> {
  const rows = (await prisma.processo.findMany({
    where: { ...where, abertoEm: { gte: desde } },
    select: { abertoEm: true },
  })) as Array<{ abertoEm: Date }>;

  const contagem = new Map<string, number>();
  for (const r of rows) {
    const k = chaveSemana(r.abertoEm);
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .map(([semana, total]) => ({ semana, total }))
    .sort((a, b) => a.semana.localeCompare(b.semana));
}

/** Taxas de aprovação/rejeição em porcentagem sobre os processos encerrados. */
export interface TaxaAprovacaoRejeicao {
  aprovados: number;
  rejeitados: number;
  taxaAprovacao: number;
  taxaRejeicao: number;
}

/**
 * Taxa de aprovação/rejeição sobre os processos encerrados desde `desde`
 * (Req 9.2). A base do percentual é (aprovados + rejeitados). Sem encerrados,
 * as taxas são 0.
 */
export async function taxaAprovacaoRejeicao(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
  desde: Date,
): Promise<TaxaAprovacaoRejeicao> {
  const [aprovados, rejeitados] = await Promise.all([
    prisma.processo.count({
      where: { ...where, status: StatusProcesso.APROVADO, encerradoEm: { gte: desde } },
    }),
    prisma.processo.count({
      where: { ...where, status: StatusProcesso.REJEITADO, encerradoEm: { gte: desde } },
    }),
  ]);

  const base = aprovados + rejeitados;
  const taxaAprovacao = base === 0 ? 0 : Math.round((aprovados / base) * 10000) / 100;
  const taxaRejeicao = base === 0 ? 0 : Math.round((rejeitados / base) * 10000) / 100;

  return { aprovados, rejeitados, taxaAprovacao, taxaRejeicao };
}

/** Carga (processos ativos) por servidor da unidade. */
export interface CargaServidor {
  servidorId: string;
  nome: string;
  ativos: number;
}

/** Status considerados "ativos" (não encerrados) para a carga por servidor. */
const STATUS_ATIVOS: string[] = [
  StatusProcesso.ABERTO,
  StatusProcesso.EM_ANDAMENTO,
  StatusProcesso.AGUARDANDO_DOCS,
  StatusProcesso.AGUARDANDO_CIDADAO,
  StatusProcesso.VENCIDO,
];

/**
 * Carga de trabalho por servidor ativo da unidade (Req 9.2). Para cada servidor
 * ativo lotado na unidade, conta os processos atribuídos em status ativo.
 */
export async function cargaPorServidor(
  prisma: Pick<PrismaClient, 'servidor' | 'processo'>,
  unidadeId: string,
): Promise<CargaServidor[]> {
  const servidores = (await prisma.servidor.findMany({
    where: { unidadeId, ativo: true },
    select: { id: true, nome: true },
  })) as Array<{ id: string; nome: string }>;

  return Promise.all(
    servidores.map(async (s) => ({
      servidorId: s.id,
      nome: s.nome,
      ativos: await prisma.processo.count({
        where: { servidorResponsavelId: s.id, status: { in: STATUS_ATIVOS } },
      }),
    })),
  );
}

/** Totais por status agrupados por uma dimensão (unidade/categoria). */
export interface GrupoDimensao {
  id: string;
  nome: string;
  porStatus: PorStatus;
}

/**
 * Totais por status agrupados por unidade dentro de uma categoria (Req 9.3).
 * Para cada unidade que atende a categoria, calcula os processos por status.
 */
export async function porStatusPorUnidadeNaCategoria(
  prisma: Pick<PrismaClient, 'unidade' | 'processo'>,
  categoriaId: string,
): Promise<GrupoDimensao[]> {
  const unidades = (await prisma.unidade.findMany({
    where: { tiposProcesso: { some: { tipoProcesso: { categoriaId } } } },
    select: { id: true, nome: true },
  })) as Array<{ id: string; nome: string }>;

  return Promise.all(
    unidades.map(async (u) => ({
      id: u.id,
      nome: u.nome,
      porStatus: await processosPorStatus(prisma, {
        unidadeId: u.id,
        tipoProcesso: { categoriaId },
      }),
    })),
  );
}

/** Tempo médio de resolução por tipo de processo. */
export interface TempoMedioPorTipo {
  tipoProcessoId: string;
  nome: string;
  horas: number;
}

/**
 * Tempo médio de resolução por tipo de processo dentro de uma categoria,
 * desde `desde` (Req 9.3).
 */
export async function tempoMedioPorTipo(
  prisma: Pick<PrismaClient, 'processo'>,
  categoriaId: string,
  desde: Date,
): Promise<TempoMedioPorTipo[]> {
  const rows = (await prisma.processo.findMany({
    where: {
      tipoProcesso: { categoriaId },
      encerradoEm: { not: null, gte: desde },
    },
    select: {
      tipoProcessoId: true,
      abertoEm: true,
      encerradoEm: true,
      tipoProcesso: { select: { nome: true } },
    },
  })) as Array<{
    tipoProcessoId: string;
    abertoEm: Date;
    encerradoEm: Date | null;
    tipoProcesso: { nome: string } | null;
  }>;

  const acc = new Map<string, { nome: string; totalHoras: number; n: number }>();
  for (const r of rows) {
    if (!r.encerradoEm) continue;
    const horas = (r.encerradoEm.getTime() - r.abertoEm.getTime()) / (60 * 60 * 1000);
    const cur = acc.get(r.tipoProcessoId) ?? {
      nome: r.tipoProcesso?.nome ?? '',
      totalHoras: 0,
      n: 0,
    };
    cur.totalHoras += horas;
    cur.n += 1;
    acc.set(r.tipoProcessoId, cur);
  }

  return [...acc.entries()].map(([tipoProcessoId, v]) => ({
    tipoProcessoId,
    nome: v.nome,
    horas: v.n === 0 ? 0 : Math.round((v.totalHoras / v.n) * 100) / 100,
  }));
}

/**
 * Totais por status agrupados por categoria (Req 9.4). Para cada categoria
 * ativa, calcula os processos por status via relação com o TipoProcesso.
 */
export async function porStatusPorCategoria(
  prisma: Pick<PrismaClient, 'categoria' | 'processo'>,
): Promise<GrupoDimensao[]> {
  const categorias = (await prisma.categoria.findMany({
    where: { ativa: true },
    select: { id: true, nome: true },
  })) as Array<{ id: string; nome: string }>;

  return Promise.all(
    categorias.map(async (c) => ({
      id: c.id,
      nome: c.nome,
      porStatus: await processosPorStatus(prisma, { tipoProcesso: { categoriaId: c.id } }),
    })),
  );
}

/** Comparação de dois períodos consecutivos de mesma duração. */
export interface ComparacaoPeriodos {
  periodoAtual: number;
  periodoAnterior: number;
  variacaoPercentual: number;
}

/**
 * Compara o volume de processos abertos em dois períodos consecutivos de
 * `dias` dias (Req 9.4). `variacaoPercentual` é relativa ao período anterior;
 * quando o anterior é 0, a variação é 0 (evita divisão por zero).
 */
export async function compararPeriodos(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
  dias: number,
  agora: Date = new Date(),
): Promise<ComparacaoPeriodos> {
  const inicioAtual = new Date(agora.getTime() - dias * MS_DIA);
  const inicioAnterior = new Date(agora.getTime() - 2 * dias * MS_DIA);

  const [periodoAtual, periodoAnterior] = await Promise.all([
    prisma.processo.count({ where: { ...where, abertoEm: { gte: inicioAtual, lte: agora } } }),
    prisma.processo.count({
      where: { ...where, abertoEm: { gte: inicioAnterior, lt: inicioAtual } },
    }),
  ]);

  const variacaoPercentual =
    periodoAnterior === 0
      ? 0
      : Math.round(((periodoAtual - periodoAnterior) / periodoAnterior) * 10000) / 100;

  return { periodoAtual, periodoAnterior, variacaoPercentual };
}

// ---------------------------------------------------------------------------
// Dashboards por perfil (Req 9.1 – 9.4), com cache (Req 9.5) e resiliência (9.6)
// ---------------------------------------------------------------------------

/** Resposta do dashboard do Analista (Req 9.1). */
export interface DashboardAnalista {
  porStatus: Indicador<PorStatus>;
  vencendoEm24h: Indicador<number>;
  tempoMedioResolucaoHoras: Indicador<number>;
  produtividadeDiaria: Indicador<SerieDia[]>;
}

/**
 * Dashboard do Analista (Req 9.1): processos por status atribuídos a ele,
 * vencendo em ≤24h, tempo médio de resolução (30 dias) e produtividade diária
 * (30 dias). Resultado cacheado por 5 min em `cache:dashboard:analista:{id}`.
 */
export async function dashboardAnalista(
  servidorId: string,
  deps?: Partial<DashboardDeps>,
  agora: Date = new Date(),
): Promise<DashboardAnalista> {
  const { prisma, redis } = resolveDeps(deps);
  const where: Prisma.ProcessoWhereInput = { servidorResponsavelId: servidorId };
  const desde30 = desdeDiasAtras(30, agora);

  return comCache(redis, 'analista', servidorId, async () => {
    const [porStatus, vencendoEm24h, tempo, prod] = await Promise.all([
      safe(() => processosPorStatus(prisma, where)),
      safe(() => contarVencendoEm(prisma, where, 24, agora)),
      safe(() => tempoMedioResolucao(prisma, where, desde30)),
      safe(() => produtividadeDiaria(prisma, where, desde30, 'encerradoEm')),
    ]);
    return {
      porStatus,
      vencendoEm24h,
      tempoMedioResolucaoHoras: tempo,
      produtividadeDiaria: prod,
    };
  });
}

/** Resposta do dashboard do Gestor de Unidade (Req 9.2). */
export interface DashboardGestorUnidade {
  porStatus: Indicador<PorStatus>;
  cargaPorServidor: Indicador<CargaServidor[]>;
  taxaAprovacaoRejeicao: Indicador<TaxaAprovacaoRejeicao>;
  volumeDiario: Indicador<SerieDia[]>;
}

/**
 * Dashboard do Gestor de Unidade (Req 9.2): totais por status na unidade, carga
 * por servidor, taxas de aprovação/rejeição (30 dias) e volume diário (30 dias).
 * Cacheado por 5 min em `cache:dashboard:gestor-unidade:{unidadeId}`.
 */
export async function dashboardGestorUnidade(
  unidadeId: string,
  deps?: Partial<DashboardDeps>,
  agora: Date = new Date(),
): Promise<DashboardGestorUnidade> {
  const { prisma, redis } = resolveDeps(deps);
  const where: Prisma.ProcessoWhereInput = { unidadeId };
  const desde30 = desdeDiasAtras(30, agora);

  return comCache(redis, 'gestor-unidade', unidadeId, async () => {
    const [porStatus, carga, taxas, volume] = await Promise.all([
      safe(() => processosPorStatus(prisma, where)),
      safe(() => cargaPorServidor(prisma, unidadeId)),
      safe(() => taxaAprovacaoRejeicao(prisma, where, desde30)),
      safe(() => produtividadeDiaria(prisma, where, desde30, 'abertoEm')),
    ]);
    return {
      porStatus,
      cargaPorServidor: carga,
      taxaAprovacaoRejeicao: taxas,
      volumeDiario: volume,
    };
  });
}

/** Resposta do dashboard do Gestor de Categoria (Req 9.3). */
export interface DashboardGestorCategoria {
  porStatusPorUnidade: Indicador<GrupoDimensao[]>;
  tempoMedioPorTipo: Indicador<TempoMedioPorTipo[]>;
  comparacaoUnidades: Indicador<GrupoDimensao[]>;
}

/**
 * Dashboard do Gestor de Categoria (Req 9.3): totais por status agrupados por
 * unidade dentro da categoria, tempo médio por tipo (30 dias) e comparação
 * entre unidades (reusa o agrupamento por unidade). Cacheado por 5 min em
 * `cache:dashboard:gestor-categoria:{categoriaId}`.
 */
export async function dashboardGestorCategoria(
  categoriaId: string,
  deps?: Partial<DashboardDeps>,
  agora: Date = new Date(),
): Promise<DashboardGestorCategoria> {
  const { prisma, redis } = resolveDeps(deps);
  const desde30 = desdeDiasAtras(30, agora);

  return comCache(redis, 'gestor-categoria', categoriaId, async () => {
    const [porUnidade, tempoTipo, comparacao] = await Promise.all([
      safe(() => porStatusPorUnidadeNaCategoria(prisma, categoriaId)),
      safe(() => tempoMedioPorTipo(prisma, categoriaId, desde30)),
      safe(() => porStatusPorUnidadeNaCategoria(prisma, categoriaId)),
    ]);
    return {
      porStatusPorUnidade: porUnidade,
      tempoMedioPorTipo: tempoTipo,
      comparacaoUnidades: comparacao,
    };
  });
}

/** Resposta do dashboard do Gestor Geral (Req 9.4). */
export interface DashboardGestorGeral {
  porStatusPorCategoria: Indicador<GrupoDimensao[]>;
  volumeSemanal: Indicador<SerieSemana[]>;
  comparacaoPeriodos: Indicador<ComparacaoPeriodos>;
}

/**
 * Dashboard do Gestor Geral (Req 9.4): totais por status por categoria, volume
 * semanal (90 dias) e comparação de períodos consecutivos de 30 dias. Cacheado
 * por 5 min em `cache:dashboard:gestor-geral:{id}` (id fixo `global` por não ter
 * escopo). O `id` pode ser o próprio servidorId para segregar por sessão.
 */
export async function dashboardGestorGeral(
  id = 'global',
  deps?: Partial<DashboardDeps>,
  agora: Date = new Date(),
): Promise<DashboardGestorGeral> {
  const { prisma, redis } = resolveDeps(deps);
  const desde90 = desdeDiasAtras(90, agora);

  return comCache(redis, 'gestor-geral', id, async () => {
    const [porCategoria, semanal, comparacao] = await Promise.all([
      safe(() => porStatusPorCategoria(prisma)),
      safe(() => volumeSemanal(prisma, {}, desde90)),
      safe(() => compararPeriodos(prisma, {}, 30, agora)),
    ]);
    return {
      porStatusPorCategoria: porCategoria,
      volumeSemanal: semanal,
      comparacaoPeriodos: comparacao,
    };
  });
}

// ===========================================================================
// Dashboard Estendida — Resumo (cards + prazos) e Desempenho da Equipe
// Tasks 23.1, 23.2 | Requisitos 9.7, 9.8, 9.9, 9.10, 9.11, 9.12
// Properties 10 (consistência de agregação) e 11 (escopo RBAC)
// ===========================================================================

/**
 * Escopo de acesso do Servidor resolvido pelo RBAC (Req 9.12).
 *
 * - `unidadeId` presente ⇒ Gestor_de_Unidade: TODOS os indicadores, cards e o
 *   Painel_de_Desempenho são restritos exclusivamente a essa Unidade.
 * - `unidadeId` ausente/`null` ⇒ Administrador: vê todas as Unidades/Categorias.
 *
 * A resolução acontece no controller (a partir do `nivel`/lookup do Servidor);
 * o serviço apenas aplica o escopo, garantindo que nada fora dele seja
 * computado — base da Property 11.
 */
export interface EscopoDashboard {
  /** Unidade à qual o Servidor está restrito; `null`/`undefined` = sem restrição. */
  unidadeId?: string | null;
}

/**
 * Filtros combináveis do Dashboard estendido (Req 9.11). Todos opcionais e
 * aplicados em conjunção (AND). `de`/`ate` recortam por `abertoEm`.
 */
export interface FiltrosDashboard {
  unidadeId?: string;
  categoriaId?: string;
  de?: Date;
  ate?: Date;
}

/**
 * Status considerados encerrados/terminais — usados para derivar "atrasados"
 * (não encerrados com prazo vencido) e o conjunto de status disjuntos dos cards.
 */
const STATUS_ENCERRADOS: string[] = [
  StatusProcesso.APROVADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.FINALIZADO,
];

/**
 * Monta o `where` base do escopo + filtros para o Dashboard estendido.
 *
 * Precedência de Unidade (Req 9.11 + 9.12): o escopo RBAC do Gestor_de_Unidade
 * é SOBERANO — se `escopo.unidadeId` está definido, o filtro de Unidade só pode
 * refinar dentro do escopo (interseção); um `filtros.unidadeId` divergente é
 * ignorado para não vazar dados de outra Unidade. Assim, todo processo
 * computado pertence exclusivamente à Unidade do Gestor (Property 11).
 */
export function montarWhereEscopo(
  escopo: EscopoDashboard,
  filtros: FiltrosDashboard = {},
): Prisma.ProcessoWhereInput {
  const where: Prisma.ProcessoWhereInput = {};

  // Escopo RBAC de Unidade é soberano; filtro só refina dentro do escopo.
  if (escopo.unidadeId != null) {
    where.unidadeId = escopo.unidadeId;
  } else if (filtros.unidadeId) {
    where.unidadeId = filtros.unidadeId;
  }

  if (filtros.categoriaId) {
    where.tipoProcesso = { categoriaId: filtros.categoriaId };
  }

  if (filtros.de || filtros.ate) {
    where.abertoEm = {
      ...(filtros.de ? { gte: filtros.de } : {}),
      ...(filtros.ate ? { lte: filtros.ate } : {}),
    };
  }

  return where;
}

/** Cards de contagem por situação (Req 9.7). */
export interface CardsResumo {
  total: number;
  abertos: number;
  emAndamento: number;
  aguardandoDocs: number;
  atrasados: number;
  aprovados: number;
  finalizados: number;
  rejeitados: number;
}

/**
 * Contagem exata de Processos por situação dentro do escopo/filtros (Req 9.7).
 *
 * Deriva os cards a partir do agrupamento por status (`processosPorStatus`) para
 * garantir a Property 10: os cards de status mutuamente exclusivos (abertos,
 * em_andamento, aguardando_docs, aprovados, rejeitados, finalizados) somados
 * com os demais status do escopo reproduzem exatamente o `total`.
 *
 * "atrasados" (Req 9.7/9.8) é contado à parte: Processos NÃO encerrados com
 * `prazoFinal < agora`. Por não ser um status disjunto, NÃO entra na verificação
 * de soma dos cards de status (é uma métrica transversal).
 */
export async function cardsResumo(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
  agora: Date = new Date(),
): Promise<CardsResumo> {
  const porStatus = await processosPorStatus(prisma, where);

  const total = Object.values(porStatus).reduce((acc, n) => acc + n, 0);

  const atrasados = await prisma.processo.count({
    where: {
      ...where,
      status: { notIn: STATUS_ENCERRADOS },
      prazoFinal: { lt: agora },
    },
  });

  return {
    total,
    abertos: porStatus[StatusProcesso.ABERTO] ?? 0,
    emAndamento: porStatus[StatusProcesso.EM_ANDAMENTO] ?? 0,
    aguardandoDocs: porStatus[StatusProcesso.AGUARDANDO_DOCS] ?? 0,
    atrasados,
    aprovados: porStatus[StatusProcesso.APROVADO] ?? 0,
    finalizados: porStatus[StatusProcesso.FINALIZADO] ?? 0,
    rejeitados: porStatus[StatusProcesso.REJEITADO] ?? 0,
  };
}

/** Identificação enxuta de um Processo para o indicador de prazos (Req 9.8). */
export interface ProcessoPrazo {
  id: string;
  protocolo: string;
  prazoFinal: string;
}

/** Indicador de prazos: vencendo em ≤3 dias úteis e vencidos (Req 9.8). */
export interface IndicadorPrazos {
  vencendo: { quantidade: number; processos: ProcessoPrazo[] };
  vencidos: { quantidade: number; processos: ProcessoPrazo[] };
}

/**
 * Indicador de prazos do escopo (Req 9.8):
 *  - "vencendo": Processos NÃO encerrados cujo `prazoFinal` cai entre agora e o
 *    fim do 3º dia útil a partir de agora ({@link calcularPrazoFinal});
 *  - "vencidos": Processos NÃO encerrados com `prazoFinal < agora`.
 *
 * Cada lista traz a identificação (id + protocolo + data de vencimento) exigida
 * pelo requisito.
 */
export async function indicadorPrazos(
  prisma: Pick<PrismaClient, 'processo'>,
  where: Prisma.ProcessoWhereInput,
  agora: Date = new Date(),
): Promise<IndicadorPrazos> {
  // Fim do 3º dia útil a partir de agora (limiar de "vencendo").
  const limiteVencendo = calcularPrazoFinal(agora, 3);

  const [vencendo, vencidos] = await Promise.all([
    prisma.processo.findMany({
      where: {
        ...where,
        status: { notIn: STATUS_ENCERRADOS },
        prazoFinal: { gte: agora, lte: limiteVencendo },
      },
      select: { id: true, protocolo: true, prazoFinal: true },
    }) as Promise<Array<{ id: string; protocolo: string; prazoFinal: Date }>>,
    prisma.processo.findMany({
      where: {
        ...where,
        status: { notIn: STATUS_ENCERRADOS },
        prazoFinal: { lt: agora },
      },
      select: { id: true, protocolo: true, prazoFinal: true },
    }) as Promise<Array<{ id: string; protocolo: string; prazoFinal: Date }>>,
  ]);

  const map = (r: { id: string; protocolo: string; prazoFinal: Date }): ProcessoPrazo => ({
    id: r.id,
    protocolo: r.protocolo,
    prazoFinal: r.prazoFinal.toISOString(),
  });

  return {
    vencendo: { quantidade: vencendo.length, processos: vencendo.map(map) },
    vencidos: { quantidade: vencidos.length, processos: vencidos.map(map) },
  };
}

/** Resposta do endpoint de resumo (Task 23.1). */
export interface DashboardResumo {
  cards: Indicador<CardsResumo>;
  prazos: Indicador<IndicadorPrazos>;
}

/**
 * Monta a chave de cache do resumo/desempenho a partir do escopo + filtros, de
 * modo que escopos e filtros distintos NÃO colidam no cache. O escopo de Unidade
 * é o primeiro componente para reforçar o isolamento por Unidade.
 */
export function chaveEscopoFiltros(escopo: EscopoDashboard, filtros: FiltrosDashboard): string {
  const uni = escopo.unidadeId != null ? escopo.unidadeId : filtros.unidadeId ?? 'todas';
  const cat = filtros.categoriaId ?? 'todas';
  const de = filtros.de ? filtros.de.toISOString() : '';
  const ate = filtros.ate ? filtros.ate.toISOString() : '';
  return `${uni}|${cat}|${de}|${ate}`;
}

/**
 * Dashboard — Resumo (Task 23.1, Req 9.7/9.8/9.11/9.12): cards de contagem por
 * status + indicador de prazos, respeitando escopo RBAC e filtros combinados.
 * Resultado cacheado 5 min em `cache:dashboard:resumo:{escopo|filtros}` (Req 9.5),
 * com cada indicador resiliente via {@link safe} (Req 9.6).
 */
export async function dashboardResumo(
  escopo: EscopoDashboard,
  filtros: FiltrosDashboard = {},
  deps?: Partial<DashboardDeps>,
  agora: Date = new Date(),
): Promise<DashboardResumo> {
  const { prisma, redis } = resolveDeps(deps);
  const where = montarWhereEscopo(escopo, filtros);
  const id = chaveEscopoFiltros(escopo, filtros);

  return comCache(redis, 'resumo' as DashboardRole, id, async () => {
    const [cards, prazos] = await Promise.all([
      safe(() => cardsResumo(prisma, where, agora)),
      safe(() => indicadorPrazos(prisma, where, agora)),
    ]);
    return { cards, prazos };
  });
}

// ---------------------------------------------------------------------------
// Desempenho da Equipe (Task 23.2, Req 9.9/9.10)
// ---------------------------------------------------------------------------

/** Indicadores de desempenho de um Servidor no escopo/período (Req 9.9). */
export interface DesempenhoServidor {
  servidorId: string;
  nome: string;
  atribuidos: number;
  emAndamento: number;
  concluidos: number;
  atrasados: number;
  tempoMedioConclusaoHoras: number;
  tarefasPendentes: number;
}

/** Campos ordenáveis do Painel_de_Desempenho (Req 9.10). */
export type OrdenarDesempenhoPor =
  | 'nome'
  | 'atribuidos'
  | 'emAndamento'
  | 'concluidos'
  | 'atrasados'
  | 'tempoMedioConclusaoHoras'
  | 'tarefasPendentes';

/** Prisma mínimo para o desempenho (inclui `tarefaAtribuicao`). */
export type PrismaDesempenho = Pick<PrismaClient, 'servidor' | 'processo' | 'tarefaAtribuicao'>;

/** Status de Tarefa considerados pendentes (não concluídos) — Req 9.9. */
const STATUS_TAREFA_PENDENTES: string[] = [StatusTarefa.PENDENTE, StatusTarefa.EM_ANDAMENTO];

/**
 * Painel_de_Desempenho: por Servidor DENTRO do escopo, calcula os indicadores
 * do período (Req 9.9). O conjunto de Servidores é derivado do escopo:
 *  - Gestor_de_Unidade (`escopo.unidadeId`): apenas Servidores ativos da Unidade
 *    (Property 11 — nenhum Servidor de outra Unidade é computado);
 *  - Administrador (sem escopo): todos os Servidores ativos, refinável por
 *    `filtros.unidadeId`.
 *
 * Indicadores por Servidor (`servidorResponsavelId`), respeitando `where`:
 *  - atribuídos: total de Processos sob responsabilidade no escopo/período;
 *  - emAndamento: em status EM_ANDAMENTO;
 *  - concluidos: encerrados no período (`encerradoEm` na janela `de`/`ate`);
 *  - atrasados: não encerrados com `prazoFinal < agora`;
 *  - tempoMedioConclusaoHoras: média (h) entre abertoEm e encerradoEm dos
 *    concluídos no período (reusa {@link tempoMedioResolucao});
 *  - tarefasPendentes: `TarefaAtribuicao` do Servidor em status pendente/andamento.
 *
 * A soma de `atribuidos` por Servidor == total de Processos atribuídos no escopo
 * (Property 10), pois cada Processo tem no máximo um `servidorResponsavelId` e a
 * contagem por Servidor particiona o conjunto de atribuídos.
 */
export async function desempenhoEquipe(
  prisma: PrismaDesempenho,
  escopo: EscopoDashboard,
  filtros: FiltrosDashboard = {},
  ordenarPor: OrdenarDesempenhoPor = 'nome',
  agora: Date = new Date(),
): Promise<DesempenhoServidor[]> {
  // Unidade efetiva: escopo RBAC soberano; filtro só refina dentro do escopo.
  const unidadeEfetiva =
    escopo.unidadeId != null ? escopo.unidadeId : filtros.unidadeId ?? undefined;

  const servidores = (await prisma.servidor.findMany({
    where: { ativo: true, ...(unidadeEfetiva ? { unidadeId: unidadeEfetiva } : {}) },
    select: { id: true, nome: true },
  })) as Array<{ id: string; nome: string }>;

  // `where` de escopo/filtros SEM o recorte por abertoEm de período — o período
  // recorta a conclusão (encerradoEm), não a abertura, no desempenho.
  const whereEscopo: Prisma.ProcessoWhereInput = {};
  if (escopo.unidadeId != null) whereEscopo.unidadeId = escopo.unidadeId;
  else if (filtros.unidadeId) whereEscopo.unidadeId = filtros.unidadeId;
  if (filtros.categoriaId) whereEscopo.tipoProcesso = { categoriaId: filtros.categoriaId };

  const janelaEncerrado = {
    ...(filtros.de ? { gte: filtros.de } : {}),
    ...(filtros.ate ? { lte: filtros.ate } : {}),
  };
  const temJanela = filtros.de != null || filtros.ate != null;

  const linhas = await Promise.all(
    servidores.map(async (s) => {
      const baseServidor: Prisma.ProcessoWhereInput = {
        ...whereEscopo,
        servidorResponsavelId: s.id,
      };

      const [atribuidos, emAndamento, concluidos, atrasados, tempoMedio, tarefasPendentes] =
        await Promise.all([
          prisma.processo.count({ where: baseServidor }),
          prisma.processo.count({
            where: { ...baseServidor, status: StatusProcesso.EM_ANDAMENTO },
          }),
          prisma.processo.count({
            where: {
              ...baseServidor,
              encerradoEm: temJanela ? { not: null, ...janelaEncerrado } : { not: null },
            },
          }),
          prisma.processo.count({
            where: {
              ...baseServidor,
              status: { notIn: STATUS_ENCERRADOS },
              prazoFinal: { lt: agora },
            },
          }),
          tempoMedioResolucao(prisma, baseServidor, filtros.de ?? new Date(0)),
          prisma.tarefaAtribuicao.count({
            where: { servidorId: s.id, status: { in: STATUS_TAREFA_PENDENTES } },
          }),
        ]);

      return {
        servidorId: s.id,
        nome: s.nome,
        atribuidos,
        emAndamento,
        concluidos,
        atrasados,
        tempoMedioConclusaoHoras: tempoMedio,
        tarefasPendentes,
      } satisfies DesempenhoServidor;
    }),
  );

  return ordenarDesempenho(linhas, ordenarPor);
}

/**
 * Ordena o Painel_de_Desempenho por qualquer indicador (Req 9.10). Numéricos em
 * ordem decrescente (maior desempenho/carga primeiro); `nome` em ordem
 * alfabética crescente. Não muta o array de entrada.
 */
export function ordenarDesempenho(
  linhas: DesempenhoServidor[],
  ordenarPor: OrdenarDesempenhoPor,
): DesempenhoServidor[] {
  const copia = [...linhas];
  if (ordenarPor === 'nome') {
    copia.sort((a, b) => a.nome.localeCompare(b.nome));
  } else {
    copia.sort((a, b) => (b[ordenarPor] as number) - (a[ordenarPor] as number));
  }
  return copia;
}

/**
 * Dashboard — Desempenho da Equipe (Task 23.2, Req 9.9/9.10/9.11/9.12).
 * Cacheado 5 min em `cache:dashboard:desempenho:{escopo|filtros|ordem}` (Req 9.5),
 * envelopado em {@link safe} para resiliência (Req 9.6).
 */
export async function dashboardDesempenhoEquipe(
  escopo: EscopoDashboard,
  filtros: FiltrosDashboard = {},
  ordenarPor: OrdenarDesempenhoPor = 'nome',
  deps?: Partial<DashboardDeps>,
  agora: Date = new Date(),
): Promise<Indicador<DesempenhoServidor[]>> {
  const { prisma, redis } = resolveDeps(deps);
  const id = `${chaveEscopoFiltros(escopo, filtros)}|${ordenarPor}`;

  return comCache(redis, 'desempenho' as DashboardRole, id, async () =>
    safe(() =>
      desempenhoEquipe(
        prisma as unknown as PrismaDesempenho,
        escopo,
        filtros,
        ordenarPor,
        agora,
      ),
    ),
  );
}
