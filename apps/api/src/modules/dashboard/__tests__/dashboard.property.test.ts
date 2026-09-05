import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { StatusProcesso, StatusTarefa } from '@auditar/shared';

// Stub da infra para não abrir conexão real ao importar o serviço.
vi.mock('../../../config/database.js', () => ({ prisma: {} }));

import {
  cardsResumo,
  desempenhoEquipe,
  montarWhereEscopo,
  type EscopoDashboard,
  type FiltrosDashboard,
  type RedisPort,
  type DashboardDeps,
  dashboardResumo,
} from '../dashboard.service.js';

/**
 * Property tests do Dashboard estendido (Task 23.3).
 *
 *  - Property 10: Consistência de Agregação do Dashboard
 *      · a soma dos cards de status mutuamente exclusivos == total do escopo;
 *      · a soma de `atribuidos` por Servidor no Painel_de_Desempenho == total de
 *        Processos atribuídos no escopo.
 *  - Property 11: Escopo RBAC do Dashboard
 *      · para qualquer Gestor_de_Unidade, TODOS os Processos/Servidores
 *        computados pertencem exclusivamente à sua Unidade.
 *
 * Validates: Requirements 9.7, 9.9, 9.11, 9.12
 *
 * Estratégia: um Prisma em memória (fake) que responde `count`/`groupBy`/
 * `findMany` filtrando registros pelo `where` produzido pelo serviço. Assim os
 * testes exercitam a lógica real de agregação/escopo, sem mocks por chamada.
 */

// ---------------------------------------------------------------------------
// Modelo em memória
// ---------------------------------------------------------------------------

const TODOS_STATUS: string[] = [
  StatusProcesso.ABERTO,
  StatusProcesso.EM_ANDAMENTO,
  StatusProcesso.AGUARDANDO_DOCS,
  StatusProcesso.AGUARDANDO_CIDADAO,
  StatusProcesso.VENCIDO,
  StatusProcesso.APROVADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.FINALIZADO,
];

const STATUS_ENCERRADOS = new Set<string>([
  StatusProcesso.APROVADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.FINALIZADO,
]);

interface ProcRow {
  id: string;
  protocolo: string;
  status: string;
  unidadeId: string;
  categoriaId: string;
  servidorResponsavelId: string | null;
  abertoEm: Date;
  encerradoEm: Date | null;
  prazoFinal: Date;
}

interface ServRow {
  id: string;
  nome: string;
  unidadeId: string;
  ativo: boolean;
}

interface TarefaAtribRow {
  servidorId: string;
  status: string;
}

interface Banco {
  processos: ProcRow[];
  servidores: ServRow[];
  tarefaAtribuicoes: TarefaAtribRow[];
}

/** Aplica um `where` (subconjunto usado pelo serviço) a um Processo. */
function matchProcesso(p: ProcRow, where: Record<string, unknown> = {}): boolean {
  if (where.unidadeId !== undefined && p.unidadeId !== where.unidadeId) return false;

  if (where.servidorResponsavelId !== undefined) {
    if (p.servidorResponsavelId !== where.servidorResponsavelId) return false;
  }

  if (where.tipoProcesso !== undefined) {
    const tp = where.tipoProcesso as { categoriaId?: string };
    if (tp.categoriaId !== undefined && p.categoriaId !== tp.categoriaId) return false;
  }

  if (where.status !== undefined) {
    const st = where.status as string | { in?: string[]; notIn?: string[] };
    if (typeof st === 'string') {
      if (p.status !== st) return false;
    } else {
      if (st.in && !st.in.includes(p.status)) return false;
      if (st.notIn && st.notIn.includes(p.status)) return false;
    }
  }

  if (where.abertoEm !== undefined) {
    const r = where.abertoEm as { gte?: Date; lte?: Date };
    if (r.gte && p.abertoEm < r.gte) return false;
    if (r.lte && p.abertoEm > r.lte) return false;
  }

  if (where.prazoFinal !== undefined) {
    const r = where.prazoFinal as { gte?: Date; lte?: Date; lt?: Date };
    if (r.gte && p.prazoFinal < r.gte) return false;
    if (r.lte && p.prazoFinal > r.lte) return false;
    if (r.lt && !(p.prazoFinal < r.lt)) return false;
  }

  if (where.encerradoEm !== undefined) {
    const e = where.encerradoEm as null | { not?: null; gte?: Date; lte?: Date };
    if (e === null) {
      if (p.encerradoEm !== null) return false;
    } else {
      if (e.not === null && p.encerradoEm === null) return false;
      if (p.encerradoEm !== null) {
        if (e.gte && p.encerradoEm < e.gte) return false;
        if (e.lte && p.encerradoEm > e.lte) return false;
      }
    }
  }

  return true;
}

