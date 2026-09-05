import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes, TipoCampo } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Stubs dos módulos de infra (prisma/redis/auditoria) para evitar carregar o
// `@prisma/client` real e abrir conexões ao apenas IMPORTAR o serviço. Todos os
// testes injetam mocks explícitos via `deps`, então estes stubs só precisam
// existir como módulos resolvíveis.
// ---------------------------------------------------------------------------
vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../../../modules/auditoria/index.js', () => ({ registrar: vi.fn() }));

// Import AFTER mocks are registered.
import {
  criar,
  obterPorTipoUnidade,
  reordenarCampos,
  formularioCacheKey,
  FORMULARIO_CACHE_TTL_SECONDS,
  type FormulariosDeps,
  type AtorFormulario,
} from '../formularios.service.js';
import type { CampoInput, CriarFormularioInput } from '../formularios.schema.js';

// ---------------------------------------------------------------------------
// Mocks das dependências injetadas (prisma, redis, auditar).
// ---------------------------------------------------------------------------

const prismaMock = {
  formularioDinamico: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  campoFormulario: {
    deleteMany: vi.fn(),
    update: vi.fn(),
  },
};

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

const auditarMock = vi.fn();

function deps(): Partial<FormulariosDeps> {
  return {
    prisma: prismaMock as unknown as FormulariosDeps['prisma'],
    redis: redisMock as unknown as FormulariosDeps['redis'],
    auditar: auditarMock,
  };
}

const ATOR: AtorFormulario = { servidorId: 'srv-1', enderecoIp: '203.0.113.10' };

function makeCampo(overrides: Partial<CampoInput> = {}): CampoInput {
  return {
    tipo: TipoCampo.TEXTO_CURTO,
    rotulo: 'Nome completo',
    obrigatorio: true,
    ordem: 0,
    ...overrides,
  } as CampoInput;
}

function makeDto(overrides: Partial<CriarFormularioInput> = {}): CriarFormularioInput {
  return {
    tipoProcessoId: 'tp-1',
    unidadeId: 'un-1',
    campos: [makeCampo()],
    ...overrides,
  };
}

function makeFormulario(overrides: Record<string, unknown> = {}) {
  return {
    id: 'form-1',
    tipoProcessoId: 'tp-1',
    unidadeId: 'un-1',
    ativo: true,
    criadoEm: new Date(),
    criadoPorId: 'srv-1',
    campos: [{ id: 'c1', rotulo: 'Nome completo', tipo: 'texto_curto', ordem: 0 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.get.mockResolvedValue(null);
  redisMock.set.mockResolvedValue('OK');
  redisMock.del.mockResolvedValue(1);
  auditarMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// criar
// ---------------------------------------------------------------------------

describe('criar', () => {
  it('rejeita mais de 50 campos (Req 16.1) sem persistir', async () => {
    const campos = Array.from({ length: 51 }, (_, i) => makeCampo({ ordem: i }));

    await expect(criar(makeDto({ campos }), ATOR, deps())).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
      field: 'campos',
    });
    expect(prismaMock.formularioDinamico.create).not.toHaveBeenCalled();
    expect(auditarMock).not.toHaveBeenCalled();
  });

  it('rejeita rótulo em branco (Req 16.3) sem persistir', async () => {
    const dto = makeDto({ campos: [makeCampo({ rotulo: '   ' })] });

    await expect(criar(dto, ATOR, deps())).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
      field: 'campos.0.rotulo',
    });
    expect(prismaMock.formularioDinamico.create).not.toHaveBeenCalled();
  });

  it('rejeita valor padrão incompatível com o tipo (numero com "abc") (Req 16.3)', async () => {
    const dto = makeDto({
      campos: [makeCampo({ tipo: TipoCampo.NUMERO, valorPadrao: 'abc' })],
    });

    await expect(criar(dto, ATOR, deps())).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
      field: 'campos.0.valorPadrao',
    });
    expect(prismaMock.formularioDinamico.create).not.toHaveBeenCalled();
  });

  it('cria o formulário, invalida o cache e audita (Req 16.1)', async () => {
    const criado = makeFormulario({ id: 'form-9' });
    prismaMock.formularioDinamico.create.mockResolvedValue(criado);

    const result = await criar(makeDto(), ATOR, deps());

    expect(result).toBe(criado);
    expect(prismaMock.formularioDinamico.create).toHaveBeenCalledTimes(1);
    const createArg = prismaMock.formularioDinamico.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      tipoProcessoId: 'tp-1',
      unidadeId: 'un-1',
      criadoPorId: 'srv-1',
    });
    expect(redisMock.del).toHaveBeenCalledWith(formularioCacheKey('tp-1', 'un-1'));
    expect(auditarMock).toHaveBeenCalledTimes(1);
    expect(auditarMock.mock.calls[0][0]).toMatchObject({
      tipoAcao: 'criar_formulario',
      modulo: 'formularios',
      objetoId: 'form-9',
      atorServidorId: 'srv-1',
    });
  });
});

