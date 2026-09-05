import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  obterDetalhe,
  obterHistorico,
  obterMensagens,
  type ProcessosDetalheDeps,
} from '../processos.detalhe.service.js';
import { AppError } from '../../../utils/index.js';

/**
 * Testes unitários da Consulta e Acompanhamento de Processo pelo Cidadão
 * (Task 7.3). O Prisma é injetado via `deps` — nenhum I/O real é exercitado.
 *
 * Referências: Req 5.1, 5.2, 5.3, 5.4, 5.5, 5.10
 */

const CIDADAO_DONO = 'cid-1';
const CIDADAO_INTRUSO = 'cid-2';
const PROCESSO_ID = 'proc-1';

const processoMock = { findUnique: vi.fn() };
const movimentacaoMock = { findMany: vi.fn() };
const mensagemMock = { findMany: vi.fn() };

function deps(): Partial<ProcessosDetalheDeps> {
  return {
    prisma: {
      processo: processoMock,
      movimentacaoProcesso: movimentacaoMock,
      mensagem: mensagemMock,
    } as unknown as ProcessosDetalheDeps['prisma'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// obterDetalhe (Req 5.1, 5.2, 5.10)
// ---------------------------------------------------------------------------

describe('obterDetalhe', () => {
  function processoDetalheRow(overrides: Record<string, unknown> = {}) {
    return {
      protocolo: '2024-00042',
      status: 'em_andamento',
      abertoEm: new Date('2024-01-10T12:00:00Z'),
      prazoFinal: new Date('2024-02-10T12:00:00Z'),
      cidadaoId: CIDADAO_DONO,
      tipoProcesso: { nome: 'Alvará de Construção', categoria: { nome: 'Obras' } },
      unidade: { nome: 'Secretaria de Obras' },
      etapaAtual: { nome: 'Análise Documental' },
      respostas: [{ campoId: 'campo-1', valor: 'João da Silva' }],
      ...overrides,
    };
  }

  it('retorna o detalhe completo para o cidadão dono do processo', async () => {
    processoMock.findUnique.mockResolvedValue(processoDetalheRow());

    const resultado = await obterDetalhe(PROCESSO_ID, CIDADAO_DONO, deps());

    expect(resultado).toEqual({
      protocolo: '2024-00042',
      categoria: 'Obras',
      tipoProcesso: 'Alvará de Construção',
      unidade: 'Secretaria de Obras',
      abertoEm: new Date('2024-01-10T12:00:00Z'),
      prazoFinal: new Date('2024-02-10T12:00:00Z'),
      status: 'em_andamento',
      etapaAtual: 'Análise Documental',
      respostas: [{ campoId: 'campo-1', valor: 'João da Silva' }],
    });
  });

  it('lança 404 (não 403) quando o processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    const promessa = obterDetalhe('proc-inexistente', CIDADAO_DONO, deps());

    await expect(promessa).rejects.toBeInstanceOf(AppError);
    await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lança 404 (não 403) quando o processo pertence a outro cidadão', async () => {
    processoMock.findUnique.mockResolvedValue(processoDetalheRow({ cidadaoId: CIDADAO_DONO }));

    const promessa = obterDetalhe(PROCESSO_ID, CIDADAO_INTRUSO, deps());

    await expect(promessa).rejects.toBeInstanceOf(AppError);
    await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// obterHistorico (Req 5.3, 5.10)
// ---------------------------------------------------------------------------

describe('obterHistorico', () => {
  it('retorna movimentações ordenadas crescente com o nome do responsável', async () => {
    processoMock.findUnique.mockResolvedValue({ cidadaoId: CIDADAO_DONO });
    movimentacaoMock.findMany.mockResolvedValue([
      {
        etapaOrigemId: null,
        etapaDestinoId: 'etapa-1',
        observacao: null,
        realizadoEm: new Date('2024-01-10T12:00:00Z'),
        servidor: { nome: 'Ana Servidora' },
      },
      {
        etapaOrigemId: 'etapa-1',
        etapaDestinoId: 'etapa-2',
        observacao: 'Documentação conferida',
        realizadoEm: new Date('2024-01-15T09:30:00Z'),
        servidor: { nome: 'Bruno Analista' },
      },
    ]);

    const resultado = await obterHistorico(PROCESSO_ID, CIDADAO_DONO, deps());

    expect(movimentacaoMock.findMany).toHaveBeenCalledWith({
      // Filtro adicionado pela tarefa 7.6: observações internas nunca chegam
      // ao histórico do Cidadão (Req 11.4).
      where: { processoId: PROCESSO_ID, tipoObservacao: { not: 'interna' } },
      orderBy: { realizadoEm: 'asc' },
      select: {
        etapaOrigemId: true,
        etapaDestinoId: true,
        observacao: true,
        realizadoEm: true,
        servidor: { select: { nome: true } },
      },
    });

    expect(resultado).toHaveLength(2);
    expect(resultado[0].responsavel).toBe('Ana Servidora');
    expect(resultado[0].data).toEqual(new Date('2024-01-10T12:00:00Z'));
    expect(resultado[1].responsavel).toBe('Bruno Analista');
    expect(resultado[1].observacao).toBe('Documentação conferida');
    // ordem crescente preservada (o item mais antigo vem primeiro)
    expect(resultado[0].data.getTime()).toBeLessThan(resultado[1].data.getTime());
  });

  it('exclui observações internas do histórico do cidadão (Req 11.4)', async () => {
    processoMock.findUnique.mockResolvedValue({ cidadaoId: CIDADAO_DONO });
    // O serviço delega o filtro ao Prisma; simulamos aqui o retorno já filtrado
    // (sem a linha interna) e asseguramos que a query pediu esse filtro.
    movimentacaoMock.findMany.mockResolvedValue([
      {
        etapaOrigemId: 'etapa-1',
        etapaDestinoId: 'etapa-2',
        observacao: 'Observação pública',
        realizadoEm: new Date('2024-01-10T12:00:00Z'),
        servidor: { nome: 'Ana Servidora' },
      },
      {
        etapaOrigemId: null,
        etapaDestinoId: null,
        observacao: 'Transição registrada',
        realizadoEm: new Date('2024-01-11T12:00:00Z'),
        servidor: { nome: 'Ana Servidora' },
      },
    ]);

    const resultado = await obterHistorico(PROCESSO_ID, CIDADAO_DONO, deps());

    expect(movimentacaoMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { processoId: PROCESSO_ID, tipoObservacao: { not: 'interna' } },
      }),
    );
    // Nenhuma observação interna deve constar no resultado exposto ao cidadão.
    expect(resultado).toHaveLength(2);
    expect(resultado.some((h) => h.observacao === 'Observação pública')).toBe(true);
  });

  it('lança 404 quando o processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(obterHistorico('proc-inexistente', CIDADAO_DONO, deps())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(movimentacaoMock.findMany).not.toHaveBeenCalled();
  });

  it('lança 404 (não 403) quando o processo pertence a outro cidadão', async () => {
    processoMock.findUnique.mockResolvedValue({ cidadaoId: CIDADAO_DONO });

    await expect(obterHistorico(PROCESSO_ID, CIDADAO_INTRUSO, deps())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(movimentacaoMock.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// obterMensagens (Req 5.5, 5.10)
// ---------------------------------------------------------------------------

describe('obterMensagens', () => {
  it('retorna apenas mensagens do canal publico, ordenadas crescente', async () => {
    processoMock.findUnique.mockResolvedValue({ cidadaoId: CIDADAO_DONO });
    mensagemMock.findMany.mockResolvedValue([
      {
        id: 'msg-1',
        conteudo: 'Olá, quando meu processo será analisado?',
        enviadaEm: new Date('2024-01-11T10:00:00Z'),
        remetenteCidadao: { nome: 'João da Silva' },
        remetenteServidor: null,
      },
      {
        id: 'msg-2',
        conteudo: 'Em análise, aguarde novidades.',
        enviadaEm: new Date('2024-01-12T14:00:00Z'),
        remetenteCidadao: null,
        remetenteServidor: { nome: 'Bruno Analista' },
      },
    ]);

    const resultado = await obterMensagens(PROCESSO_ID, CIDADAO_DONO, deps());

    expect(mensagemMock.findMany).toHaveBeenCalledWith({
      where: { processoId: PROCESSO_ID, canal: 'publico' },
      orderBy: { enviadaEm: 'asc' },
      select: {
        id: true,
        conteudo: true,
        enviadaEm: true,
        remetenteCidadao: { select: { nome: true } },
        remetenteServidor: { select: { nome: true } },
      },
    });

    expect(resultado).toEqual([
      {
        id: 'msg-1',
        remetente: 'João da Silva',
        conteudo: 'Olá, quando meu processo será analisado?',
        enviadaEm: new Date('2024-01-11T10:00:00Z'),
      },
      {
        id: 'msg-2',
        remetente: 'Bruno Analista',
        conteudo: 'Em análise, aguarde novidades.',
        enviadaEm: new Date('2024-01-12T14:00:00Z'),
      },
    ]);
  });

  it('lança 404 quando o processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(obterMensagens('proc-inexistente', CIDADAO_DONO, deps())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mensagemMock.findMany).not.toHaveBeenCalled();
  });

  it('lança 404 (não 403) quando o processo pertence a outro cidadão', async () => {
    processoMock.findUnique.mockResolvedValue({ cidadaoId: CIDADAO_DONO });

    await expect(obterMensagens(PROCESSO_ID, CIDADAO_INTRUSO, deps())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mensagemMock.findMany).not.toHaveBeenCalled();
  });
});
