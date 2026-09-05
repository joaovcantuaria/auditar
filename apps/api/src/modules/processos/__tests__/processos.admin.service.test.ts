import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusProcesso, ErrorCodes } from '@auditar/shared';

// Stub da infra para não abrir conexão real ao importar o serviço.
vi.mock('../../../config/database.js', () => ({ prisma: {} }));

import {
  listarAdmin,
  buscaRapida,
  corDoStatus,
  montarWhere,
  montarOrderBy,
  CORES_STATUS,
  BUSCA_RAPIDA_MSG_CURTO,
  PAGE_SIZE_PADRAO,
  type ProcessosAdminDeps,
} from '../processos.admin.service.js';
import { AppError } from '../../../utils/index.js';

// ---------------------------------------------------------------------------
// Mock do prisma injetado
// ---------------------------------------------------------------------------

const findManyMock = vi.fn();
const countMock = vi.fn();

const prismaMock = {
  processo: {
    findMany: findManyMock,
    count: countMock,
  },
};

function deps(): Partial<ProcessosAdminDeps> {
  return { prisma: prismaMock as unknown as ProcessosAdminDeps['prisma'] };
}

/** Linha crua no formato retornado pelo Prisma (com include). */
function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    protocolo: '2024000001',
    status: StatusProcesso.EM_ANDAMENTO,
    prazoFinal: new Date('2024-12-31T00:00:00Z'),
    atualizadoEm: new Date('2024-06-01T00:00:00Z'),
    cidadao: { nome: 'Maria Silva' },
    tipoProcesso: { nome: 'Licença', categoria: { nome: 'Obras' } },
    servidorResponsavel: { nome: 'João Analista' },
    movimentacoes: [{ realizadoEm: new Date('2024-07-15T10:00:00Z') }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// corDoStatus (Req. 10.4)
// ---------------------------------------------------------------------------

describe('corDoStatus', () => {
  it('mapeia aprovado e finalizado para verde', () => {
    expect(corDoStatus(StatusProcesso.APROVADO)).toBe('#27AE60');
    expect(corDoStatus(StatusProcesso.FINALIZADO)).toBe('#27AE60');
  });

  it('mapeia em_andamento para amarelo', () => {
    expect(corDoStatus(StatusProcesso.EM_ANDAMENTO)).toBe('#F39C12');
  });

  it('mapeia vencido e rejeitado para vermelho', () => {
    expect(corDoStatus(StatusProcesso.VENCIDO)).toBe('#E74C3C');
    expect(corDoStatus(StatusProcesso.REJEITADO)).toBe('#E74C3C');
  });

  it('mapeia estados de aguardando/aberto para azul', () => {
    expect(corDoStatus(StatusProcesso.ABERTO)).toBe('#0066CC');
    expect(corDoStatus(StatusProcesso.AGUARDANDO_DOCS)).toBe('#0066CC');
    expect(corDoStatus(StatusProcesso.AGUARDANDO_CIDADAO)).toBe('#0066CC');
  });

  it('cobre todos os status conhecidos', () => {
    for (const s of Object.values(StatusProcesso)) {
      expect(CORES_STATUS[s]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('retorna cor neutra para status desconhecido', () => {
    expect(corDoStatus('desconhecido')).toBe('#7F8C8D');
  });
});

// ---------------------------------------------------------------------------
// montarWhere — filtros combinados (Req. 10.2)
// ---------------------------------------------------------------------------

describe('montarWhere', () => {
  it('retorna where vazio sem filtros', () => {
    expect(montarWhere()).toEqual({});
    expect(montarWhere({})).toEqual({});
  });

  it('filtra categoria via relação com tipoProcesso', () => {
    expect(montarWhere({ categoriaId: 'cat-1' })).toEqual({
      tipoProcesso: { categoriaId: 'cat-1' },
    });
  });

  it('aplica intervalo de data de abertura', () => {
    const inicio = new Date('2024-01-01T00:00:00Z');
    const fim = new Date('2024-01-31T00:00:00Z');
    expect(montarWhere({ dataAberturaInicio: inicio, dataAberturaFim: fim })).toMatchObject({
      abertoEm: { gte: inicio, lte: fim },
    });
  });

  it('aplica intervalo de prazo sobre prazoFinal', () => {
    const de = new Date('2024-02-01T00:00:00Z');
    const ate = new Date('2024-02-28T00:00:00Z');
    expect(montarWhere({ prazoInicio: de, prazoFim: ate })).toMatchObject({
      prazoFinal: { gte: de, lte: ate },
    });
  });

  it('faz match parcial case-insensitive no nome do cidadão', () => {
    expect(montarWhere({ nomeCidadao: 'maria' })).toMatchObject({
      cidadao: { nome: { contains: 'maria', mode: 'insensitive' } },
    });
  });

  it('normaliza o CPF para dígitos', () => {
    expect(montarWhere({ cpfCidadao: '529.982.247-25' })).toMatchObject({
      cidadao: { cpf: '52998224725' },
    });
  });

  it('combina múltiplos filtros simultaneamente', () => {
    const where = montarWhere({
      tipoProcessoId: 'tp-1',
      status: StatusProcesso.EM_ANDAMENTO,
      servidorResponsavelId: 'srv-1',
      unidadeId: 'uni-1',
      prioridade: 2,
      nomeCidadao: 'ana',
    });
    expect(where).toMatchObject({
      tipoProcessoId: 'tp-1',
      status: StatusProcesso.EM_ANDAMENTO,
      servidorResponsavelId: 'srv-1',
      unidadeId: 'uni-1',
      prioridade: 2,
      cidadao: { nome: { contains: 'ana', mode: 'insensitive' } },
    });
  });
});

// ---------------------------------------------------------------------------
// montarOrderBy — ordenação (Req. 10.3)
// ---------------------------------------------------------------------------

describe('montarOrderBy', () => {
  it('ordena por protocolo asc/desc', () => {
    expect(montarOrderBy({ ordenarPor: 'protocolo', direcao: 'asc' })).toEqual({
      protocolo: 'asc',
    });
    expect(montarOrderBy({ ordenarPor: 'protocolo', direcao: 'desc' })).toEqual({
      protocolo: 'desc',
    });
  });

  it('mapeia colunas de relação (cidadão, tipo, servidor)', () => {
    expect(montarOrderBy({ ordenarPor: 'cidadao', direcao: 'asc' })).toEqual({
      cidadao: { nome: 'asc' },
    });
    expect(montarOrderBy({ ordenarPor: 'tipo', direcao: 'desc' })).toEqual({
      tipoProcesso: { nome: 'desc' },
    });
    expect(montarOrderBy({ ordenarPor: 'servidor', direcao: 'asc' })).toEqual({
      servidorResponsavel: { nome: 'asc' },
    });
  });

  it('usa abertoEm desc como padrão', () => {
    expect(montarOrderBy()).toEqual({ abertoEm: 'desc' });
    expect(montarOrderBy({})).toEqual({ abertoEm: 'desc' });
  });
});

// ---------------------------------------------------------------------------
// listarAdmin (Req. 10.1, 10.2, 10.3, 10.4, 10.8)
// ---------------------------------------------------------------------------

describe('listarAdmin', () => {
  it('aplica where combinado, paginação (skip/take) e ordenação', async () => {
    findManyMock.mockResolvedValue([rawRow()]);
    countMock.mockResolvedValue(1);

    await listarAdmin(
      { status: StatusProcesso.EM_ANDAMENTO, categoriaId: 'cat-1' },
      { page: 3, pageSize: 20 },
      { ordenarPor: 'protocolo', direcao: 'asc' },
      deps(),
    );

    const arg = findManyMock.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      status: StatusProcesso.EM_ANDAMENTO,
      tipoProcesso: { categoriaId: 'cat-1' },
    });
    expect(arg.orderBy).toEqual({ protocolo: 'asc' });
    // page 3, pageSize 20 => skip 40, take 20
    expect(arg.skip).toBe(40);
    expect(arg.take).toBe(20);
    // count usa o mesmo where
    expect(countMock.mock.calls[0][0].where).toMatchObject({ status: StatusProcesso.EM_ANDAMENTO });
  });

  it('formata as linhas com todos os campos exigidos (Req. 10.4)', async () => {
    findManyMock.mockResolvedValue([rawRow()]);
    countMock.mockResolvedValue(1);

    const res = await listarAdmin({}, {}, undefined, deps());
    expect(res.data[0]).toEqual({
      protocolo: '2024000001',
      cidadao: 'Maria Silva',
      categoria: 'Obras',
      tipoProcesso: 'Licença',
      status: StatusProcesso.EM_ANDAMENTO,
      statusCor: '#F39C12',
      prazoFinal: new Date('2024-12-31T00:00:00Z'),
      servidorResponsavel: 'João Analista',
      ultimaMovimentacao: new Date('2024-07-15T10:00:00Z'),
    });
    expect(res.meta).toEqual({ total: 1, page: 1, pageSize: PAGE_SIZE_PADRAO, totalPages: 1 });
  });

  it('usa atualizadoEm como última movimentação quando não há movimentações', async () => {
    findManyMock.mockResolvedValue([rawRow({ movimentacoes: [] })]);
    countMock.mockResolvedValue(1);

    const res = await listarAdmin({}, {}, undefined, deps());
    expect(res.data[0].ultimaMovimentacao).toEqual(new Date('2024-06-01T00:00:00Z'));
  });

  it('retorna data vazio + meta quando nenhum processo corresponde (Req. 10.8)', async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    const res = await listarAdmin({ status: StatusProcesso.VENCIDO }, {}, undefined, deps());
    expect(res.data).toEqual([]);
    expect(res.meta).toEqual({ total: 0, page: 1, pageSize: PAGE_SIZE_PADRAO, totalPages: 0 });
  });
});

// ---------------------------------------------------------------------------
// buscaRapida (Req. 10.5, 10.6)
// ---------------------------------------------------------------------------

describe('buscaRapida', () => {
  it('rejeita termos com menos de 3 caracteres (Req. 10.6)', async () => {
    await expect(buscaRapida('ab', {}, deps())).rejects.toBeInstanceOf(AppError);
    await expect(buscaRapida('ab', {}, deps())).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
      message: BUSCA_RAPIDA_MSG_CURTO,
    });
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('rejeita termo em branco com espaços', async () => {
    await expect(buscaRapida('   ', {}, deps())).rejects.toBeInstanceOf(AppError);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('busca por protocolo, nome e CPF com >=3 chars (Req. 10.5)', async () => {
    findManyMock.mockResolvedValue([rawRow()]);
    countMock.mockResolvedValue(1);

    await buscaRapida('2024', {}, deps());

    const where = findManyMock.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { protocolo: { contains: '2024', mode: 'insensitive' } },
        { cidadao: { nome: { contains: '2024', mode: 'insensitive' } } },
        { cidadao: { cpf: { contains: '2024' } } },
      ]),
    );
  });

  it('omite o ramo de CPF quando o termo não tem dígitos', async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    await buscaRapida('maria', {}, deps());

    const where = findManyMock.mock.calls[0][0].where;
    const temCpf = where.OR.some((c: Record<string, unknown>) => 'cidadao' in c && (c.cidadao as { cpf?: unknown }).cpf);
    expect(temCpf).toBe(false);
    expect(where.OR).toHaveLength(2);
  });

  it('normaliza máscara de CPF para dígitos no ramo de CPF', async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    await buscaRapida('529.982.247-25', {}, deps());

    const where = findManyMock.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([{ cidadao: { cpf: { contains: '52998224725' } } }]),
    );
  });

  it('retorna resultado paginado vazio com meta quando não há correspondência (Req. 10.8)', async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    const res = await buscaRapida('xyz', {}, deps());
    expect(res.data).toEqual([]);
    expect(res.meta).toEqual({ total: 0, page: 1, pageSize: PAGE_SIZE_PADRAO, totalPages: 0 });
  });
});
