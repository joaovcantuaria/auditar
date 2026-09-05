import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validarCPF, formatarCPF } from '../index.js';

// ---------------------------------------------------------------------------
// Property 1: Validação de CPF (Validates: Requirements 1.2, 21.1)
//
// For any 11-digit string, validarCPF must accept exactly those whose two
// check digits are correct (per the Receita Federal algorithm) and reject
// all others.
//
// The check-digit computation below is an independent source of truth,
// implemented directly in the test so it does not depend on the module under
// test. It mirrors the canonical RF algorithm:
//   - first digit:  weights 10..2 over the first 9 digits
//   - second digit: weights 11..2 over the first 10 digits
//   - remainder = (sum * 10) % 11; if remainder is 10, it becomes 0
// ---------------------------------------------------------------------------

/** Computes a single CPF check digit from a list of base digits. */
function computeCheckDigit(baseDigits: number[]): number {
  const len = baseDigits.length; // 9 for first digit, 10 for second
  let sum = 0;
  for (let i = 0; i < len; i++) {
    // weight starts at (len + 1) and decreases: 10..2 (len=9) or 11..2 (len=10)
    sum += baseDigits[i]! * (len + 1 - i);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

/** Builds a full 11-digit CPF string from 9 base digits, computing check digits. */
function buildValidCPF(base: number[]): string {
  const d1 = computeCheckDigit(base);
  const d2 = computeCheckDigit([...base, d1]);
  return [...base, d1, d2].map(String).join('');
}

/** Generator for exactly 9 base digits (0-9). */
const nineBaseDigits = fc.array(fc.integer({ min: 0, max: 9 }), {
  minLength: 9,
  maxLength: 9,
});

describe('Property 1: validarCPF', () => {
  // -------------------------------------------------------------------------
  // 1. Correct-CPF acceptance
  // -------------------------------------------------------------------------
  it('accepts every CPF built with correct check digits (digits-only)', () => {
    fc.assert(
      fc.property(nineBaseDigits, (base) => {
        const cpf = buildValidCPF(base);
        // Skip the all-same-digit case: the RF algorithm rejects these by
        // design even though the check-digit arithmetic is internally
        // consistent (covered separately in the malformed-input property).
        fc.pre(!/^(\d)\1{10}$/.test(cpf));
        expect(validarCPF(cpf)).toBe(true);
      }),
    );
  });

  it('accepts every valid CPF in masked form (XXX.XXX.XXX-XX)', () => {
    fc.assert(
      fc.property(nineBaseDigits, (base) => {
        const cpf = buildValidCPF(base);
        fc.pre(!/^(\d)\1{10}$/.test(cpf));
        const masked = formatarCPF(cpf);
        // formatarCPF must have produced the canonical masked form
        expect(masked).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
        expect(validarCPF(masked)).toBe(true);
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 2. Rejection of wrong check digits
  // -------------------------------------------------------------------------
  it('rejects any 11-digit CPF whose last two digits are not the correct check digits', () => {
    fc.assert(
      fc.property(
        nineBaseDigits,
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 9 }),
        (base, last1, last2) => {
          const correctD1 = computeCheckDigit(base);
          const correctD2 = computeCheckDigit([...base, correctD1]);
          // Only consider wrong check-digit pairs
          fc.pre(!(last1 === correctD1 && last2 === correctD2));
          const cpf = [...base, last1, last2].map(String).join('');
          // Exclude all-same-digit strings: those are rejected for a
          // different reason and are covered by the malformed-input property.
          fc.pre(!/^(\d)\1{10}$/.test(cpf));
          expect(validarCPF(cpf)).toBe(false);
        },
      ),
    );
  });

  // -------------------------------------------------------------------------
  // 3. Rejection of malformed input
  // -------------------------------------------------------------------------
  it('rejects strings that do not have exactly 11 digits', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (s) => {
          const digitCount = (s.match(/\d/g) ?? []).length;
          fc.pre(digitCount !== 11);
          expect(validarCPF(s)).toBe(false);
        },
      ),
    );
  });

  it('rejects any all-same-digit 11-digit string', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), (d) => {
        const cpf = String(d).repeat(11);
        expect(validarCPF(cpf)).toBe(false);
      }),
    );
  });

  it('rejects 11-character strings containing non-digit characters', () => {
    fc.assert(
      fc.property(
        // 10 digits + 1 guaranteed non-digit/non-mask char, arranged to keep length 11
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 10 }),
        fc.constantFrom('A', 'z', '#', '@', ' ', '*'),
        (digits, letter) => {
          const cpf = digits.map(String).join('') + letter; // 11 chars, only 10 digits
          expect(validarCPF(cpf)).toBe(false);
        },
      ),
    );
  });
});
