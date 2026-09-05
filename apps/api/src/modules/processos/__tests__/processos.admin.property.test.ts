// Feature: auditar-sistema-gestao, Property 5: Correção da Busca Rápida
//
// Property 5: Correção da Busca Rápida
// For any set of stored processos and any term with >=3 characters, every
// result must contain the term (partial, case-insensitive) in the protocolo,
// nome or CPF of the cidadão, and no result outside that criterion may appear.
//
// Validates: Requirements 10.5

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { desformatarCPF } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Stub da infra para não abrir conexão real ao importar o serviço. `buscaRapida`
// só depende de `config/database.js` no import (prisma real, sobrescrito por
// injeção via `deps`). Mesma convenção do teste unitário irmão
// (processos.admin.service.test.ts).
// ---------------------------------------------------------------------------
vi.mock('../../../config/database.js', () => ({ prisma: {} }));

import { buscaRapida, type ProcessosAdminDeps } from '../processos.admin.service.js';
import { AppError } from '../../../utils/index.js';

// ---------------------------------------------------------------------------
// Modelagem da propriedade
// ---------------------------------------------------------------------------
// A filtragem real (contains/insensitive/OR) é executada pelo Prisma contra o
// banco. No nível puro, o que `buscaRapida` controla é: (a) a validação de
// tamanho mínimo do termo e (b) a montagem do `where.OR` que é entregue ao
// Prisma. Para testar a Property 5 de forma fiel sem um banco vivo, usamos um
// prisma MOCKADO cujo `findMany`/`count` funciona como ORÁCULO DE REFERÊNCIA:
// ele aplica exatamente a semântica que o banco aplicaria (substring
// case-insensitive em protocolo/nome + substring de dígitos no CPF) sobre um
// dataset gerado pelo fast-check, mas fazendo isso a partir do `where` que o
// serviço realmente construiu. Assim, se `buscaRapida` montasse um OR incorreto
// (p.ex. esquecesse o nome, ou não normalizasse o CPF, ou perdesse o
// case-insensitive), o oráculo — dirigido por esse where — produziria um
// resultado divergente do critério esperado e a propriedade falharia.
//
// Soundness  : toda linha retornada satisfaz o critério do termo.
// Completeness: toda linha do dataset que satisfaz o critério aparece no
//               resultado (usamos pageSize grande o bastante para não perder
//               nenhum match por paginação).
// Guarda <3  : termos com menos de 3 chars lançam badRequest e não consultam.

interface ProcRow {
  protocolo: string;
  cidadao: { nome: string; cpf: string } | null;
}

/** Critério de referência: a linha corresponde ao termo? (a "verdade" esperada) */
function correspondeAoTermo(row: ProcRow, termo: string): boolean {
  const alvo = termo.trim().toLowerCase();
  const digitos = desformatarCPF(termo.trim());
  const protoOk = row.protocolo.toLowerCase().includes(alvo);
  const nomeOk = (row.cidadao?.nome ?? '').toLowerCase().includes(alvo);
  const cpfOk =
    digitos.length > 0 && (row.cidadao?.cpf ?? '').includes(digitos);
  return protoOk || nomeOk || cpfOk;
}

/**
 * Aplica UMA cláusula do OR do Prisma (montado por `buscaRapida`) a uma linha.
 * Reproduz a semântica do Prisma para os shapes usados pelo serviço:
 *  - { protocolo: { contains, mode: 'insensitive' } }
 *  - { cidadao: { nome: { contains, mode: 'insensitive' } } }
 *  - { cidadao: { cpf: { contains } } }  (sensível — só dígitos)
 */
function clausulaBate(clausula: Record<string, any>, row: ProcRow): boolean {
  if ('protocolo' in clausula) {
    const { contains, mode } = clausula.protocolo;
    const hay = mode === 'insensitive' ? row.protocolo.toLowerCase() : row.protocolo;
    const needle = mode === 'insensitive' ? String(contains).toLowerCase() : String(contains);
    return hay.includes(needle);
  }
  if ('cidadao' in clausula) {
    const c = clausula.cidadao;
    if (c.nome) {
      const { contains, mode } = c.nome;
      const nome = row.cidadao?.nome ?? '';
      const hay = mode === 'insensitive' ? nome.toLowerCase() : nome;
      const needle = mode === 'insensitive' ? String(contains).toLowerCase() : String(contains);
      return hay.includes(needle);
    }
    if (c.cpf) {
      const { contains, mode } = c.cpf;
      const cpf = row.cidadao?.cpf ?? '';
      const hay = mode === 'insensitive' ? cpf.toLowerCase() : cpf;
      const needle = mode === 'insensitive' ? String(contains).toLowerCase() : String(contains);
      return hay.includes(needle);
    }
  }
  return false;
}

/** Oráculo: aplica o `where.OR` construído pelo serviço ao dataset. */
function aplicarWhere(dataset: ProcRow[], where: any): ProcRow[] {
  const ors: Record<string, any>[] = where?.OR ?? [];
  return dataset.filter((row) => ors.some((cl) => clausulaBate(cl, row)));
}

/**
 * Cria um prisma mockado cujo findMany/count aplica o `where` recebido ao
 * dataset (oráculo) e devolve o formato cru esperado por `buscaRapida`
 * (com include: cidadao/tipoProcesso/servidorResponsavel/movimentacoes).
 */
