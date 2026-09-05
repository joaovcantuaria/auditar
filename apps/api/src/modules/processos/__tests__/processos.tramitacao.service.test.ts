import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes, StatusProcesso, TipoEvento } from '@auditar/shared';

// Stub do barrel de auditoria: importar o serviço sob teste puxa
// `../auditoria/index.js`, que reexporta `auditoria.worker.ts` (o qual importa
// `bullmq` como valor real). O stub evita esse carregamento — mesmo padrão de
// `mensagens.interno.service.test.ts`.
vi.mock('../../auditoria/index.js', () => ({
  registrar: vi.fn(),
  registrarSync: vi.fn(),
}));

import {
  obterDetalheAdmin,
  obterTrilhaAuditoria,
  calcularDocumentosSolicitadosPendentes,
  PREFIXO_DOCS_SOLICITADOS,
  avancarEtapa,
  rejeitar,
  solicitarDocumentos,
  registrarObservacao,
  type TramitacaoDeps,
} from '../processos.tramitacao.service.js';
import { AppError } from '../../../utils/index.js';

/**
 * Testes unitários da Tramitação de Processo pelo Servidor (Task 7.6, Req 11).
 *
 * Todas as dependências (prisma, notificar, registrarSync, registrar) são
 * injetadas via `deps` — nenhum I/O real é exercitado. O `$transaction` mockado
 * invoca a callback com um `tx` mock (mesmo padrão de `processos.service.test.ts`).
 *
 * Requisitos cobertos: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9
 */

const PROCESSO_ID = 'proc-1';
const SERVIDOR_ID = 'srv-1';
const IP = '203.0.113.10';

const processoMock = { findUnique: vi.fn(), update: vi.fn() };
const movimentacaoMock = { findMany: vi.fn(), create: vi.fn() };
const etapaMock = { findMany: vi.fn() };
const auditoriaLogMock = { findMany: vi.fn() };

const notificarMock = vi.fn();
const registrarSyncMock = vi.fn();
const registrarMock = vi.fn();

/** `tx` fornecido à callback do `$transaction` — reusa os mesmos delegates. */
const txMock = {
  processo: processoMock,
  movimentacaoProcesso: movimentacaoMock,
  etapa: etapaMock,
};

const transactionMock = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

function deps(): Partial<TramitacaoDeps> {
  return {
    prisma: {
      processo: processoMock,
      movimentacaoProcesso: movimentacaoMock,
      etapa: etapaMock,
      auditoriaLog: auditoriaLogMock,
      $transaction: transactionMock,
    } as unknown as TramitacaoDeps['prisma'],
    notificar: notificarMock,
    registrarSync: registrarSyncMock,
    registrar: registrarMock,
  };
}

function etapas() {
  return [
    { id: 'etapa-1', nome: 'Triagem', prazosDiasUteis: 3, ordem: 1 },
    { id: 'etapa-2', nome: 'Análise', prazosDiasUteis: 5, ordem: 2 },
    { id: 'etapa-3', nome: 'Decisão', prazosDiasUteis: 2, ordem: 3 },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  notificarMock.mockResolvedValue(undefined);
  registrarSyncMock.mockResolvedValue(undefined);
  registrarMock.mockResolvedValue(undefined);
  transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));
  processoMock.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    protocolo: '2024-00042',
    status: data.status ?? StatusProcesso.EM_ANDAMENTO,
    etapaAtualId: data.etapaAtualId ?? 'etapa-2',
  }));
  movimentacaoMock.create.mockResolvedValue({ id: 'mov-1' });
});

// ---------------------------------------------------------------------------
// obterDetalheAdmin (Req 11.1)
// ---------------------------------------------------------------------------