function makePrisma(banco: Banco) {
  return {
    processo: {
      count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        banco.processos.filter((p) => matchProcesso(p, where)).length,
      ),
      groupBy: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const filtrados = banco.processos.filter((p) => matchProcesso(p, where));
        const contagem = new Map<string, number>();
        for (const p of filtrados) contagem.set(p.status, (contagem.get(p.status) ?? 0) + 1);
        return [...contagem.entries()].map(([status, n]) => ({ status, _count: { _all: n } }));
      }),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        banco.processos
          .filter((p) => matchProcesso(p, where))
          .map((p) => ({
            id: p.id,
            protocolo: p.protocolo,
            prazoFinal: p.prazoFinal,
            abertoEm: p.abertoEm,
            encerradoEm: p.encerradoEm,
          })),
      ),
    },
    servidor: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        banco.servidores
          .filter((s) => {
            const w = where ?? {};
            if (w.ativo !== undefined && s.ativo !== w.ativo) return false;
            if (w.unidadeId !== undefined && s.unidadeId !== w.unidadeId) return false;
            return true;
          })
          .map((s) => ({ id: s.id, nome: s.nome })),
      ),
    },
    tarefaAtribuicao: {
      count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const w = where ?? {};
        const inStatus = (w.status as { in?: string[] } | undefined)?.in;
        return banco.tarefaAtribuicoes.filter(
          (t) =>
            t.servidorId === w.servidorId && (!inStatus || inStatus.includes(t.status)),
        ).length;
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

const UNIDADES = ['uni-A', 'uni-B', 'uni-C'] as const;
const CATEGORIAS = ['cat-1', 'cat-2'] as const;
const AGORA = new Date('2024-06-15T12:00:00Z');

/** Gera um Banco com processos/servidores/tarefas distribuídos entre unidades. */
const arbBanco = fc
  .record({
    servidores: fc.array(
      fc.record({
        id: fc.uuid(),
        nome: fc.string({ minLength: 1, maxLength: 12 }),
        unidadeId: fc.constantFrom(...UNIDADES),
        ativo: fc.boolean(),
      }),
      { minLength: 1, maxLength: 8 },
    ),
    processos: fc.array(
      fc.record({
        id: fc.uuid(),
        status: fc.constantFrom(...TODOS_STATUS),
        unidadeId: fc.constantFrom(...UNIDADES),
        categoriaId: fc.constantFrom(...CATEGORIAS),
        // deslocamentos em horas relativos a AGORA para abertura/prazo/encerramento
        abertoHoras: fc.integer({ min: -2000, max: -1 }),
        prazoHoras: fc.integer({ min: -500, max: 500 }),
        encerrado: fc.boolean(),
        atribuir: fc.boolean(),
        servidorIdx: fc.nat({ max: 20 }),
      }),
      { minLength: 0, maxLength: 40 },
    ),
    tarefaAtribuicoes: fc.array(
      fc.record({
        servidorIdx: fc.nat({ max: 20 }),
        status: fc.constantFrom(
          StatusTarefa.PENDENTE,
          StatusTarefa.EM_ANDAMENTO,
          StatusTarefa.CONCLUIDA,
        ),
      }),
      { maxLength: 30 },
    ),
  })
  .map(({ servidores, processos, tarefaAtribuicoes }) => {
    const servs: ServRow[] = servidores.map((s, i) => ({ ...s, id: `${s.id}-${i}` }));

    const procs: ProcRow[] = processos.map((p, i) => {
      const abertoEm = new Date(AGORA.getTime() + p.abertoHoras * 3600_000);
      const prazoFinal = new Date(AGORA.getTime() + p.prazoHoras * 3600_000);
      const encerradoEm = p.encerrado
        ? new Date(abertoEm.getTime() + 3600_000)
        : null;
      // Atribuição só a um servidor da MESMA unidade do processo (fidelidade ao domínio).
      const daUnidade = servs.filter((s) => s.unidadeId === p.unidadeId);
      const servidorResponsavelId =
        p.atribuir && daUnidade.length > 0
          ? daUnidade[p.servidorIdx % daUnidade.length].id
          : null;
      return {
        id: `${p.id}-${i}`,
        protocolo: `2024-${String(i).padStart(5, '0')}`,
        status: p.status,
        unidadeId: p.unidadeId,
        categoriaId: p.categoriaId,
        servidorResponsavelId,
        abertoEm,
        encerradoEm,
        prazoFinal,
      };
    });

    const tarefas: TarefaAtribRow[] = servs.length
      ? tarefaAtribuicoes.map((t) => ({
          servidorId: servs[t.servidorIdx % servs.length].id,
          status: t.status,
        }))
      : [];

    return { servidores: servs, processos: procs, tarefaAtribuicoes: tarefas } satisfies Banco;
  });

/** Redis fake sempre em cache-miss (compute sempre roda) para exercitar a lógica. */
function redisSemCache(): RedisPort {
  return {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
  };
}

function deps(banco: Banco): Partial<DashboardDeps> {
  return {
    prisma: makePrisma(banco) as unknown as DashboardDeps['prisma'],
    redis: redisSemCache(),
    emit: () => {},
  };
}

// ---------------------------------------------------------------------------
// Property 10 — Consistência de Agregação
// ---------------------------------------------------------------------------

describe('Property 10: Consistência de Agregação do Dashboard', () => {
  it('a soma dos cards de status disjuntos == total do escopo', async () => {
    await fc.assert(
      fc.asyncProperty(arbBanco, fc.constantFrom(...UNIDADES, undefined), async (banco, uni) => {
        const escopo: EscopoDashboard = { unidadeId: uni ?? null };
        const where = montarWhereEscopo(escopo, {});
        const prisma = makePrisma(banco);

        const cards = await cardsResumo(prisma as never, where, AGORA);

        // Cards de status mutuamente exclusivos.
        const somaStatus =
          cards.abertos +
          cards.emAndamento +
          cards.aguardandoDocs +
          cards.aprovados +
          cards.finalizados +
          cards.rejeitados;

        // Total do escopo por status conhecido no banco (aguardando_cidadao e
        // vencido não têm card próprio; somamos para fechar com o total).
        const noEscopo = banco.processos.filter((p) =>
          uni ? p.unidadeId === uni : true,
        );
        const outros = noEscopo.filter(
          (p) =>
            p.status === StatusProcesso.AGUARDANDO_CIDADAO ||
            p.status === StatusProcesso.VENCIDO,
        ).length;

        expect(cards.total).toBe(noEscopo.length);
        expect(somaStatus + outros).toBe(cards.total);
      }),
      { numRuns: 150 },
    );
  });

  it('a soma de atribuidos por servidor == total de processos atribuídos no escopo', async () => {
    await fc.assert(
      fc.asyncProperty(arbBanco, fc.constantFrom(...UNIDADES, undefined), async (banco, uni) => {
        const escopo: EscopoDashboard = { unidadeId: uni ?? null };
        const prisma = makePrisma(banco);

        const linhas = await desempenhoEquipe(prisma as never, escopo, {}, 'nome', AGORA);
        const somaAtribuidos = linhas.reduce((acc, l) => acc + l.atribuidos, 0);

        // Total de processos atribuídos no escopo: com servidorResponsavelId não
        // nulo cujo servidor está no conjunto de servidores considerados.
        const idsServidores = new Set(linhas.map((l) => l.servidorId));
        const totalAtribuidos = banco.processos.filter(
          (p) =>
            (uni ? p.unidadeId === uni : true) &&
            p.servidorResponsavelId !== null &&
            idsServidores.has(p.servidorResponsavelId),
        ).length;

        expect(somaAtribuidos).toBe(totalAtribuidos);
      }),
      { numRuns: 150 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11 — Escopo RBAC do Dashboard
// ---------------------------------------------------------------------------

describe('Property 11: Escopo RBAC do Dashboard', () => {
  it('Gestor_de_Unidade: cards contam apenas processos da sua Unidade', async () => {
    await fc.assert(
      fc.asyncProperty(arbBanco, fc.constantFrom(...UNIDADES), async (banco, uni) => {
        const escopo: EscopoDashboard = { unidadeId: uni };
        const where = montarWhereEscopo(escopo, {});
        const prisma = makePrisma(banco);

        const cards = await cardsResumo(prisma as never, where, AGORA);

        // O total deve ser exatamente os processos da Unidade do Gestor.
        const daUnidade = banco.processos.filter((p) => p.unidadeId === uni).length;
        expect(cards.total).toBe(daUnidade);
      }),
      { numRuns: 150 },
    );
  });

  it('Gestor_de_Unidade: um filtro de outra Unidade NÃO vaza dados (escopo soberano)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBanco,
        fc.constantFrom(...UNIDADES),
        fc.constantFrom(...UNIDADES),
        async (banco, uniGestor, uniFiltro) => {
          const escopo: EscopoDashboard = { unidadeId: uniGestor };
          const filtros: FiltrosDashboard = { unidadeId: uniFiltro };
          const where = montarWhereEscopo(escopo, filtros);

          // O where efetivo sempre restringe à Unidade do Gestor.
          expect((where as { unidadeId?: string }).unidadeId).toBe(uniGestor);

          const prisma = makePrisma(banco);
          const cards = await cardsResumo(prisma as never, where, AGORA);
          const daUnidade = banco.processos.filter((p) => p.unidadeId === uniGestor).length;
          expect(cards.total).toBe(daUnidade);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('Gestor_de_Unidade: desempenho computa apenas Servidores da sua Unidade', async () => {
    await fc.assert(
      fc.asyncProperty(arbBanco, fc.constantFrom(...UNIDADES), async (banco, uni) => {
        const escopo: EscopoDashboard = { unidadeId: uni };
        const prisma = makePrisma(banco);

        const linhas = await desempenhoEquipe(prisma as never, escopo, {}, 'nome', AGORA);

        // Todo servidor do painel pertence à Unidade do Gestor e está ativo.
        const idsAtivosDaUnidade = new Set(
          banco.servidores.filter((s) => s.ativo && s.unidadeId === uni).map((s) => s.id),
        );
        for (const l of linhas) {
          expect(idsAtivosDaUnidade.has(l.servidorId)).toBe(true);
        }
        expect(linhas.length).toBe(idsAtivosDaUnidade.size);
      }),
      { numRuns: 150 },
    );
  });

  it('dashboardResumo (end-to-end) respeita o escopo do Gestor_de_Unidade', async () => {
    await fc.assert(
      fc.asyncProperty(arbBanco, fc.constantFrom(...UNIDADES), async (banco, uni) => {
        const escopo: EscopoDashboard = { unidadeId: uni };
        const out = await dashboardResumo(escopo, {}, deps(banco), AGORA);

        expect(out.cards.erro).toBe(false);
        const daUnidade = banco.processos.filter((p) => p.unidadeId === uni).length;
        expect(out.cards.value?.total).toBe(daUnidade);

        // Nenhum processo de prazos fora da Unidade.
        const idsUnidade = new Set(
          banco.processos.filter((p) => p.unidadeId === uni).map((p) => p.id),
        );
        for (const p of out.prazos.value?.vencendo.processos ?? []) {
          expect(idsUnidade.has(p.id)).toBe(true);
        }
        for (const p of out.prazos.value?.vencidos.processos ?? []) {
          expect(idsUnidade.has(p.id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
