// Feature: auditar-sistema-gestao, Property 13: Edição Corretiva Registra Valores Anterior e Posterior (Req 24.5)
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Stub do barrel de auditoria + env: importar `processos.tramitacao.service.ts`
// puxa `STATUS_ENCERRADOS` de `mensagens.publico.service.js`, que importa o
// barrel de auditoria (o qual carrega `bullmq`/`env` como valores reais). Sem
// os stubs, o mero import dispara conexões/`process.exit`. Mesmo padrão de
// `processos.atribuicao.property.test.ts` / `mensagens.interno.service.test.ts`.
vi.mock('../../../config/env.js', () => ({
  env: { MINIO_BUCKET_PROCESSOS: 'processos' },
}));
vi.mock('../../auditoria/index.js', () => ({
  registrar: vi.fn(),
  registrarSync: vi.fn(),
}));

import {
  editarProcessoCorretivo,
  type TramitacaoDeps,
} from '../processos.tramitacao.service.js';
import type { RegistrarAuditoriaDto } from '../../auditoria/index.js';

/**
 * Property 13 — Edição Corretiva Registra Valores Anterior e Posterior (Req 24.5).
 *
 * *For any* Edição_Corretiva de um campo de um Processo, o registro de auditoria
 * correspondente deve conter o valor anterior igual ao valor do campo
 * imediatamente antes da alteração e o valor posterior igual ao novo valor
 * aplicado.
 *
 * A prova usa um mock do Prisma que fornece o estado atual do Processo (via
 * `findUnique`) e um `$transaction` que executa a callback com um `tx` mock. O
 * `registrarSync` injetado CAPTURA cada DTO de auditoria, permitindo verificar
 * o par (valorAnterior, valorPosterior) por campo alterado.
 *
 * NÃO modificamos a implementação; um contra-exemplo genuíno seria reportado.
 *
 * Validates: Requirements 24.5
 */

const PROCESSO_ID = 'proc-1';
const SERVIDOR_ID = 'srv-1';
const IP = '203.0.113.10';

/** DTO de auditoria com valores anterior/posterior no formato { campo, valor }. */
interface CampoValor {
  campo: string;
  valor: unknown;
}

/**
 * Monta o contexto de dependências: um Prisma mock com o estado inicial do
 * Processo e um `registrarSync` que acumula os DTOs registrados.
 */
function makeCtx(inicial: { prioridade: number; respostas: { id: string; campoId: string; valor: string }[] }) {
  const dtos: RegistrarAuditoriaDto[] = [];

  const processoMock = {
    findUnique: vi.fn().mockResolvedValue({
      id: PROCESSO_ID,
      protocolo: '2024-00042',
      prioridade: inicial.prioridade,
      respostas: inicial.respostas,
    }),
    update: vi.fn().mockResolvedValue({}),
  };
  const respostaMock = { update: vi.fn().mockResolvedValue({}) };

  const txMock = { processo: processoMock, respostaFormulario: respostaMock };
  const transactionMock = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

  const registrarSyncMock = vi.fn(async (dto: RegistrarAuditoriaDto) => {
    dtos.push(dto);
  });

  const deps: Partial<TramitacaoDeps> = {
    prisma: {
      processo: processoMock,
      respostaFormulario: respostaMock,
      $transaction: transactionMock,
    } as unknown as TramitacaoDeps['prisma'],
    notificar: vi.fn(),
    registrarSync: registrarSyncMock,
    registrar: vi.fn(),
  };

  return { deps, dtos };
}

/** campoId arbitrário não-vazio. */
const campoIdArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