describe('obterDetalheAdmin', () => {
  it('rejeita com 404 quando o Processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(obterDetalheAdmin(PROCESSO_ID, deps())).rejects.toMatchObject({ statusCode: 404 });
  });

  it('calcula etapa atual, anteriores concluídas, próxima e movimentações', async () => {
    processoMock.findUnique.mockResolvedValue({
      protocolo: '2024-00042',
      status: StatusProcesso.EM_ANDAMENTO,
      prioridade: 0,
      abertoEm: new Date('2024-01-01T00:00:00Z'),
      prazoFinal: new Date('2024-02-01T00:00:00Z'),
      etapaAtualId: 'etapa-2',
      fluxoVersaoId: 'fluxo-1',
      cidadao: { nome: 'João', cpf: '12345678901' },
      tipoProcesso: { nome: 'Alvará', categoria: { nome: 'Obras' } },
      unidade: { nome: 'Secretaria' },
      servidorResponsavel: { nome: 'Ana' },
      // Req 24.1 — respostas do Formulário_Dinâmico (campo aditivo).
      respostas: [
        { campoId: 'campo-1', valor: 'Rua A, 100' },
        { campoId: 'campo-2', valor: 'Comercial' },
      ],
      // Req 24.3 — documentos anexados para cálculo de pendências.
      documentos: [{ nomeOriginal: 'RG.pdf' }],
    });
    etapaMock.findMany.mockResolvedValue(etapas());
    movimentacaoMock.findMany.mockResolvedValue([
      {
        etapaOrigemId: null,
        etapaDestinoId: 'etapa-1',
        observacao: null,
        tipoObservacao: null,
        realizadoEm: new Date('2024-01-02T00:00:00Z'),
        servidor: { nome: 'Ana' },
      },
      {
        etapaOrigemId: 'etapa-1',
        etapaDestinoId: 'etapa-2',
        observacao: 'Nota interna',
        tipoObservacao: 'interna',
        realizadoEm: new Date('2024-01-05T00:00:00Z'),
        servidor: { nome: 'Ana' },
      },
    ]);

    const resultado = await obterDetalheAdmin(PROCESSO_ID, deps());

    expect(resultado.etapaAtual).toEqual({ id: 'etapa-2', nome: 'Análise', prazosDiasUteis: 5 });
    expect(resultado.etapasAnteriores).toEqual([
      { id: 'etapa-1', nome: 'Triagem', concluidaEm: new Date('2024-01-02T00:00:00Z') },
    ]);
    expect(resultado.proximaEtapa).toEqual({ id: 'etapa-3', nome: 'Decisão' });
    // Servidor vê observações internas no histórico administrativo (Req 11.1).
    expect(resultado.movimentacoes).toHaveLength(2);
    expect(resultado.movimentacoes[1].tipoObservacao).toBe('interna');
    // Req 24.1 — respostas do formulário retornadas de forma aditiva.
    expect(resultado.respostas).toEqual([
      { campoId: 'campo-1', valor: 'Rua A, 100' },
      { campoId: 'campo-2', valor: 'Comercial' },
    ]);
    // Req 24.3 — ações pendentes: próxima etapa + docs solicitados não anexados.
    expect(resultado.acoesPendentes.proximaEtapa).toEqual({ id: 'etapa-3', nome: 'Decisão' });
    expect(resultado.acoesPendentes.documentosSolicitadosPendentes).toEqual([]);
  });

  it('lista documentos solicitados ainda não anexados em acoesPendentes (Req 24.3)', async () => {
    processoMock.findUnique.mockResolvedValue({
      protocolo: '2024-00042',
      status: StatusProcesso.AGUARDANDO_DOCS,
      prioridade: 0,
      abertoEm: new Date('2024-01-01T00:00:00Z'),
      prazoFinal: new Date('2024-02-01T00:00:00Z'),
      etapaAtualId: 'etapa-2',
      fluxoVersaoId: 'fluxo-1',
      cidadao: { nome: 'João', cpf: '12345678901' },
      tipoProcesso: { nome: 'Alvará', categoria: { nome: 'Obras' } },
      unidade: { nome: 'Secretaria' },
      servidorResponsavel: { nome: 'Ana' },
      respostas: [],
      documentos: [{ nomeOriginal: 'RG' }],
    });
    etapaMock.findMany.mockResolvedValue(etapas());
    movimentacaoMock.findMany.mockResolvedValue([
      {
        etapaOrigemId: 'etapa-2',
        etapaDestinoId: 'etapa-2',
        observacao: `${PREFIXO_DOCS_SOLICITADOS}RG, Comprovante de residência`,
        tipoObservacao: null,
        realizadoEm: new Date('2024-01-06T00:00:00Z'),
        servidor: { nome: 'Ana' },
      },
    ]);

    const resultado = await obterDetalheAdmin(PROCESSO_ID, deps());

    // RG já foi anexado; apenas o comprovante permanece pendente.
    expect(resultado.acoesPendentes.documentosSolicitadosPendentes).toEqual([
      'Comprovante de residência',
    ]);
  });

  it('retorna proximaEtapa null quando a etapa atual é a última', async () => {
    processoMock.findUnique.mockResolvedValue({
      protocolo: '2024-00042',
      status: StatusProcesso.EM_ANDAMENTO,
      prioridade: 0,
      abertoEm: new Date(),
      prazoFinal: new Date(),
      etapaAtualId: 'etapa-3',
      fluxoVersaoId: 'fluxo-1',
      cidadao: null,
      tipoProcesso: null,
      unidade: null,
      servidorResponsavel: null,
      respostas: [],
      documentos: [],
    });
    etapaMock.findMany.mockResolvedValue(etapas());
    movimentacaoMock.findMany.mockResolvedValue([]);

    const resultado = await obterDetalheAdmin(PROCESSO_ID, deps());

    expect(resultado.proximaEtapa).toBeNull();
    expect(resultado.etapasAnteriores).toHaveLength(2);
    // Sem próxima etapa: acoesPendentes reflete o fim do fluxo (Req 24.3).
    expect(resultado.acoesPendentes.proximaEtapa).toBeNull();
    expect(resultado.acoesPendentes.documentosSolicitadosPendentes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// obterTrilhaAuditoria (Req 24.2)
// ---------------------------------------------------------------------------

describe('obterTrilhaAuditoria', () => {
  it('rejeita com 404 quando o Processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(obterTrilhaAuditoria(PROCESSO_ID, deps())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('unifica MovimentacaoProcesso + AuditoriaLog em ordem cronológica (Req 24.2)', async () => {
    processoMock.findUnique.mockResolvedValue({ id: PROCESSO_ID });
    movimentacaoMock.findMany.mockResolvedValue([
      {
        etapaOrigemId: 'etapa-1',
        etapaDestinoId: 'etapa-2',
        observacao: null,
        tipoObservacao: null,
        realizadoEm: new Date('2024-01-05T00:00:00Z'),
        servidor: { nome: 'Ana' },
      },
    ]);
    auditoriaLogMock.findMany.mockResolvedValue([
      {
        tipoAcao: 'editar_processo',
        valorAnterior: '{"campo":"prioridade","valor":0}',
        valorPosterior: '{"campo":"prioridade","valor":1}',
        realizadaEmUtc: new Date('2024-01-03T00:00:00Z'),
        atorServidorId: 'srv-9',
        atorCidadaoId: null,
        ator: 'servidor',
      },
    ]);

    const trilha = await obterTrilhaAuditoria(PROCESSO_ID, deps());

    // Ordenação cronológica crescente: auditoria (03/01) antes da movimentação (05/01).
    expect(trilha).toHaveLength(2);
    expect(trilha[0]).toMatchObject({
      origem: 'auditoria',
      autor: 'srv-9',
      acao: 'editar_processo',
      valorAnterior: '{"campo":"prioridade","valor":0}',
      valorPosterior: '{"campo":"prioridade","valor":1}',
      data: new Date('2024-01-03T00:00:00Z'),
    });
    expect(trilha[1]).toMatchObject({
      origem: 'movimentacao',
      autor: 'Ana',
      acao: 'Etapa avançada',
      valorAnterior: 'etapa-1',
      valorPosterior: 'etapa-2',
      data: new Date('2024-01-05T00:00:00Z'),
    });
  });

  it('retorna trilha vazia quando não há movimentações nem registros', async () => {
    processoMock.findUnique.mockResolvedValue({ id: PROCESSO_ID });
    movimentacaoMock.findMany.mockResolvedValue([]);
    auditoriaLogMock.findMany.mockResolvedValue([]);

    const trilha = await obterTrilhaAuditoria(PROCESSO_ID, deps());

    expect(trilha).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calcularDocumentosSolicitadosPendentes (Req 24.3 — diferença de conjuntos)
// ---------------------------------------------------------------------------

describe('calcularDocumentosSolicitadosPendentes', () => {
  it('retorna solicitados menos anexados (case-insensitive)', () => {
    const movimentacoes = [
      { observacao: `${PREFIXO_DOCS_SOLICITADOS}RG, CPF, Comprovante` },
      { observacao: 'observação qualquer' },
    ];
    const pendentes = calcularDocumentosSolicitadosPendentes(movimentacoes, ['rg', 'CPF']);
    expect(pendentes).toEqual(['Comprovante']);
  });

  it('não duplica documentos solicitados em movimentações repetidas', () => {
    const movimentacoes = [
      { observacao: `${PREFIXO_DOCS_SOLICITADOS}RG` },
      { observacao: `${PREFIXO_DOCS_SOLICITADOS}RG, CPF` },
    ];
    expect(calcularDocumentosSolicitadosPendentes(movimentacoes, [])).toEqual(['RG', 'CPF']);
  });

  it('retorna lista vazia quando todos os solicitados foram anexados', () => {
    const movimentacoes = [{ observacao: `${PREFIXO_DOCS_SOLICITADOS}RG, CPF` }];
    expect(calcularDocumentosSolicitadosPendentes(movimentacoes, ['RG', 'CPF'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// avancarEtapa (Req 11.2, 11.3, 11.7, 11.9)
// ---------------------------------------------------------------------------

describe('avancarEtapa', () => {
  function processoAtivo(overrides: Record<string, unknown> = {}) {
    return {
      etapaAtualId: 'etapa-1',
      fluxoVersaoId: 'fluxo-1',
      cidadaoId: 'cid-1',
      status: StatusProcesso.EM_ANDAMENTO,
      ...overrides,
    };
  }

  it('rejeita com 404 quando o Processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(
      avancarEtapa(PROCESSO_ID, SERVIDOR_ID, IP, true, undefined, deps()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it.each([StatusProcesso.FINALIZADO, StatusProcesso.REJEITADO, StatusProcesso.APROVADO])(
    'rejeita com 400 PROCESSO_ENCERRADO quando o status é %s',
    async (status) => {
      processoMock.findUnique.mockResolvedValue(processoAtivo({ status }));

      await expect(
        avancarEtapa(PROCESSO_ID, SERVIDOR_ID, IP, true, undefined, deps()),
      ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.PROCESSO_ENCERRADO });
    },
  );

  it('avança para a próxima etapa e notifica o cidadão (Req 11.2)', async () => {
    processoMock.findUnique.mockResolvedValue(processoAtivo({ etapaAtualId: 'etapa-1' }));
    etapaMock.findMany.mockResolvedValue(etapas());

    const resultado = await avancarEtapa(PROCESSO_ID, SERVIDOR_ID, IP, false, 'ok', deps());

    expect(processoMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { etapaAtualId: 'etapa-2', status: StatusProcesso.EM_ANDAMENTO },
      }),
    );
    expect(movimentacaoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          etapaOrigemId: 'etapa-1',
          etapaDestinoId: 'etapa-2',
          servidorId: SERVIDOR_ID,
          observacao: 'ok',
          tipoObservacao: null,
        }),
      }),
    );
    expect(registrarSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'avancar_etapa' }),
      txMock,
    );
    expect(resultado.status).toBe(StatusProcesso.EM_ANDAMENTO);

    await Promise.resolve();
    expect(notificarMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoEvento: TipoEvento.MOVIMENTACAO_ETAPA, conteudo: 'Análise' }),
    );
  });

  it('finaliza (aprova) na última etapa quando podeAprovar é true (Req 11.2)', async () => {
    processoMock.findUnique.mockResolvedValue(processoAtivo({ etapaAtualId: 'etapa-3' }));
    etapaMock.findMany.mockResolvedValue(etapas());

    const resultado = await avancarEtapa(PROCESSO_ID, SERVIDOR_ID, IP, true, undefined, deps());

    expect(processoMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: StatusProcesso.APROVADO }),
      }),
    );
    expect(movimentacaoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ etapaOrigemId: 'etapa-3', etapaDestinoId: null }),
      }),
    );
    expect(registrarSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'aprovar_processo' }),
      txMock,
    );
    expect(resultado.status).toBe(StatusProcesso.APROVADO);
  });

  it('bloqueia a finalização com 403 quando podeAprovar é false (Req 11.7)', async () => {
    processoMock.findUnique.mockResolvedValue(processoAtivo({ etapaAtualId: 'etapa-3' }));
    etapaMock.findMany.mockResolvedValue(etapas());

    await expect(
      avancarEtapa(PROCESSO_ID, SERVIDOR_ID, IP, false, undefined, deps()),
    ).rejects.toMatchObject({ statusCode: 403, code: ErrorCodes.INSUFFICIENT_PERMISSIONS });

    expect(processoMock.update).not.toHaveBeenCalled();
    expect(registrarSyncMock).not.toHaveBeenCalled();
  });

  it('reverte e lança 500 AUDITORIA_FALHA quando registrarSync falha (Req 11.9)', async () => {
    processoMock.findUnique.mockResolvedValue(processoAtivo({ etapaAtualId: 'etapa-1' }));
    etapaMock.findMany.mockResolvedValue(etapas());
    registrarSyncMock.mockRejectedValue(new Error('db down'));
    // $transaction propaga a rejeição da callback (rollback automático).
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    const promessa = avancarEtapa(PROCESSO_ID, SERVIDOR_ID, IP, false, undefined, deps());

    await expect(promessa).rejects.toBeInstanceOf(AppError);
    await expect(promessa).rejects.toMatchObject({
      statusCode: 500,
      code: ErrorCodes.AUDITORIA_FALHA,
    });
    // Notificação nunca é disparada quando a auditoria falha.
    expect(notificarMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rejeitar (Req 11.7, 11.9)
// ---------------------------------------------------------------------------

describe('rejeitar', () => {
  function processoAtivo(overrides: Record<string, unknown> = {}) {
    return {
      etapaAtualId: 'etapa-2',
      cidadaoId: 'cid-1',
      status: StatusProcesso.EM_ANDAMENTO,
      ...overrides,
    };
  }

  it('rejeita o processo, cria a movimentação e notifica o cidadão', async () => {
    processoMock.findUnique.mockResolvedValue(processoAtivo());

    const resultado = await rejeitar(PROCESSO_ID, SERVIDOR_ID, IP, 'Documentação incompleta', deps());

    expect(processoMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: StatusProcesso.REJEITADO }),
      }),
    );
    expect(movimentacaoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          etapaOrigemId: 'etapa-2',
          etapaDestinoId: null,
          observacao: 'Documentação incompleta',
        }),
      }),
    );
    expect(registrarSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'rejeitar_processo' }),
      txMock,
    );
    expect(resultado.status).toBe(StatusProcesso.REJEITADO);

    await Promise.resolve();
    expect(notificarMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoEvento: TipoEvento.REJEICAO }),
    );
  });

  it('rejeita com 400 PROCESSO_ENCERRADO quando já encerrado', async () => {
    processoMock.findUnique.mockResolvedValue(processoAtivo({ status: StatusProcesso.APROVADO }));

    await expect(
      rejeitar(PROCESSO_ID, SERVIDOR_ID, IP, 'motivo', deps()),
    ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.PROCESSO_ENCERRADO });
  });

  it('reverte e lança 500 AUDITORIA_FALHA quando registrarSync falha (Req 11.9)', async () => {
    processoMock.findUnique.mockResolvedValue(processoAtivo());
    registrarSyncMock.mockRejectedValue(new Error('db down'));

    await expect(
      rejeitar(PROCESSO_ID, SERVIDOR_ID, IP, 'motivo', deps()),
    ).rejects.toMatchObject({ statusCode: 500, code: ErrorCodes.AUDITORIA_FALHA });
    expect(notificarMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// solicitarDocumentos (Req 11.6)
// ---------------------------------------------------------------------------

describe('solicitarDocumentos', () => {
  function processoAtivo(overrides: Record<string, unknown> = {}) {
    return {
      etapaAtualId: 'etapa-2',
      cidadaoId: 'cid-1',
      status: StatusProcesso.EM_ANDAMENTO,
      ...overrides,
    };
  }

  it('altera status para aguardando_docs e notifica com a lista', async () => {
    processoMock.findUnique.mockResolvedValue(processoAtivo());

    const resultado = await solicitarDocumentos(
      PROCESSO_ID,
      SERVIDOR_ID,
      IP,
      ['RG', 'Comprovante de residência'],
      deps(),
    );

    expect(processoMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: StatusProcesso.AGUARDANDO_DOCS },
      }),
    );
    expect(movimentacaoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          observacao: 'Documentos solicitados: RG, Comprovante de residência',
        }),
      }),
    );
    expect(registrarSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'solicitar_documentos' }),
      txMock,
    );
    expect(resultado.status).toBe(StatusProcesso.AGUARDANDO_DOCS);

    await Promise.resolve();
    expect(notificarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoEvento: TipoEvento.SOLICITACAO_DOCUMENTOS,
        conteudo: 'RG, Comprovante de residência',
      }),
    );
  });

  it('rejeita com 400 PROCESSO_ENCERRADO quando já encerrado', async () => {
    processoMock.findUnique.mockResolvedValue(processoAtivo({ status: StatusProcesso.REJEITADO }));

    await expect(
      solicitarDocumentos(PROCESSO_ID, SERVIDOR_ID, IP, ['RG'], deps()),
    ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.PROCESSO_ENCERRADO });
  });
});

