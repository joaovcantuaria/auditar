// Feature: auditar-sistema-gestao, Property 7: Algoritmo de Atribuição Automática (Req 12.2)
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Stub do barrel de auditoria + env: importar `processos.atribuicao.service.ts`
// puxa `STATUS_ENCERRADOS` de `mensagens.publico.service.js`, que por sua vez
// importa o barrel de auditoria (que carrega `bullmq`/`env` como valores
// reais). Sem os stubs abaixo, o mero import dispara conexões/`process.exit`.
// Mesmo padrão de `mensagens.interno.service.test.ts`.
vi.mock('../../../config/env.js', () => ({
  env: { MINIO_BUCKET_PROCESSOS: 'processos' },
}));
vi.mock('../../auditoria/index.js', () => ({ registrar: vi.fn() }));

import {
  selecionarServidorMenorCarga,
  type CargaServidor,
} from '../processos.atribuicao.service.js';

/**
 * Property 7 — Algoritmo de menor carga (Req 12.2).
 *
 * A função `selecionarServidorMenorCarga` é PURA (sem I/O): recebe uma lista
 * de `{ servidorId, processosAtivos, ultimaAtribuicaoEm }` e retorna o
 * Servidor com MENOS `processosAtivos`. Em empate na carga, vence o de última
 * atribuição mais ANTIGA (menor `ultimaAtribuicaoEm.getTime()`), sendo `null`
 * tratado como infinitamente antigo (prioridade máxima).
 *
 * Nenhum mock além dos stubs de import é necessário — a função é exercitada
 * diretamente. NÃO modificamos a implementação; se uma property revelar um bug
 * genuíno, o contra-exemplo é reportado.
 */

/** Prioridade de desempate: quanto menor o valor, mais antigo (mais prioritário). */
function prioridadeTempo(carga: CargaServidor): number {
  return carga.ultimaAtribuicaoEm === null ? -Infinity : carga.ultimaAtribuicaoEm.getTime();
}

/** Gera um `ultimaAtribuicaoEm`: um Date ou null (nunca recebeu atribuição). */
const ultimaAtribuicaoArb: fc.Arbitrary<Date | null> = fc.option(
  fc
    .integer({ min: 0, max: 4_102_444_800_000 }) // 1970..2100 em ms
    .map((ms) => new Date(ms)),
  { nil: null },
);

/** Carga sem `servidorId` — o id único é atribuído por posição na lista. */
const cargaArb: fc.Arbitrary<Omit<CargaServidor, 'servidorId'>> = fc.record({
  processosAtivos: fc.integer({ min: 0, max: 50 }),
  ultimaAtribuicaoEm: ultimaAtribuicaoArb,
});

/** Lista não-vazia de CargaServidor com servidorId único por posição. */
const listaCargasArb: fc.Arbitrary<CargaServidor[]> = fc
  .array(cargaArb, { minLength: 1, maxLength: 12 })
  .map((parciais) =>
    parciais.map((p, i) => ({ servidorId: `srv-${i}`, ...p })),
  );

describe('Property 7: Algoritmo de Atribuição Automática (selecionarServidorMenorCarga)', () => {
  // Validates: Requirements 12.2
  it('sempre seleciona um Servidor da entrada com a MENOR carga de processos ativos', () => {
    fc.assert(
      fc.property(listaCargasArb, (servidores) => {
        const escolhido = selecionarServidorMenorCarga(servidores);

        // Lista não-vazia => escolhe alguém.
        expect(escolhido).not.toBeNull();
        const eleito = escolhido as CargaServidor;

        // O escolhido é membro da entrada (mesma referência/identidade).
        expect(servidores).toContain(eleito);

        // A carga do escolhido é o mínimo global.
        const minimo = Math.min(...servidores.map((s) => s.processosAtivos));
        expect(eleito.processosAtivos).toBe(minimo);
      }),
      { numRuns: 300 },
    );
  });

  // Validates: Requirements 12.2
  it('em empate na carga mínima, vence o de última atribuição mais antiga (null = mais antigo)', () => {
    // Gera >=2 servidores compartilhando a MESMA carga mínima, com
    // `ultimaAtribuicaoEm` variados (incluindo null), e alguns "distratores"
    // com carga estritamente maior que não podem vencer.
    const empateArb = fc
      .record({
        cargaMinima: fc.integer({ min: 0, max: 20 }),
        empatados: fc.array(ultimaAtribuicaoArb, { minLength: 2, maxLength: 8 }),
        // Distratores com carga maior (cargaMinima + delta, delta >= 1).
        distratores: fc.array(
          fc.record({
            delta: fc.integer({ min: 1, max: 30 }),
            ultimaAtribuicaoEm: ultimaAtribuicaoArb,
          }),
          { maxLength: 5 },
        ),
      })
      .map(({ cargaMinima, empatados, distratores }) => {
        const servidores: CargaServidor[] = empatados.map((ultima, i) => ({
          servidorId: `emp-${i}`,
          processosAtivos: cargaMinima,
          ultimaAtribuicaoEm: ultima,
        }));
        distratores.forEach((d, i) => {
          servidores.push({
            servidorId: `dist-${i}`,
            processosAtivos: cargaMinima + d.delta,
            ultimaAtribuicaoEm: d.ultimaAtribuicaoEm,
          });
        });
        return { servidores, cargaMinima };
      });

    fc.assert(
      fc.property(empateArb, ({ servidores, cargaMinima }) => {
        const escolhido = selecionarServidorMenorCarga(servidores);
        expect(escolhido).not.toBeNull();
        const eleito = escolhido as CargaServidor;

        // Vence sempre alguém da carga mínima.
        expect(eleito.processosAtivos).toBe(cargaMinima);

        // Entre os empatados na carga mínima, a menor prioridadeTempo vence.
        const empatadosNaMinima = servidores.filter((s) => s.processosAtivos === cargaMinima);
        const menorPrioridade = Math.min(...empatadosNaMinima.map(prioridadeTempo));
        expect(prioridadeTempo(eleito)).toBe(menorPrioridade);
      }),
      { numRuns: 300 },
    );
  });

  // Validates: Requirements 12.2
  it('retorna null para entrada vazia', () => {
    expect(selecionarServidorMenorCarga([])).toBeNull();
  });

  // Validates: Requirements 12.2
  it('é determinística: chamar duas vezes na mesma entrada retorna o mesmo servidorId', () => {
    fc.assert(
      fc.property(listaCargasArb, (servidores) => {
        const a = selecionarServidorMenorCarga(servidores);
        const b = selecionarServidorMenorCarga(servidores);
        expect(a?.servidorId).toBe(b?.servidorId);
      }),
      { numRuns: 200 },
    );
  });
});