function criarPrismaOraculo(dataset: ProcRow[]) {
  const findMany = vi.fn(async (args: any) => {
    const filtradas = aplicarWhere(dataset, args.where);
    const skip = args.skip ?? 0;
    const take = args.take ?? filtradas.length;
    return filtradas.slice(skip, skip + take).map((row) => ({
      protocolo: row.protocolo,
      status: 'EM_ANDAMENTO',
      prazoFinal: new Date('2024-12-31T00:00:00Z'),
      atualizadoEm: new Date('2024-06-01T00:00:00Z'),
      cidadao: row.cidadao ? { nome: row.cidadao.nome } : null,
      tipoProcesso: { nome: 'Licença', categoria: { nome: 'Obras' } },
      servidorResponsavel: null,
      movimentacoes: [],
    }));
  });
  const count = vi.fn(async (args: any) => aplicarWhere(dataset, args.where).length);
  const prisma = { processo: { findMany, count } };
  return { prisma, findMany, count };
}

function deps(prisma: unknown): Partial<ProcessosAdminDeps> {
  return { prisma: prisma as ProcessosAdminDeps['prisma'] };
}

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

// Protocolos plausíveis (dígitos) mais alguns alfanuméricos.
const protocoloArb = fc.oneof(
  fc.integer({ min: 0, max: 9_999_999_999 }).map((n) => String(n).padStart(10, '0')),
  fc.string({ minLength: 3, maxLength: 12 }),
);

const nomeArb = fc.string({ minLength: 0, maxLength: 20 });
const cpfArb = fc
  .integer({ min: 0, max: 99_999_999_999 })
  .map((n) => String(n).padStart(11, '0'));

const rowArb: fc.Arbitrary<ProcRow> = fc.record({
  protocolo: protocoloArb,
  cidadao: fc.option(
    fc.record({ nome: nomeArb, cpf: cpfArb }),
    { nil: null, freq: 5 },
  ),
});

const datasetArb = fc.array(rowArb, { minLength: 0, maxLength: 25 });

// Termos com >=3 chars: mistura de texto livre, trechos alfanuméricos e
// máscaras de CPF, para exercitar protocolo/nome/CPF.
const termoValidoArb = fc
  .oneof(
    fc.string({ minLength: 3, maxLength: 8 }),
    fc.integer({ min: 100, max: 99_999_999_999 }).map(String),
    fc
      .integer({ min: 0, max: 99_999_999_999 })
      .map((n) => {
        const d = String(n).padStart(11, '0');
        return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
      }),
  )
  // Garante que, após trim, o termo mantenha >=3 chars (evita colidir com a
  // guarda de tamanho mínimo — testada separadamente).
  .filter((t) => t.trim().length >= 3);

const PAGE_SIZE_GRANDE = 1000; // maior que qualquer dataset gerado

describe('buscaRapida — Property 5: Correção da Busca Rápida', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('soundness: toda linha retornada corresponde ao termo (protocolo/nome/CPF, parcial e case-insensitive)', async () => {
    await fc.assert(
      fc.asyncProperty(datasetArb, termoValidoArb, async (dataset, termo) => {
        // `formatarLinha` descarta o CPF na saída; para checar soundness com o
        // critério completo (inclui CPF), reconstruímos a linha original via um
        // protocolo único como chave.
        const unico = dataset.map((r, i) => ({ ...r, protocolo: `P${i}-${r.protocolo}` }));
        const porProtocolo = new Map(unico.map((r) => [r.protocolo, r]));

        const { prisma } = criarPrismaOraculo(unico);
        const res = await buscaRapida(termo, { page: 1, pageSize: PAGE_SIZE_GRANDE }, deps(prisma));

        for (const item of res.data as Array<{ protocolo: string }>) {
          const original = porProtocolo.get(item.protocolo);
          expect(original).toBeDefined();
          expect(correspondeAoTermo(original as ProcRow, termo)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('completeness: toda linha do dataset que corresponde ao termo aparece no resultado', async () => {
    await fc.assert(
      fc.asyncProperty(datasetArb, termoValidoArb, async (dataset, termo) => {
        const { prisma } = criarPrismaOraculo(dataset);
        const res = await buscaRapida(termo, { page: 1, pageSize: PAGE_SIZE_GRANDE }, deps(prisma));

        const esperadas = dataset.filter((r) => correspondeAoTermo(r, termo));
        // total (via count) deve refletir todas as correspondências
        expect(res.meta.total).toBe(esperadas.length);
        // e o conjunto retornado (page grande) deve conter todas elas
        expect(res.data.length).toBe(esperadas.length);
      }),
      { numRuns: 200 },
    );
  });

  it('exatidão do total: resultados não incluem falsos positivos nem perdem correspondências', async () => {
    await fc.assert(
      fc.asyncProperty(datasetArb, termoValidoArb, async (dataset, termo) => {
        const { prisma } = criarPrismaOraculo(dataset);
        const res = await buscaRapida(termo, { page: 1, pageSize: PAGE_SIZE_GRANDE }, deps(prisma));
        const esperadas = dataset.filter((r) => correspondeAoTermo(r, termo)).length;
        expect(res.meta.total).toBe(esperadas);
      }),
      { numRuns: 200 },
    );
  });

  it('guarda de tamanho: termos com <3 chars (após trim) lançam badRequest e não consultam', async () => {
    const termoCurtoArb = fc
      .string({ minLength: 0, maxLength: 6 })
      .filter((t) => t.trim().length < 3);

    await fc.assert(
      fc.asyncProperty(datasetArb, termoCurtoArb, async (dataset, termo) => {
        const { prisma, findMany, count } = criarPrismaOraculo(dataset);
        await expect(buscaRapida(termo, {}, deps(prisma))).rejects.toBeInstanceOf(AppError);
        expect(findMany).not.toHaveBeenCalled();
        expect(count).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
