import { describe, it, expect, vi } from 'vitest';
import {
  registrar,
  registrarSync,
  stringifyValor,
  AUDITORIA_QUEUE_NAME,
  type AuditoriaEnqueuer,
  type PrismaAuditoriaClient,
} from '../auditoria.service.js';
import type { RegistrarAuditoriaDto } from '../auditoria.types.js';

// ---------------------------------------------------------------------------
// stringifyValor
// ---------------------------------------------------------------------------

describe('stringifyValor', () => {
  it('returns undefined for undefined input', () => {
    expect(stringifyValor(undefined)).toBeUndefined();
  });

  it('JSON-stringifies objects', () => {
    expect(stringifyValor({ status: 'ativo', n: 3 })).toBe('{"status":"ativo","n":3}');
  });

  it('passes strings through without extra quoting', () => {
    expect(stringifyValor('etapa_2')).toBe('etapa_2');
  });

  it('truncates serialized output to 1000 characters', () => {
    const big = 'x'.repeat(5000);
    const result = stringifyValor(big);
    expect(result).toBeDefined();
    expect(result!.length).toBe(1000);
  });

  it('keeps output <= 1000 characters for large objects', () => {
    const bigObj = { data: 'y'.repeat(5000) };
    const result = stringifyValor(bigObj);
    expect(result!.length).toBe(1000);
  });

  it('handles null as a valid serializable value', () => {
    expect(stringifyValor(null)).toBe('null');
  });
});

// ---------------------------------------------------------------------------
// registrar (async / enqueue)
// ---------------------------------------------------------------------------

function baseDto(overrides: Partial<RegistrarAuditoriaDto> = {}): RegistrarAuditoriaDto {
  return {
    ator: 'servidor',
    atorServidorId: 'srv-1',
    enderecoIp: '203.0.113.7',
    tipoAcao: 'mover_etapa',
    modulo: 'processos',
    objetoId: 'proc-99',
    tipoObjeto: 'Processo',
    valorAnterior: { etapa: 'analise' },
    valorPosterior: { etapa: 'aprovacao' },
    ...overrides,
  };
}

describe('registrar', () => {
  it('enqueues a job with correctly mapped and serialized payload', async () => {
    const add = vi.fn().mockResolvedValue({ id: '1' });
    const queue: AuditoriaEnqueuer = { add };

    await registrar(baseDto(), queue);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(AUDITORIA_QUEUE_NAME, {
      ator: 'servidor',
      atorCidadaoId: undefined,
      atorServidorId: 'srv-1',
      enderecoIp: '203.0.113.7',
      tipoAcao: 'mover_etapa',
      modulo: 'processos',
      objetoId: 'proc-99',
      tipoObjeto: 'Processo',
      valorAnterior: '{"etapa":"analise"}',
      valorPosterior: '{"etapa":"aprovacao"}',
    });
  });

  it('does NOT throw when the enqueue fails (Req 17.8)', async () => {
    const add = vi.fn().mockRejectedValue(new Error('redis down'));
    const queue: AuditoriaEnqueuer = { add };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(registrar(baseDto(), queue)).resolves.toBeUndefined();

    // Falha registrada internamente, mas não propagada.
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// registrarSync (transactional / direct write)
// ---------------------------------------------------------------------------

describe('registrarSync', () => {
  it('writes all mandatory fields via the provided prisma client', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'log-1' });
    const prismaMock = { auditoriaLog: { create } } as unknown as PrismaAuditoriaClient;

    await registrarSync(
      baseDto({
        ator: 'servidor',
        atorServidorId: 'srv-1',
        enderecoIp: '203.0.113.7',
        tipoAcao: 'mover_etapa',
        objetoId: 'proc-99',
      }),
      prismaMock,
    );

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0];
    expect(arg.data.ator).toBe('servidor');
    expect(arg.data.enderecoIp).toBe('203.0.113.7');
    expect(arg.data.tipoAcao).toBe('mover_etapa');
    expect(arg.data.objetoId).toBe('proc-99');
    // data/hora em UTC no momento da persistência
    expect(arg.data.realizadaEmUtc).toBeInstanceOf(Date);
    expect(arg.data.valorAnterior).toBe('{"etapa":"analise"}');
    expect(arg.data.valorPosterior).toBe('{"etapa":"aprovacao"}');
  });

  it('propagates errors so the caller transaction can roll back (Req 11.9)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('constraint violation'));
    const prismaMock = { auditoriaLog: { create } } as unknown as PrismaAuditoriaClient;

    await expect(registrarSync(baseDto(), prismaMock)).rejects.toThrow('constraint violation');
  });
});
