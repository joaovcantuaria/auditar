import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes, ModoAtribuicao, StatusProcesso, TipoEvento } from '@auditar/shared';

// Stub do barrel de auditoria: evita carregar `auditoria.worker.ts` (que
// importa `bullmq` como valor real) apenas por importar o serviço sob teste
// — mesmo padrão de `mensagens.interno.service.test.ts`.
vi.mock('../../../config/env.js', () => ({
  env: { MINIO_BUCKET_PROCESSOS: 'processos' },
}));
vi.mock('../../auditoria/index.js', () => ({ registrar: vi.fn() }));

import {
  selecionarServidorMenorCarga,
  atribuir,
  reatribuir,
  listarCargasDisponiveis,
  atribuirAutomaticamente,
  type CargaServidor,
  type AtribuicaoDeps,
} from '../processos.atribuicao.service.js';

/**
 * Testes unitários da Atribuição/Reatribuição de Processos (Task 7.7, Req 12).
 *
 * Todas as dependências (prisma, notificar, auditar) são injetadas
 * explicitamente via `deps` — nenhum I/O real é exercitado. O serviço só toca
 * `config/database.js`/`jobs/queues.js` de forma preguiçosa (apenas quando
 * `deps` está ausente), então não é necessário mockar esses módulos aqui.
 *
 * Requisitos cobertos: 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8, 12.9, 12.10
 */

const processoMock = {
  findUnique: vi.fn(),
  update: vi.fn(),
};

const servidorMock = {
  findUnique: vi.fn(),
  findMany: vi.fn(),
};

const unidadeMock = {
  findUnique: vi.fn(),
};

const notificarMock = vi.fn();
const auditarMock = vi.fn();

function deps(): Partial<AtribuicaoDeps> {
  return {
    prisma: {
      processo: processoMock,
      servidor: servidorMock,
      unidade: unidadeMock,
    } as unknown as AtribuicaoDeps['prisma'],
    notificar: notificarMock,
    auditar: auditarMock,
  };
}

