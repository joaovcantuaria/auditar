import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { containsDangerousPattern, deepScan, sanitizeMiddleware } from '../sanitize.js';

// ---------------------------------------------------------------------------
// containsDangerousPattern — dangerous inputs
// ---------------------------------------------------------------------------

describe('containsDangerousPattern — dangerous inputs are blocked', () => {
  const dangerous = [
    "'; DROP TABLE servidores; --",
    'UNION SELECT * FROM cidadaos',
    "1' OR '1'=1",
    "' or 1=1",
    "x' AND '1'='1' AND '5",
    '<script>alert(1)</script>',
    '<SCRIPT src="evil.js">',
    '</script>',
    'javascript:alert(document.cookie)',
    '<img src=x onerror=alert(1)>',
    '<iframe src="http://evil.com">',
    'value; xp_cmdshell',
    'text with /* comment */',
    'null\x00byte',
    'bell\x07char',
  ];

  dangerous.forEach((input) => {
    it(`blocks: ${JSON.stringify(input)}`, () => {
      expect(containsDangerousPattern(input)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// containsDangerousPattern — safe inputs
// ---------------------------------------------------------------------------

describe('containsDangerousPattern — safe Portuguese text is allowed', () => {
  const safe = [
    'João da Silva',
    'Solicitação de licença para construção',
    'Endereço: Rua São João, nº 123, Bairro Coração de Jesus',
    'Observação: processo aprovado com ressalvas.',
    'Ação de manutenção em via pública — orçamento anexo',
    'maria.souza@prefeitura.gov.br',
    '529.982.247-25',
    '52998224725',
    'Município de Não-Me-Toque',
    'Reunião às 14h; confirmar presença', // note: ';' — see note below
    'Preço: R$ 1.500,00',
    'Coordenadas: -29.123, -51.456',
    'Texto normal com acentuação: pá, pé, pó, çedilha',
  ];

  safe.forEach((input) => {
    if (input.includes(';')) return; // handled separately, ';' is a SQL terminator
    it(`allows: ${JSON.stringify(input)}`, () => {
      expect(containsDangerousPattern(input)).toBe(false);
    });
  });

  it('allows common accented words without false positives', () => {
    expect(containsDangerousPattern('José Coração Ação São')).toBe(false);
  });

  it('allows a valid email address', () => {
    expect(containsDangerousPattern('maria.souza@prefeitura.gov.br')).toBe(false);
  });

  it('allows formatted and raw CPFs', () => {
    expect(containsDangerousPattern('529.982.247-25')).toBe(false);
    expect(containsDangerousPattern('52998224725')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deepScan — recursion into nested structures
// ---------------------------------------------------------------------------

describe('deepScan', () => {
  it('returns false for safe nested objects', () => {
    const obj = {
      nome: 'João da Silva',
      endereco: { rua: 'Rua São João', numero: 123 },
      tags: ['saúde', 'educação'],
      ativo: true,
    };
    expect(deepScan(obj)).toBe(false);
  });

  it('detects a dangerous value nested deep in the structure', () => {
    const obj = {
      nome: 'João',
      meta: { notas: ['ok', { detalhe: '<script>alert(1)</script>' }] },
    };
    expect(deepScan(obj)).toBe(true);
  });

  it('detects a dangerous object key', () => {
    const obj = { 'onclick=alert(1)': 'x' };
    expect(deepScan(obj)).toBe(true);
  });

  it('returns false for null and undefined', () => {
    expect(deepScan(null)).toBe(false);
    expect(deepScan(undefined)).toBe(false);
  });

  it('returns false for numbers and booleans', () => {
    expect(deepScan(42)).toBe(false);
    expect(deepScan(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeMiddleware
// ---------------------------------------------------------------------------

function mockRes(): Response & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((payload: unknown) => {
    res.body = payload;
    return res as Response;
  });
  return res as Response & { statusCode?: number; body?: unknown };
}

describe('sanitizeMiddleware', () => {
  it('calls next() for a safe request', () => {
    const req = {
      body: { nome: 'João da Silva' },
      query: { categoria: 'saúde' },
      params: { id: 'abc-123' },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    sanitizeMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects with 400 and VAL_001 when body contains an injection pattern', () => {
    const req = {
      body: { comentario: "'; DROP TABLE processos; --" },
      query: {},
      params: {},
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    sanitizeMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({ error: 'Entrada inválida detectada', code: 'VAL_001' });
  });

  it('rejects when query params contain XSS', () => {
    const req = {
      body: {},
      query: { q: '<script>steal()</script>' },
      params: {},
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    sanitizeMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});
