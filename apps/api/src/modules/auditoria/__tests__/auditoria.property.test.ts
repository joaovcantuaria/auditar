// Feature: auditar-sistema-gestao, Property 6: Completude do Registro de Auditoria
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { registrarSync, stringifyValor } from '../auditoria.service.js';
import type { PrismaAuditoriaClient } from '../auditoria.service.js';
import type { RegistrarAuditoriaDto } from '../auditoria.types.js';

const MAX_VALOR_LENGTH = 1000;

/**
 * Constrói um mock de Prisma que captura o objeto `data` passado para
 * `auditoriaLog.create({ data })`, permitindo inspecionar o registro
 * efetivamente persistido pela camada de auditoria.
 */
function makeMockPrisma(): {
  client: PrismaAuditoriaClient;
  getLastData: () => Record<string, unknown> | undefined;
} {
  let lastData: Record<string, unknown> | undefined;
  const client = {
    auditoriaLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        lastData = args.data;
        return args.data;
      },
    },
  } as unknown as PrismaAuditoriaClient;
  return { client, getLastData: () => lastData };
}

/** IPv4 arbitrário; usa fc.ipV4() quando disponível, senão monta a.b.c.d. */
const ipV4Arb: fc.Arbitrary<string> =
  typeof (fc as unknown as { ipV4?: () => fc.Arbitrary<string> }).ipV4 === 'function'
    ? (fc as unknown as { ipV4: () => fc.Arbitrary<string> }).ipV4()
    : fc
        .tuple(
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
        )
        .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

const nonEmptyString = fc.string({ minLength: 1, maxLength: 60 });

const dtoArb: fc.Arbitrary<RegistrarAuditoriaDto> = fc.record({
  ator: fc.constantFrom('cidadao', 'servidor', 'sistema') as fc.Arbitrary<
    RegistrarAuditoriaDto['ator']
  >,
  atorCidadaoId: fc.option(fc.uuid(), { nil: undefined }),
  atorServidorId: fc.option(fc.uuid(), { nil: undefined }),
  enderecoIp: ipV4Arb,
  tipoAcao: nonEmptyString,
  modulo: nonEmptyString,
  objetoId: nonEmptyString,
  tipoObjeto: nonEmptyString,
  valorAnterior: fc.option(fc.jsonValue(), { nil: undefined }),
  valorPosterior: fc.option(fc.jsonValue(), { nil: undefined }),
});

describe('Property 6: Completude do Registro de Auditoria', () => {
  // Validates: Requirements 17.3
  it('o registro persistido sempre contém data/hora UTC, ator, IP, tipo de ação e objeto', async () => {
    await fc.assert(
      fc.asyncProperty(dtoArb, async (dto) => {
        const { client, getLastData } = makeMockPrisma();

        await registrarSync(dto, client);

        const data = getLastData();
        expect(data).toBeDefined();
        const record = data as Record<string, unknown>;

        // Data/hora em UTC como instância de Date.
        expect(record.realizadaEmUtc).toBeInstanceOf(Date);

        // Identificação do ator, IP, ação e objeto preservados.
        expect(record.ator).toBe(dto.ator);
        expect(record.enderecoIp).toBe(dto.enderecoIp);
        expect(record.tipoAcao).toBe(dto.tipoAcao);
        expect(record.objetoId).toBe(dto.objetoId);

        // Valores antes/depois: undefined ou string truncada a <= 1000 chars.
        for (const valor of [record.valorAnterior, record.valorPosterior]) {
          if (valor !== undefined) {
            expect(typeof valor).toBe('string');
            expect((valor as string).length).toBeLessThanOrEqual(MAX_VALOR_LENGTH);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Validates: Requirements 17.3
  it('stringifyValor retorna undefined ou uma string de comprimento <= 1000 para qualquer entrada', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const result = stringifyValor(v);
        if (result !== undefined) {
          expect(typeof result).toBe('string');
          expect(result.length).toBeLessThanOrEqual(MAX_VALOR_LENGTH);
        }
      }),
      { numRuns: 200 },
    );
  });
});