function makeProcesso(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proc-1',
    status: StatusProcesso.EM_ANDAMENTO,
    unidadeId: 'uni-1',
    protocolo: '2024-00042',
    servidorResponsavelId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notificarMock.mockResolvedValue(undefined);
  auditarMock.mockResolvedValue(undefined);
  processoMock.update.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// selecionarServidorMenorCarga (Req 12.2) — função pura
// ---------------------------------------------------------------------------

describe('selecionarServidorMenorCarga', () => {
  it('retorna null quando a lista está vazia', () => {
    expect(selecionarServidorMenorCarga([])).toBeNull();
  });

  it('seleciona o Servidor com o menor número de processos ativos', () => {
    const servidores: CargaServidor[] = [
      { servidorId: 'a', processosAtivos: 5, ultimaAtribuicaoEm: new Date('2024-01-01') },
      { servidorId: 'b', processosAtivos: 2, ultimaAtribuicaoEm: new Date('2024-01-01') },
      { servidorId: 'c', processosAtivos: 8, ultimaAtribuicaoEm: new Date('2024-01-01') },
    ];
    expect(selecionarServidorMenorCarga(servidores)?.servidorId).toBe('b');
  });

  it('desempata pela última atribuição mais antiga (menor timestamp)', () => {
    const servidores: CargaServidor[] = [
      { servidorId: 'a', processosAtivos: 3, ultimaAtribuicaoEm: new Date('2024-06-10') },
      { servidorId: 'b', processosAtivos: 3, ultimaAtribuicaoEm: new Date('2024-01-05') },
      { servidorId: 'c', processosAtivos: 3, ultimaAtribuicaoEm: new Date('2024-03-20') },
    ];
    expect(selecionarServidorMenorCarga(servidores)?.servidorId).toBe('b');
  });

  it('trata ultimaAtribuicaoEm null como o mais antigo (maior prioridade) no desempate', () => {
    const servidores: CargaServidor[] = [
      { servidorId: 'a', processosAtivos: 1, ultimaAtribuicaoEm: new Date('2024-01-01') },
      { servidorId: 'b', processosAtivos: 1, ultimaAtribuicaoEm: null },
    ];
    expect(selecionarServidorMenorCarga(servidores)?.servidorId).toBe('b');
  });

  it('a menor carga prevalece mesmo com última atribuição mais recente', () => {
    const servidores: CargaServidor[] = [
      { servidorId: 'a', processosAtivos: 1, ultimaAtribuicaoEm: new Date('2024-12-31') },
      { servidorId: 'b', processosAtivos: 4, ultimaAtribuicaoEm: null },
    ];
    expect(selecionarServidorMenorCarga(servidores)?.servidorId).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// atribuir — modo manual (Req 12.1)
// ---------------------------------------------------------------------------

describe('atribuir (manual)', () => {
  it('atribui ao servidor válido da unidade e registra auditoria + notifica', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());
    servidorMock.findUnique.mockResolvedValue({ ativo: true, unidadeId: 'uni-1' });

    const resultado = await atribuir(
      'proc-1',
      { modo: ModoAtribuicao.MANUAL, servidorId: 'srv-9' },
      'ator-1',
      '203.0.113.10',
      deps(),
    );

    expect(processoMock.update).toHaveBeenCalledWith({
      where: { id: 'proc-1' },
      data: { servidorResponsavelId: 'srv-9' },
    });
    expect(resultado).toMatchObject({ servidorId: 'srv-9', modo: ModoAtribuicao.MANUAL, filaGeral: false });

    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAcao: 'atribuir_processo',
        objetoId: 'proc-1',
        valorPosterior: { servidorId: 'srv-9', modo: ModoAtribuicao.MANUAL },
      }),
    );

    await Promise.resolve();
    expect(notificarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'painel',
        destinatario: { servidorId: 'srv-9' },
        tipoEvento: TipoEvento.ATRIBUICAO,
        processoId: 'proc-1',
      }),
    );
  });

  it('rejeita quando o servidor não pertence à unidade do processo (Req 12.1)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());
    servidorMock.findUnique.mockResolvedValue({ ativo: true, unidadeId: 'outra-uni' });

    await expect(
      atribuir('proc-1', { modo: ModoAtribuicao.MANUAL, servidorId: 'srv-9' }, 'ator-1', 'ip', deps()),
    ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.VALIDATION_ERROR });

    expect(processoMock.update).not.toHaveBeenCalled();
  });

  it('rejeita quando o servidor está inativo', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());
    servidorMock.findUnique.mockResolvedValue({ ativo: false, unidadeId: 'uni-1' });

    await expect(
      atribuir('proc-1', { modo: ModoAtribuicao.MANUAL, servidorId: 'srv-9' }, 'ator-1', 'ip', deps()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(processoMock.update).not.toHaveBeenCalled();
  });

  it('rejeita quando o servidor não existe', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());
    servidorMock.findUnique.mockResolvedValue(null);

    await expect(
      atribuir('proc-1', { modo: ModoAtribuicao.MANUAL, servidorId: 'srv-x' }, 'ator-1', 'ip', deps()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(processoMock.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// atribuir — processo inexistente / encerrado
// ---------------------------------------------------------------------------

describe('atribuir (validação de processo)', () => {
  it('rejeita com 404 quando o processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(
      atribuir('proc-x', { modo: ModoAtribuicao.FILA_GERAL }, 'ator-1', 'ip', deps()),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(processoMock.update).not.toHaveBeenCalled();
  });

  it.each([StatusProcesso.FINALIZADO, StatusProcesso.REJEITADO, StatusProcesso.APROVADO])(
    'bloqueia quando o processo está encerrado (%s)',
    async (status) => {
      processoMock.findUnique.mockResolvedValue(makeProcesso({ status }));

      await expect(
        atribuir('proc-1', { modo: ModoAtribuicao.FILA_GERAL }, 'ator-1', 'ip', deps()),
      ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.PROCESSO_ENCERRADO });
      expect(processoMock.update).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// atribuir — modo automatico (Req 12.2, 12.3)
// ---------------------------------------------------------------------------

describe('atribuir (automatico)', () => {
  it('seleciona o servidor de menor carga e o atribui', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());
    servidorMock.findMany.mockResolvedValue([
      { id: 'srv-1', processos: [{ abertoEm: new Date('2024-01-01') }, { abertoEm: new Date('2024-02-01') }] },
      { id: 'srv-2', processos: [{ abertoEm: new Date('2024-03-01') }] },
    ]);

    const resultado = await atribuir(
      'proc-1',
      { modo: ModoAtribuicao.AUTOMATICO },
      'ator-1',
      'ip',
      deps(),
    );

    expect(resultado).toMatchObject({ servidorId: 'srv-2', filaGeral: false });
    expect(processoMock.update).toHaveBeenCalledWith({
      where: { id: 'proc-1' },
      data: { servidorResponsavelId: 'srv-2' },
    });
  });

  it('move para Fila_Geral e audita quando nenhum servidor está disponível (Req 12.3)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());
    servidorMock.findMany.mockResolvedValue([]);

    const resultado = await atribuir(
      'proc-1',
      { modo: ModoAtribuicao.AUTOMATICO },
      'ator-1',
      'ip',
      deps(),
    );

    expect(resultado).toMatchObject({ servidorId: null, filaGeral: true });
    expect(processoMock.update).toHaveBeenCalledWith({
      where: { id: 'proc-1' },
      data: { servidorResponsavelId: null },
    });
    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAcao: 'atribuir_processo_fila_geral',
        objetoId: 'proc-1',
      }),
    );
    await Promise.resolve();
    expect(notificarMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// atribuir — modo fila_geral (Req 12.5)
// ---------------------------------------------------------------------------

describe('atribuir (fila_geral)', () => {
  it('deixa o processo sem servidor responsável e não notifica ninguém', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());

    const resultado = await atribuir(
      'proc-1',
      { modo: ModoAtribuicao.FILA_GERAL },
      'ator-1',
      'ip',
      deps(),
    );

    expect(resultado).toMatchObject({ servidorId: null, modo: ModoAtribuicao.FILA_GERAL, filaGeral: true });
    expect(processoMock.update).toHaveBeenCalledWith({
      where: { id: 'proc-1' },
      data: { servidorResponsavelId: null },
    });
    await Promise.resolve();
    expect(notificarMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listarCargasDisponiveis (Req 12.4)
// ---------------------------------------------------------------------------

describe('listarCargasDisponiveis', () => {
  it('retorna cada servidor ativo da unidade com sua contagem de processos ativos', async () => {
    processoMock.findUnique.mockResolvedValue({ unidadeId: 'uni-1' });
    servidorMock.findMany.mockResolvedValue([
      { id: 'srv-1', nome: 'Ana', processos: [{ id: 'p1' }, { id: 'p2' }] },
      { id: 'srv-2', nome: 'Bruno', processos: [] },
    ]);

    const resultado = await listarCargasDisponiveis('proc-1', deps());

    expect(resultado).toEqual([
      { servidorId: 'srv-1', nome: 'Ana', processosAtivos: 2 },
      { servidorId: 'srv-2', nome: 'Bruno', processosAtivos: 0 },
    ]);
  });

  it('rejeita com 404 quando o processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);
    await expect(listarCargasDisponiveis('proc-x', deps())).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// reatribuir (Req 12.8, 12.9, 12.10)
// ---------------------------------------------------------------------------

describe('reatribuir', () => {
  it('reatribui e audita origem + destino + justificativa (Req 12.10)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso({ servidorResponsavelId: 'srv-origem' }));
    servidorMock.findUnique.mockResolvedValue({ ativo: true, unidadeId: 'uni-1' });

    const justificativa = 'Servidor de origem entrou em férias prolongadas';
    const resultado = await reatribuir(
      'proc-1',
      { servidorDestinoId: 'srv-destino', justificativa },
      'ator-1',
      'ip',
      deps(),
    );

    expect(processoMock.update).toHaveBeenCalledWith({
      where: { id: 'proc-1' },
      data: { servidorResponsavelId: 'srv-destino' },
    });
    expect(resultado).toMatchObject({ servidorId: 'srv-destino' });
    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAcao: 'reatribuir_processo',
        valorAnterior: { servidorId: 'srv-origem' },
        valorPosterior: { servidorId: 'srv-destino', justificativa },
      }),
    );

    await Promise.resolve();
    expect(notificarMock).toHaveBeenCalledWith(
      expect.objectContaining({ destinatario: { servidorId: 'srv-destino' } }),
    );
  });

  it('rejeita quando o servidor de destino não pertence à unidade', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso({ servidorResponsavelId: 'srv-origem' }));
    servidorMock.findUnique.mockResolvedValue({ ativo: true, unidadeId: 'outra' });

    await expect(
      reatribuir(
        'proc-1',
        { servidorDestinoId: 'srv-destino', justificativa: 'x'.repeat(25) },
        'ator-1',
        'ip',
        deps(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(processoMock.update).not.toHaveBeenCalled();
  });

  it('bloqueia quando o processo está encerrado', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso({ status: StatusProcesso.APROVADO }));

    await expect(
      reatribuir(
        'proc-1',
        { servidorDestinoId: 'srv-destino', justificativa: 'x'.repeat(25) },
        'ator-1',
        'ip',
        deps(),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.PROCESSO_ENCERRADO });
    expect(processoMock.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Validação de justificativa via schema — Req 12.9 (rejeição sem alterar estado)
// ---------------------------------------------------------------------------

describe('reatribuir — justificativa (Req 12.9, validada no schema)', () => {
  it('rejeita justificativa com menos de 20 caracteres sem alterar o estado', async () => {
    const { reatribuirSchema } = await import('../processos.atribuicao.schema.js');
    const parsed = reatribuirSchema.safeParse({
      servidorDestinoId: 'srv-destino',
      justificativa: 'curta',
    });
    expect(parsed.success).toBe(false);
    // Nenhuma interação com o serviço/prisma quando a validação falha no controller.
    expect(processoMock.update).not.toHaveBeenCalled();
  });

  it('rejeita justificativa com mais de 500 caracteres', async () => {
    const { reatribuirSchema } = await import('../processos.atribuicao.schema.js');
    const parsed = reatribuirSchema.safeParse({
      servidorDestinoId: 'srv-destino',
      justificativa: 'x'.repeat(501),
    });
    expect(parsed.success).toBe(false);
  });

  it('aceita justificativa no intervalo 20–500', async () => {
    const { reatribuirSchema } = await import('../processos.atribuicao.schema.js');
    const parsed = reatribuirSchema.safeParse({
      servidorDestinoId: 'srv-destino',
      justificativa: 'x'.repeat(20),
    });
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// atribuirAutomaticamente — respeita modoAtribuicao da Unidade (worker path)
// ---------------------------------------------------------------------------

describe('atribuirAutomaticamente', () => {
  it('não faz nada quando a unidade não está em modo AUTOMATICO', async () => {
    unidadeMock.findUnique.mockResolvedValue({ modoAtribuicao: ModoAtribuicao.MANUAL });

    const resultado = await atribuirAutomaticamente('proc-1', 'uni-1', deps());

    expect(resultado).toBeNull();
    expect(processoMock.findUnique).not.toHaveBeenCalled();
    expect(processoMock.update).not.toHaveBeenCalled();
  });

  it('atribui ao menor carga quando a unidade está em modo AUTOMATICO', async () => {
    unidadeMock.findUnique.mockResolvedValue({ modoAtribuicao: ModoAtribuicao.AUTOMATICO });
    processoMock.findUnique.mockResolvedValue(makeProcesso());
    servidorMock.findMany.mockResolvedValue([
      { id: 'srv-1', processos: [{ abertoEm: new Date('2024-01-01') }] },
      { id: 'srv-2', processos: [] },
    ]);

    const resultado = await atribuirAutomaticamente('proc-1', 'uni-1', deps());

    expect(resultado).toMatchObject({ servidorId: 'srv-2', filaGeral: false });
  });

  it('não faz nada quando o processo já está encerrado', async () => {
    unidadeMock.findUnique.mockResolvedValue({ modoAtribuicao: ModoAtribuicao.AUTOMATICO });
    processoMock.findUnique.mockResolvedValue(makeProcesso({ status: StatusProcesso.APROVADO }));

    const resultado = await atribuirAutomaticamente('proc-1', 'uni-1', deps());

    expect(resultado).toBeNull();
    expect(processoMock.update).not.toHaveBeenCalled();
  });
});
