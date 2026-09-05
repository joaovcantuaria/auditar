// Feature: auditar-sistema-gestao, Property 9: Prazo Total do Fluxo é Soma das Etapas
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calcularPrazoTotalFluxo } from '../fluxos.prazo.js';

/**
 * Property 9: Prazo Total do Fluxo é Soma das Etapas
 *
 * Para qualquer configuração de fluxo com N etapas, o prazo total deve ser
 * igual à soma aritmética dos `prazosDiasUteis` de todas as N etapas, e deve
 * ser recalculado corretamente após qualquer adição/remoção/alteração.
 *
 * Validates: Requirements 15.5
 */

interface Etapa {
  prazosDiasUteis: number;
}

/** Gerador de um prazo de etapa: inteiro em [1, 365]. */
const prazoArb = fc.integer({ min: 1, max: 365 });

/** Gerador de uma etapa a partir de um prazo. */
const etapaArb = prazoArb.map((prazosDiasUteis): Etapa => ({ prazosDiasUteis }));

/** Gerador de um fluxo com 1..50 etapas. */
const etapasArb = fc.array(etapaArb, { minLength: 1, maxLength: 50 });

const somaPrazos = (etapas: ReadonlyArray<Etapa>): number =>
  etapas.reduce((acc, e) => acc + e.prazosDiasUteis, 0);

describe('Property 9: Prazo Total do Fluxo é Soma das Etapas', () => {
  it('A (soma): total = soma aritmética dos prazos de todas as etapas', () => {
    fc.assert(
      fc.property(etapasArb, (etapas) => {
        expect(calcularPrazoTotalFluxo(etapas)).toBe(somaPrazos(etapas));
      }),
      { numRuns: 500 },
    );
  });

  it('B (adição): adicionar uma etapa aumenta o total exatamente pelo prazo dela', () => {
    fc.assert(
      fc.property(etapasArb, etapaArb, (base, extra) => {
        const totalBase = calcularPrazoTotalFluxo(base);
        const totalComExtra = calcularPrazoTotalFluxo([...base, extra]);
        expect(totalComExtra).toBe(totalBase + extra.prazosDiasUteis);
      }),
      { numRuns: 500 },
    );
  });

  it('C (remoção): remover a última etapa reduz o total exatamente pelo prazo dela', () => {
    fc.assert(
      fc.property(etapasArb, (etapas) => {
        const totalAntes = calcularPrazoTotalFluxo(etapas);
        const ultima = etapas[etapas.length - 1]!;
        const totalDepois = calcularPrazoTotalFluxo(etapas.slice(0, -1));
        expect(totalDepois).toBe(totalAntes - ultima.prazosDiasUteis);
      }),
      { numRuns: 500 },
    );
  });

  it('D (alteração): alterar o prazo de uma etapa muda o total exatamente pelo delta', () => {
    fc.assert(
      fc.property(
        etapasArb,
        prazoArb,
        fc.nat(),
        (etapas, novoPrazo, indiceBruto) => {
          const indice = indiceBruto % etapas.length;
          const totalAntes = calcularPrazoTotalFluxo(etapas);
          const delta = novoPrazo - etapas[indice]!.prazosDiasUteis;

          const alterado = etapas.map((e, i) =>
            i === indice ? { prazosDiasUteis: novoPrazo } : e,
          );
          const totalDepois = calcularPrazoTotalFluxo(alterado);

          expect(totalDepois).toBe(totalAntes + delta);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('E (vazio): fluxo sem etapas tem prazo total 0', () => {
    expect(calcularPrazoTotalFluxo([])).toBe(0);
  });
});
