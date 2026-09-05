// Feature: auditar-sistema-gestao, Property 15: Completude e Exclusão de Conteúdo do PDF do Processo (Req 26.1, 26.4)
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  montarConteudoPdf,
  SECOES_OBRIGATORIAS,
  CANAL_PUBLICO,
  type DadosProcessoPdf,
  type MensagemPdf,
} from '../pdf/processoPdfContent.js';

/**
 * Property 15 — Completude e Exclusão de Conteúdo do PDF do Processo (Req 26.1, 26.4).
 *
 * *For any* Processo, o conteúdo montado por `montarConteudoPdf` deve conter
 * TODAS as seções obrigatórias (cabeçalho com protocolo/tipo/unidade/status,
 * dados do cidadão, respostas do formulário, histórico de movimentações,
 * mensagens públicas e lista de documentos) e NÃO deve conter nenhuma mensagem
 * do canal interno entre Servidores.
 *
 * A prova gera aleatoriamente um conjunto misto de mensagens (públicas +
 * internas) e verifica que:
 *   1. Todas as seções obrigatórias estão presentes (completude — Req 26.1).
 *   2. Nenhum conteúdo de mensagem interna aparece em qualquer linha do
 *      conteúdo montado (exclusão — Req 26.4).
 *   3. Todo conteúdo de mensagem pública aparece na seção de mensagens.
 *
 * A função é PURA; um contra-exemplo genuíno seria reportado sem que a
 * implementação seja alterada.
 *
 * Validates: Requirements 26.1, 26.4
 */

// --- Arbitrários -----------------------------------------------------------

/** Texto curto não vazio (evita colisões triviais entre público/interno). */
const textoArb = fc.string({ minLength: 1, maxLength: 40 });

/** Mensagem com marcador de canal e conteúdo prefixado para rastreio. */
const mensagemArb: fc.Arbitrary<MensagemPdf & { conteudo: string }> = fc
  .record({
    canal: fc.constantFrom(CANAL_PUBLICO, 'interno'),
    conteudo: textoArb,
    enviadaEm: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    autor: fc.option(textoArb, { nil: null }),
  })
  .map((m) => ({
    ...m,
    // Prefixa o conteúdo com o canal para tornar público/interno inconfundíveis
    // ao inspecionar as linhas montadas.
    conteudo: `[${m.canal}]${m.conteudo}`,
  }));

const respostaArb = fc.record({
  campoLabel: fc.option(textoArb, { nil: null }),
  campoId: fc.string({ minLength: 1, maxLength: 12 }),
  valor: textoArb,
});

const movimentacaoArb = fc.record({
  autor: fc.option(textoArb, { nil: null }),
  data: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
  observacao: fc.option(textoArb, { nil: null }),
});

const documentoArb = fc.record({ nomeOriginal: textoArb });

const cabecalhoArb = fc.record({
  protocolo: fc.string({ minLength: 1, maxLength: 20 }),
  tipoProcesso: textoArb,
  unidade: textoArb,
  status: textoArb,
  cidadao: fc.option(
    fc.record({ nome: textoArb, cpf: fc.string({ minLength: 1, maxLength: 14 }) }),
    { nil: null },
  ),
});

const dadosArb: fc.Arbitrary<DadosProcessoPdf> = fc.record({
  cabecalho: cabecalhoArb,
  respostas: fc.array(respostaArb, { maxLength: 8 }),
  movimentacoes: fc.array(movimentacaoArb, { maxLength: 8 }),
  mensagens: fc.array(mensagemArb, { maxLength: 12 }),
  documentos: fc.array(documentoArb, { maxLength: 8 }),
});

// --- Propriedades ----------------------------------------------------------

describe('Property 15 — Completude e Exclusão de Conteúdo do PDF do Processo (Req 26.1, 26.4)', () => {
  it('contém todas as seções obrigatórias e nenhuma mensagem interna', () => {
    fc.assert(
      fc.property(dadosArb, (dados) => {
        const conteudo = montarConteudoPdf(dados);

        // (1) Completude: todas as seções obrigatórias presentes, na ordem esperada.
        const idsPresentes = conteudo.secoes.map((s) => s.id);
        for (const secaoEsperada of SECOES_OBRIGATORIAS) {
          expect(idsPresentes).toContain(secaoEsperada);
        }
        expect(idsPresentes).toEqual([...SECOES_OBRIGATORIAS]);

        // Junta todas as linhas de todas as seções para inspeção de conteúdo.
        const todasAsLinhas = conteudo.secoes.flatMap((s) => s.linhas).join('\n');

        // (2) Exclusão: nenhum conteúdo de mensagem interna aparece.
        const internas = dados.mensagens.filter((m) => m.canal !== CANAL_PUBLICO);
        for (const interna of internas) {
          expect(todasAsLinhas).not.toContain(interna.conteudo);
        }

        // (3) Inclusão: todo conteúdo de mensagem pública aparece na seção de mensagens.
        const secaoMensagens = conteudo.secoes.find((s) => s.id === 'mensagens');
        expect(secaoMensagens).toBeDefined();
        const linhasMensagens = secaoMensagens!.linhas.join('\n');
        const publicas = dados.mensagens.filter((m) => m.canal === CANAL_PUBLICO);
        for (const publica of publicas) {
          expect(linhasMensagens).toContain(publica.conteudo);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('produz sempre as seções obrigatórias mesmo sem nenhum dado', () => {
    const vazio: DadosProcessoPdf = {
      cabecalho: {
        protocolo: 'PROT-1',
        tipoProcesso: 'Tipo',
        unidade: 'Unidade',
        status: 'aberto',
        cidadao: null,
      },
      respostas: [],
      movimentacoes: [],
      mensagens: [],
      documentos: [],
    };
    const conteudo = montarConteudoPdf(vazio);
    expect(conteudo.secoes.map((s) => s.id)).toEqual([...SECOES_OBRIGATORIAS]);
    // Cada seção sempre tem ao menos uma linha (dados ou aviso de ausência).
    for (const secao of conteudo.secoes) {
      expect(secao.linhas.length).toBeGreaterThan(0);
    }
  });
});