// ---------------------------------------------------------------------------
// obterPorTipoUnidade (cache)
// ---------------------------------------------------------------------------

describe('obterPorTipoUnidade', () => {
  it('em cache miss consulta o banco e popula o cache com TTL 10min', async () => {
    redisMock.get.mockResolvedValue(null);
    const formulario = makeFormulario();
    prismaMock.formularioDinamico.findFirst.mockResolvedValue(formulario);

    const result = await obterPorTipoUnidade('tp-1', 'un-1', deps());

    expect(result).toBe(formulario);
    expect(prismaMock.formularioDinamico.findFirst).toHaveBeenCalledWith({
      where: { tipoProcessoId: 'tp-1', unidadeId: 'un-1', ativo: true },
      include: { campos: { orderBy: { ordem: 'asc' } } },
    });
    expect(redisMock.set).toHaveBeenCalledWith(
      formularioCacheKey('tp-1', 'un-1'),
      JSON.stringify(formulario),
      'EX',
      FORMULARIO_CACHE_TTL_SECONDS,
    );
  });

  it('a segunda chamada usa o cache (não re-consulta o banco)', async () => {
    const formulario = makeFormulario();
    const serializado = JSON.stringify(formulario);
    redisMock.get.mockResolvedValue(serializado);

    const result = await obterPorTipoUnidade('tp-1', 'un-1', deps());

    expect(result).toEqual(JSON.parse(serializado));
    expect(prismaMock.formularioDinamico.findFirst).not.toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it('retorna null quando não há formulário ativo (Req 16.6)', async () => {
    redisMock.get.mockResolvedValue(null);
    prismaMock.formularioDinamico.findFirst.mockResolvedValue(null);

    const result = await obterPorTipoUnidade('tp-x', 'un-x', deps());

    expect(result).toBeNull();
    expect(redisMock.set).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reordenarCampos
// ---------------------------------------------------------------------------

describe('reordenarCampos', () => {
  it('persiste a nova ordem imediatamente (Req 16.4)', async () => {
    const atual = makeFormulario({
      campos: [
        { id: 'c1', rotulo: 'A', tipo: 'texto_curto', ordem: 0 },
        { id: 'c2', rotulo: 'B', tipo: 'texto_curto', ordem: 1 },
        { id: 'c3', rotulo: 'C', tipo: 'texto_curto', ordem: 2 },
      ],
    });
    // findUnique: 1ª chamada = estado atual; 2ª chamada = estado reordenado.
    prismaMock.formularioDinamico.findUnique
      .mockResolvedValueOnce(atual)
      .mockResolvedValueOnce(makeFormulario());
    prismaMock.campoFormulario.update.mockResolvedValue({});

    // Nova ordem: c3, c1, c2  → ordem 0,1,2 respectivamente.
    await reordenarCampos('form-1', ['c3', 'c1', 'c2'], ATOR, deps());

    expect(prismaMock.campoFormulario.update).toHaveBeenCalledTimes(3);
    expect(prismaMock.campoFormulario.update).toHaveBeenCalledWith({
      where: { id: 'c3' },
      data: { ordem: 0 },
    });
    expect(prismaMock.campoFormulario.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { ordem: 1 },
    });
    expect(prismaMock.campoFormulario.update).toHaveBeenCalledWith({
      where: { id: 'c2' },
      data: { ordem: 2 },
    });
    expect(redisMock.del).toHaveBeenCalledWith(formularioCacheKey('tp-1', 'un-1'));
    expect(auditarMock).toHaveBeenCalledTimes(1);
    expect(auditarMock.mock.calls[0][0]).toMatchObject({
      tipoAcao: 'reordenar_campos_formulario',
    });
  });

  it('rejeita id de campo que não pertence ao formulário', async () => {
    prismaMock.formularioDinamico.findUnique.mockResolvedValueOnce(
      makeFormulario({ campos: [{ id: 'c1', rotulo: 'A', tipo: 'texto_curto', ordem: 0 }] }),
    );

    await expect(
      reordenarCampos('form-1', ['c1', 'desconhecido'], ATOR, deps()),
    ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.VALIDATION_ERROR });
    expect(prismaMock.campoFormulario.update).not.toHaveBeenCalled();
  });
});
