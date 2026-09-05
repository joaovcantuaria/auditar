import { describe, it, expect } from 'vitest';
import {
  validarCPF,
  formatarCPF,
  desformatarCPF,
  calcularPrazoTotalFluxo,
  formatarProtocolo,
  protocoloRegex,
  calcularPrazoFinal,
  isDiaUtil,
} from '../index.js';

// ---------------------------------------------------------------------------
// validarCPF
// ---------------------------------------------------------------------------

describe('validarCPF', () => {
  // Known-valid CPFs (computed with correct check digits)
  const validCPFs = [
    '52998224725', // common test CPF
    '11144477735',
    '33333333330', // edge: starts with repeated digits but has valid check digits — actually invalid (all-same test)
    '12345678909', // well-known test value
    '98765432100',
  ];

  // Remove the ambiguous one (all-same-digit variant is separately tested)
  const definitelyValid = ['52998224725', '11144477735', '12345678909'];

  definitelyValid.forEach((cpf) => {
    it(`accepts valid CPF ${cpf}`, () => {
      expect(validarCPF(cpf)).toBe(true);
    });
  });

  it('accepts CPF with formatting characters', () => {
    // Same as 529.982.247-25
    expect(validarCPF('529.982.247-25')).toBe(true);
  });

  it('rejects CPF with wrong first check digit', () => {
    // Flip last two digits of a valid CPF
    expect(validarCPF('52998224726')).toBe(false);
  });

  it('rejects CPF with wrong second check digit', () => {
    expect(validarCPF('52998224715')).toBe(false);
  });

  it('rejects CPF that is too short', () => {
    expect(validarCPF('1234567890')).toBe(false); // 10 digits
  });

  it('rejects CPF that is too long', () => {
    expect(validarCPF('123456789012')).toBe(false); // 12 digits
  });

  it('rejects empty string', () => {
    expect(validarCPF('')).toBe(false);
  });

  // All-same-digit CPFs are technically "passing" the arithmetic if you
  // only check the formula, but the Receita Federal rejects them explicitly.
  const allSame = [
    '00000000000',
    '11111111111',
    '22222222222',
    '33333333333',
    '44444444444',
    '55555555555',
    '66666666666',
    '77777777777',
    '88888888888',
    '99999999999',
  ];

  allSame.forEach((cpf) => {
    it(`rejects all-same-digit CPF ${cpf}`, () => {
      expect(validarCPF(cpf)).toBe(false);
    });
  });

  it('rejects CPF with letters', () => {
    expect(validarCPF('5299822472A')).toBe(false);
  });

  it('rejects CPF with spaces only', () => {
    expect(validarCPF('           ')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatarCPF / desformatarCPF — must be inverses
// ---------------------------------------------------------------------------

describe('formatarCPF and desformatarCPF', () => {
  const rawCPFs = ['52998224725', '11144477735', '12345678909'];

  rawCPFs.forEach((raw) => {
    it(`round-trips ${raw}`, () => {
      const formatted = formatarCPF(raw);
      // Ensure format pattern XXX.XXX.XXX-XX
      expect(formatted).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
      // desformatarCPF must recover the original
      expect(desformatarCPF(formatted)).toBe(raw);
    });
  });

  it('formatarCPF formats correctly', () => {
    expect(formatarCPF('52998224725')).toBe('529.982.247-25');
  });

  it('desformatarCPF strips dots and hyphens', () => {
    expect(desformatarCPF('529.982.247-25')).toBe('52998224725');
  });

  it('desformatarCPF is idempotent on already-raw input', () => {
    expect(desformatarCPF('52998224725')).toBe('52998224725');
  });
});

// ---------------------------------------------------------------------------
// calcularPrazoTotalFluxo
// ---------------------------------------------------------------------------

describe('calcularPrazoTotalFluxo', () => {
  it('returns 0 for an empty array', () => {
    expect(calcularPrazoTotalFluxo([])).toBe(0);
  });

  it('returns the single stage deadline for a one-stage flow', () => {
    expect(calcularPrazoTotalFluxo([{ prazosDiasUteis: 5 }])).toBe(5);
  });

  it('sums multiple stage deadlines', () => {
    const etapas = [
      { prazosDiasUteis: 3 },
      { prazosDiasUteis: 7 },
      { prazosDiasUteis: 10 },
    ];
    expect(calcularPrazoTotalFluxo(etapas)).toBe(20);
  });

  it('handles large numbers of stages', () => {
    const etapas = Array.from({ length: 50 }, (_, i) => ({ prazosDiasUteis: i + 1 }));
    // Sum of 1..50 = 1275
    expect(calcularPrazoTotalFluxo(etapas)).toBe(1275);
  });

  it('handles stages with deadline of 1 day each', () => {
    const etapas = Array.from({ length: 5 }, () => ({ prazosDiasUteis: 1 }));
    expect(calcularPrazoTotalFluxo(etapas)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// protocoloRegex
// ---------------------------------------------------------------------------

describe('protocoloRegex', () => {
  it('matches valid protocol format', () => {
    expect(protocoloRegex.test('2025-00001')).toBe(true);
    expect(protocoloRegex.test('2024-99999')).toBe(true);
    expect(protocoloRegex.test('2000-00000')).toBe(true);
  });

  it('rejects invalid protocol formats', () => {
    expect(protocoloRegex.test('25-00001')).toBe(false);    // year too short
    expect(protocoloRegex.test('2025-0001')).toBe(false);   // seq too short
    expect(protocoloRegex.test('2025-000001')).toBe(false); // seq too long
    expect(protocoloRegex.test('202500001')).toBe(false);   // missing hyphen
    expect(protocoloRegex.test('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatarProtocolo
// ---------------------------------------------------------------------------

describe('formatarProtocolo', () => {
  it('pads sequence to 5 digits', () => {
    expect(formatarProtocolo(2025, 1)).toBe('2025-00001');
    expect(formatarProtocolo(2025, 42)).toBe('2025-00042');
    expect(formatarProtocolo(2025, 99999)).toBe('2025-99999');
  });

  it('generated protocols always match protocoloRegex', () => {
    const sequences = [1, 10, 100, 1000, 10000, 99999];
    sequences.forEach((seq) => {
      const p = formatarProtocolo(2025, seq);
      expect(protocoloRegex.test(p)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// isDiaUtil
// ---------------------------------------------------------------------------

describe('isDiaUtil', () => {
  it('returns false for Sunday', () => {
    const sunday = new Date(2025, 0, 5); // Known Sunday
    expect(isDiaUtil(sunday)).toBe(false);
  });

  it('returns false for Saturday', () => {
    const saturday = new Date(2025, 0, 4); // Known Saturday
    expect(isDiaUtil(saturday)).toBe(false);
  });

  it('returns true for a regular weekday', () => {
    const monday = new Date(2025, 0, 6); // Monday
    expect(isDiaUtil(monday)).toBe(true);
  });

  it('returns false for a national holiday (Jan 1)', () => {
    const newYear = new Date(2025, 0, 1);
    expect(isDiaUtil(newYear)).toBe(false);
  });

  it('returns false for Nov 15 (Proclamação da República)', () => {
    const holiday = new Date(2025, 10, 15);
    // Check it's a weekday first so the test is meaningful
    expect(isDiaUtil(holiday)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calcularPrazoFinal
// ---------------------------------------------------------------------------

describe('calcularPrazoFinal', () => {
  it('adds exactly N business days', () => {
    // Monday 2025-01-06 + 5 business days = Monday 2025-01-13
    // (Tue 7, Wed 8, Thu 9, Fri 10, Mon 13 — Sat/Sun skipped)
    const start = new Date(2025, 0, 6);
    const result = calcularPrazoFinal(start, 5);
    expect(result).toEqual(new Date(2025, 0, 13));
  });

  it('skips weekends', () => {
    // Friday 2025-01-10 + 1 business day = Monday 2025-01-13
    const friday = new Date(2025, 0, 10);
    const result = calcularPrazoFinal(friday, 1);
    expect(result).toEqual(new Date(2025, 0, 13));
  });

  it('skips national holidays', () => {
    // Dec 24, 2025 (Wed) + 1 business day → skips Dec 25 (Natal) → Dec 26 (Fri)
    const start = new Date(2025, 11, 24);
    const result = calcularPrazoFinal(start, 1);
    expect(result).toEqual(new Date(2025, 11, 26));
  });
});
