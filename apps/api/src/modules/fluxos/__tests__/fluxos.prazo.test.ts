import { describe, it, expect } from 'vitest';
import {
  calcularPrazoTotalFluxo,
  resumoPrazoEtapas,
} from '../fluxos.prazo.js';

interface Etapa {
  id?: string;
  etapaId?: string;
  nome: string;
  prazosDiasUteis: number;
}

function mkEtapas(prazos: number[]): Etapa[] {
  return prazos.map((p, i) => ({
    id: `etapa-${i}`,
    nome: `Etapa ${i}`,
    prazosDiasUteis: p,
  }));
}

describe('calcularPrazoTotalFluxo', () => {
  it('soma aritmética dos prazos para múltiplas etapas', () => {
    const etapas = mkEtapas([2, 3, 5, 1]);
    expect(calcularPrazoTotalFluxo(etapas)).toBe(11);
  });

  it('etapa única retorna o prazo dessa etapa', () => {
    expect(calcularPrazoTotalFluxo(mkEtapas([7]))).toBe(7);
  });

  it('array vazio retorna total 0', () => {
    expect(calcularPrazoTotalFluxo([])).toBe(0);
  });

  it('funciona para até 50 etapas', () => {
    const prazos = Array.from({ length: 50 }, (_, i) => i + 1); // 1..50
    const esperado = (50 * 51) / 2; // 1275
    expect(calcularPrazoTotalFluxo(mkEtapas(prazos))).toBe(esperado);
  });
});

describe('resumoPrazoEtapas', () => {
  it('retorna total e uma entrada por etapa preservando ordem e nomes', () => {
    const etapas: Etapa[] = [
      { id: 'a', nome: 'Recebimento', prazosDiasUteis: 2 },
      { id: 'b', nome: 'Análise', prazosDiasUteis: 5 },
      { id: 'c', nome: 'Decisão', prazosDiasUteis: 3 },
    ];

    const resumo = resumoPrazoEtapas(etapas);

    expect(resumo.total).toBe(10);
    expect(resumo.porEtapa).toHaveLength(3);
    expect(resumo.porEtapa.map((e) => e.nome)).toEqual([
      'Recebimento',
      'Análise',
      'Decisão',
    ]);
    expect(resumo.porEtapa.map((e) => e.prazosDiasUteis)).toEqual([2, 5, 3]);
  });

  it('usa etapaId quando presente e cai para id caso contrário', () => {
    const etapas: Etapa[] = [
      { etapaId: 'x1', nome: 'Com etapaId', prazosDiasUteis: 1 },
      { id: 'y1', nome: 'Com id', prazosDiasUteis: 4 },
    ];

    const resumo = resumoPrazoEtapas(etapas);

    expect(resumo.porEtapa[0]!.etapaId).toBe('x1');
    expect(resumo.porEtapa[1]!.etapaId).toBe('y1');
  });

  it('array vazio retorna total 0 e nenhuma etapa', () => {
    const resumo = resumoPrazoEtapas([]);
    expect(resumo.total).toBe(0);
    expect(resumo.porEtapa).toEqual([]);
  });

  it('recálculo reflete a nova soma ao adicionar uma etapa', () => {
    const base = mkEtapas([2, 3]);
    expect(resumoPrazoEtapas(base).total).toBe(5);

    const comAdicao = [...base, { id: 'nova', nome: 'Nova', prazosDiasUteis: 4 }];
    expect(resumoPrazoEtapas(comAdicao).total).toBe(9);
  });

  it('recálculo reflete a nova soma ao remover uma etapa', () => {
    const base = mkEtapas([2, 3, 5]);
    expect(resumoPrazoEtapas(base).total).toBe(10);

    const comRemocao = base.slice(0, 2);
    expect(resumoPrazoEtapas(comRemocao).total).toBe(5);
  });

  it('recálculo reflete a nova soma ao alterar o prazo de uma etapa', () => {
    const base = mkEtapas([2, 3, 5]);
    expect(resumoPrazoEtapas(base).total).toBe(10);

    const alterado = base.map((e, i) =>
      i === 1 ? { ...e, prazosDiasUteis: 8 } : e,
    );
    expect(resumoPrazoEtapas(alterado).total).toBe(15);
  });
});