describe('Property 13: Edição Corretiva Registra Valores Anterior e Posterior', () => {
  // Validates: Requirements 24.5
  it('para qualquer correção de prioridade, a auditoria registra o valor anterior e o novo valor', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        async (anterior, novo) => {
          // Garante alteração real (diff): só há registro quando muda.
          fc.pre(anterior !== novo);

          const { deps, dtos } = makeCtx({ prioridade: anterior, respostas: [] });

          await editarProcessoCorretivo(PROCESSO_ID, SERVIDOR_ID, IP, { prioridade: novo }, deps);

          expect(dtos).toHaveLength(1);
          const anteriorReg = dtos[0].valorAnterior as CampoValor;
          const posteriorReg = dtos[0].valorPosterior as CampoValor;
          expect(anteriorReg.campo).toBe('prioridade');
          expect(anteriorReg.valor).toBe(anterior);
          expect(posteriorReg.campo).toBe('prioridade');
          expect(posteriorReg.valor).toBe(novo);
        },
      ),
      { numRuns: 150 },
    );
  });

  // Validates: Requirements 24.5
  it('para qualquer correção de resposta do formulário, a auditoria registra anterior e posterior', async () => {
    await fc.assert(
      fc.asyncProperty(
        campoIdArb,
        fc.string({ maxLength: 100 }),
        fc.string({ maxLength: 100 }),
        async (campoId, anterior, novo) => {
          fc.pre(anterior !== novo);

          const { deps, dtos } = makeCtx({
            prioridade: 0,
            respostas: [{ id: 'resp-1', campoId, valor: anterior }],
          });

          await editarProcessoCorretivo(
            PROCESSO_ID,
            SERVIDOR_ID,
            IP,
            { respostas: [{ campoId, valor: novo }] },
            deps,
          );

          expect(dtos).toHaveLength(1);
          const anteriorReg = dtos[0].valorAnterior as CampoValor;
          const posteriorReg = dtos[0].valorPosterior as CampoValor;
          expect(anteriorReg.campo).toBe(`resposta:${campoId}`);
          expect(anteriorReg.valor).toBe(anterior);
          expect(posteriorReg.campo).toBe(`resposta:${campoId}`);
          expect(posteriorReg.valor).toBe(novo);
        },
      ),
      { numRuns: 150 },
    );
  });

  // Validates: Requirements 24.5
  it('edições de múltiplos campos registram um par anterior/posterior por campo alterado', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          prioridadeAnterior: fc.integer({ min: 0, max: 10 }),
          prioridadeNova: fc.integer({ min: 0, max: 10 }),
          campoId: campoIdArb,
          respAnterior: fc.string({ maxLength: 50 }),
          respNova: fc.string({ maxLength: 50 }),
        }),
        async (c) => {
          fc.pre(c.prioridadeAnterior !== c.prioridadeNova);
          fc.pre(c.respAnterior !== c.respNova);

          const { deps, dtos } = makeCtx({
            prioridade: c.prioridadeAnterior,
            respostas: [{ id: 'resp-1', campoId: c.campoId, valor: c.respAnterior }],
          });

          await editarProcessoCorretivo(
            PROCESSO_ID,
            SERVIDOR_ID,
            IP,
            { prioridade: c.prioridadeNova, respostas: [{ campoId: c.campoId, valor: c.respNova }] },
            deps,
          );

          // Um registro por campo alterado (prioridade + resposta).
          expect(dtos).toHaveLength(2);

          const porCampo = new Map(
            dtos.map((d) => [(d.valorAnterior as CampoValor).campo, d]),
          );

          const prio = porCampo.get('prioridade');
          expect(prio).toBeDefined();
          expect((prio!.valorAnterior as CampoValor).valor).toBe(c.prioridadeAnterior);
          expect((prio!.valorPosterior as CampoValor).valor).toBe(c.prioridadeNova);

          const resp = porCampo.get(`resposta:${c.campoId}`);
          expect(resp).toBeDefined();
          expect((resp!.valorAnterior as CampoValor).valor).toBe(c.respAnterior);
          expect((resp!.valorPosterior as CampoValor).valor).toBe(c.respNova);
        },
      ),
      { numRuns: 150 },
    );
  });
});
