import { describe, it, expect } from 'vitest';
import { booleanEnv } from '../env.js';

describe('booleanEnv', () => {
  const schema = booleanEnv(false);

  it.each(['true', 'TRUE', '1', 'yes', 'on', ' true '])('"%s" vira true', (v) => {
    expect(schema.parse(v)).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'no', 'off'])('"%s" vira false', (v) => {
    expect(schema.parse(v)).toBe(false);
  });

  it('usa o padrão quando ausente ou vazio', () => {
    expect(schema.parse(undefined)).toBe(false);
    expect(schema.parse('')).toBe(false);
    expect(booleanEnv(true).parse(undefined)).toBe(true);
  });

  it('rejeita valores ambíguos', () => {
    expect(() => schema.parse('talvez')).toThrow();
  });
});
