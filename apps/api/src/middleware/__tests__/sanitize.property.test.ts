// Feature: auditar-sistema-gestao, Property 8: Rejeição de Entradas com Padrões de Injeção
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { containsDangerousPattern, deepScan } from '../sanitize.js';

/**
 * Property 8: Rejeição de Entradas com Padrões de Injeção
 *
 * For any input containing SQL-injection patterns, XSS scripts or control
 * characters, the sanitizer MUST detect it (return true / reject); and for any
 * benign input (plain alphanumeric + accented Portuguese + safe punctuation) it
 * must NOT falsely reject.
 *
 * Validates: Requirements 20.3, 20.9
 */

const NUM_RUNS = 200;

// Fixed list of known-dangerous tokens that the sanitizer must always flag.
const DANGEROUS_TOKENS: string[] = [
  '<script>',
  '</script>',
  'javascript:',
  'onerror=',
  '; DROP TABLE',
  'UNION SELECT',
  '/*',
  '--',
  '<iframe',
  '\x00', // control character (NUL)
];

/**
 * "Safe" alphabet: letters (incl. accented Portuguese), digits, spaces and a
 * restricted set of punctuation. We deliberately EXCLUDE characters that
 * legitimately trigger sanitizer rules: ; < > ' = * as well as anything that
 * could compose a dangerous sequence.
 *
 * Note: `-` and `_` are individually safe, but `--` (two hyphens) is a SQL
 * comment terminator and `xp_` is a SQL rule. We therefore build safe strings
 * from discrete "words" joined by single spaces, where each word is drawn from
 * a curated character set and hyphens/underscores are never adjacent. To keep
 * the generator robustly safe we exclude `-` and `_` from the free alphabet and
 * only insert single, isolated punctuation between words.
 */
const SAFE_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZáéíóúÁÉÍÓÚãõÃÕçÇâêôÂÊÔàÀ';
const SAFE_DIGITS = '0123456789';
const SAFE_WORD_CHARS = (SAFE_LETTERS + SAFE_DIGITS).split('');

// Punctuation that is safe as an isolated separator/terminator. We exclude the
// SQL-comment double-hyphen risk by never placing two of these adjacent.
const SAFE_PUNCT = ['.', ',', '!', '?', '(', ')', '@'];

// Arbitrary for a single safe word (non-empty run of safe word chars).
const safeWordArb = fc
  .array(fc.constantFrom(...SAFE_WORD_CHARS), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''));

// Arbitrary for a safe string: words joined by single spaces, optionally
// separated by a single isolated punctuation mark. Guaranteed to contain none
// of the sanitizer's dangerous patterns.
const safeStringArb = fc
  .array(
    fc.tuple(safeWordArb, fc.option(fc.constantFrom(...SAFE_PUNCT), { nil: '' })),
    { minLength: 1, maxLength: 6 },
  )
  .map((parts) => parts.map(([word, punct]) => word + punct).join(' '));

// Arbitrary that embeds a known-dangerous token inside random safe surrounding
// text. The token is space-separated from the surrounding text so that
// keyword-based rules (which require word boundaries and trailing whitespace,
// e.g. `UNION SELECT`) are preserved in their intended form — the point of the
// property is that a genuine injection token embedded in otherwise-safe text is
// always detected, not that gluing letters onto a keyword defeats it.
const dangerousComposedArb = fc
  .tuple(safeStringArb, fc.constantFrom(...DANGEROUS_TOKENS), safeStringArb)
  .map(([before, token, after]) => `${before} ${token} ${after}`);

describe('Property 8: Rejeição de Entradas com Padrões de Injeção', () => {
  it('A: sempre detecta entradas contendo tokens perigosos (containsDangerousPattern + deepScan)', () => {
    fc.assert(
      fc.property(dangerousComposedArb, (composed) => {
        expect(containsDangerousPattern(composed)).toBe(true);
        expect(deepScan({ field: composed })).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('B: nunca rejeita falsamente entradas seguras', () => {
    fc.assert(
      fc.property(safeStringArb, (safe) => {
        expect(containsDangerousPattern(safe)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('C: deepScan recursa corretamente em objetos aninhados', () => {
    // Safe nested object shape.
    const safeNestedArb = fc.record({
      nome: safeStringArb,
      dados: fc.record({
        endereco: safeStringArb,
        tags: fc.array(safeStringArb, { maxLength: 4 }),
        nivel: fc.record({
          descricao: safeStringArb,
        }),
      }),
    });

    // For any safe nested object, deepScan returns false.
    fc.assert(
      fc.property(safeNestedArb, (obj) => {
        expect(deepScan(obj)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );

    // When a dangerous token is injected at any nested position, deepScan
    // returns true regardless of where it is placed.
    const injectionPositionArb = fc.constantFrom<
      'top' | 'mid' | 'array' | 'deep'
    >('top', 'mid', 'array', 'deep');

    fc.assert(
      fc.property(
        safeNestedArb,
        dangerousComposedArb,
        injectionPositionArb,
        (base, poison, position) => {
          const obj: any = {
            nome: base.nome,
            dados: {
              endereco: base.dados.endereco,
              tags: [...base.dados.tags],
              nivel: { descricao: base.dados.nivel.descricao },
            },
          };
          switch (position) {
            case 'top':
              obj.nome = poison;
              break;
            case 'mid':
              obj.dados.endereco = poison;
              break;
            case 'array':
              obj.dados.tags.push(poison);
              break;
            case 'deep':
              obj.dados.nivel.descricao = poison;
              break;
          }
          expect(deepScan(obj)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