// ---------------------------------------------------------------------------
// registrarObservacao (Req 11.4, 11.5)
// ---------------------------------------------------------------------------

describe('registrarObservacao', () => {
  beforeEach(() => {
    movimentacaoMock.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'mov-obs',
        processoId: PROCESSO_ID,
        observacao: data.observacao,
        tipoObservacao: data.tipoObservacao,
        realizadoEm: new Date('2024-06-01T00:00:00Z'),
      }),
    );
  });

  it('rejeita com 404 quando o Processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(
      registrarObservacao(PROCESSO_ID, SERVIDOR_ID, IP, 'interna', 'nota', deps()),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(movimentacaoMock.create).not.toHaveBeenCalled();
  });

  it('persiste observação interna com tipoObservacao=interna (Req 11.4)', async () => {
    processoMock.findUnique.mockResolvedValue({ id: PROCESSO_ID });

    const resultado = await registrarObservacao(
      PROCESSO_ID,
      SERVIDOR_ID,
      IP,
      'interna',
      'Observação restrita',
      deps(),
    );

    expect(movimentacaoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          etapaOrigemId: null,
          etapaDestinoId: null,
          observacao: 'Observação restrita',
          tipoObservacao: 'interna',
        }),
      }),
    );
    expect(registrarMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'registrar_observacao_interna' }),
    );
    expect(resultado.tipoObservacao).toBe('interna');
    // Observações não disparam notificação.
    expect(notificarMock).not.toHaveBeenCalled();
  });

  it('persiste observação pública com tipoObservacao=publica (Req 11.5)', async () => {
    processoMock.findUnique.mockResolvedValue({ id: PROCESSO_ID });

    const resultado = await registrarObservacao(
      PROCESSO_ID,
      SERVIDOR_ID,
      IP,
      'publica',
      'Observação visível ao cidadão',
      deps(),
    );

    expect(movimentacaoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipoObservacao: 'publica' }),
      }),
    );
    expect(registrarMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'registrar_observacao_publica' }),
    );
    expect(resultado.tipoObservacao).toBe('publica');
  });
});
