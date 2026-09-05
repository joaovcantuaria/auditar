import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NivelAcesso, ErrorCodes } from '@auditar/shared';
import { AppError } from '../../../utils/errors.js';

// bcryptjs é importado estaticamente pelo serviço; mockamos o hash para não
// gastar tempo com o custo real e para inspecionar as chamadas.
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (senha: string) => `hash(${senha})`),
    compare: vi.fn(async () => true),
  },
}));

import bcrypt from 'bcryptjs';
import { criarServidorSchema, editarServidorSchema } from '../servidores.schema.js';
import {
  listar,
  criar,
  editar,
  gerarSenhaTemporaria,
  contarAdminsAtivos,
  type ServidoresDeps,
  type Ator,
} from '../servidores.service.js';

// ---------------------------------------------------------------------------
// Helpers de mock
// ---------------------------------------------------------------------------

const ator: Ator = { servidorId: 'admin-1', enderecoIp: '203.0.113.9' };

// CPF válido (dígitos verificadores corretos) para os testes de caminho feliz.
const CPF_VALIDO = '52998224725';
// CPF com 11 dígitos mas dígitos verificadores inválidos.
const CPF_INVALIDO = '11111111111';

function makeDeps() {
  const servidor = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const auditar = vi.fn().mockResolvedValue(undefined);
  const sendMail = vi.fn().mockResolvedValue(undefined);

  const deps = {
    prisma: { servidor },
    mailer: { sendMail },
    fromAddress: 'Auditar <no-reply@auditar.local>',
    auditar,
  } as unknown as ServidoresDeps;

  return { deps, servidor, auditar, sendMail };
}

function dtoValido(overrides: Record<string, unknown> = {}) {
  return criarServidorSchema.parse({
    nome: 'Maria Silva',
    cpf: CPF_VALIDO,
    email: 'maria.silva@prefeitura.gov.br',
    telefone: '11999998888',
    nivelAcesso: NivelAcesso.ANALISTA,
    unidadeId: 'uni-1',
    ...overrides,
  });
}

/** Servidor criado retornado pelo prisma (sem hash, conforme SELECT). */
function servidorCriado(overrides: Record<string, unknown> = {}) {
  return {
    id: 'srv-1',
    nome: 'Maria Silva',
    cpf: CPF_VALIDO,
    email: 'maria.silva@prefeitura.gov.br',
    telefone: '11999998888',
    nivelAcesso: NivelAcesso.ANALISTA,
    ativo: true,
    senhaTemporaria: true,
    unidadeId: 'uni-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// gerarSenhaTemporaria (Req. 21.3)
// ---------------------------------------------------------------------------

describe('gerarSenhaTemporaria', () => {
  it('gera senha com no mínimo 8 caracteres', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(gerarSenhaTemporaria().length).toBeGreaterThanOrEqual(8);
    }
  });

  it('gera senha mista (minúscula, maiúscula, dígito e símbolo)', () => {
    const senha = gerarSenhaTemporaria();
    expect(senha).toMatch(/[a-z]/);
    expect(senha).toMatch(/[A-Z]/);
    expect(senha).toMatch(/[0-9]/);
    expect(senha).toMatch(/[!@#$%&*?]/);
  });
});

// ---------------------------------------------------------------------------
// criar (Req. 21.1, 21.2, 21.3, 21.9)
// ---------------------------------------------------------------------------

describe('criar', () => {
  it('rejeita CPF com dígitos verificadores inválidos (Req. 21.1)', async () => {
    const { deps, servidor } = makeDeps();

    await expect(
      criar(dtoValido({ cpf: CPF_INVALIDO }), ator, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.CPF_INVALIDO });

    expect(servidor.create).not.toHaveBeenCalled();
  });

  it('rejeita CPF duplicado sem criar o registro (Req. 21.2)', async () => {
    const { deps, servidor, auditar } = makeDeps();
    servidor.findUnique.mockResolvedValue({ id: 'srv-existente' });

    await expect(criar(dtoValido(), ator, deps)).rejects.toMatchObject({
      code: ErrorCodes.CPF_DUPLICADO,
    });

    expect(servidor.create).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it('gera senha temporária, envia por email e marca senhaTemporaria=true (Req. 21.3)', async () => {
    const { deps, servidor, sendMail } = makeDeps();
    servidor.findUnique.mockResolvedValue(null);
    servidor.create.mockResolvedValue(servidorCriado());

    const { senhaEnviada } = await criar(dtoValido(), ator, deps);

    expect(senhaEnviada).toBe(true);
    // Persistiu apenas o hash (nunca a senha em texto puro) e senhaTemporaria=true.
    const createData = servidor.create.mock.calls[0][0].data;
    expect(createData.senhaTemporaria).toBe(true);
    expect(createData.senhaHash).toMatch(/^hash\(/);
    expect(bcrypt.hash).toHaveBeenCalledTimes(1);

    // O email foi enviado ao endereço institucional contendo a senha temporária.
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('maria.silva@prefeitura.gov.br');
    // A senha em texto puro passada ao bcrypt.hash aparece no corpo do email.
    const senhaHashArg = (bcrypt.hash as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as string;
    expect(mail.text).toContain(senhaHashArg);
  });

  it('sinaliza senhaEnviada=false sem desfazer o cadastro quando o email falha (Req. 21.4)', async () => {
    const { deps, servidor, sendMail } = makeDeps();
    servidor.findUnique.mockResolvedValue(null);
    servidor.create.mockResolvedValue(servidorCriado());
    sendMail.mockRejectedValue(new Error('smtp down'));

    const { servidor: criadoResp, senhaEnviada } = await criar(dtoValido(), ator, deps);

    expect(senhaEnviada).toBe(false);
    expect(criadoResp).toBeDefined();
    expect(servidor.create).toHaveBeenCalledTimes(1); // cadastro mantido
  });

  it('rejeita cadastro do 4º Administrador quando já existem 3 ativos (Req. 21.9)', async () => {
    const { deps, servidor } = makeDeps();
    servidor.findUnique.mockResolvedValue(null);
    servidor.count.mockResolvedValue(3); // MAX_ADMINS = 3 (default)

    await expect(
      criar(dtoValido({ nivelAcesso: NivelAcesso.ADMINISTRADOR }), ator, deps),
    ).rejects.toBeInstanceOf(AppError);

    expect(servidor.create).not.toHaveBeenCalled();
  });

  it('cria com sucesso, registra auditoria e não expõe senhaHash', async () => {
    const { deps, servidor, auditar } = makeDeps();
    servidor.findUnique.mockResolvedValue(null);
    servidor.create.mockResolvedValue(servidorCriado());

    const { servidor: resp } = await criar(dtoValido(), ator, deps);

    expect(resp).not.toHaveProperty('senhaHash');
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0][0]).toMatchObject({
      tipoAcao: 'criar_servidor',
      modulo: 'servidores',
      tipoObjeto: 'Servidor',
      objetoId: 'srv-1',
      atorServidorId: 'admin-1',
    });
  });
});

// ---------------------------------------------------------------------------
// editar (Req. 21.5, 21.9)
// ---------------------------------------------------------------------------

describe('editar', () => {
  it('mantém o CPF imutável — nunca envia cpf no update (Req. 21.5)', async () => {
    const { deps, servidor } = makeDeps();
    servidor.findUnique.mockResolvedValue(servidorCriado());
    servidor.update.mockResolvedValue(servidorCriado({ nome: 'Maria S. Souza' }));

    // Mesmo que um cpf chegue (fora do schema), não deve ser persistido.
    const dto = { nome: 'Maria S. Souza', cpf: '00000000000' } as never;
    await editar('srv-1', dto, ator, deps);

    const updateData = servidor.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('cpf');
    expect(updateData.nome).toBe('Maria S. Souza');
  });

  it('lança erro quando o servidor não existe', async () => {
    const { deps, servidor } = makeDeps();
    servidor.findUnique.mockResolvedValue(null);

    await expect(editar('inexistente', {}, ator, deps)).rejects.toBeInstanceOf(AppError);
    expect(servidor.update).not.toHaveBeenCalled();
  });

  it('rejeita promover para Administrador além do limite (Req. 21.9)', async () => {
    const { deps, servidor } = makeDeps();
    servidor.findUnique.mockResolvedValue(servidorCriado({ nivelAcesso: NivelAcesso.ANALISTA }));
    servidor.count.mockResolvedValue(3); // já há 3 admins ativos

    await expect(
      editar('srv-1', { nivelAcesso: NivelAcesso.ADMINISTRADOR }, ator, deps),
    ).rejects.toBeInstanceOf(AppError);

    expect(servidor.update).not.toHaveBeenCalled();
  });

  it('permite editar quando já é Administrador (não conta a si próprio no limite)', async () => {
    const { deps, servidor } = makeDeps();
    servidor.findUnique.mockResolvedValue(
      servidorCriado({ nivelAcesso: NivelAcesso.ADMINISTRADOR }),
    );
    servidor.update.mockResolvedValue(
      servidorCriado({ nivelAcesso: NivelAcesso.ADMINISTRADOR, nome: 'Novo Nome' }),
    );

    const result = await editar(
      'srv-1',
      { nome: 'Novo Nome', nivelAcesso: NivelAcesso.ADMINISTRADOR },
      ator,
      deps,
    );

    // Não deve checar limite (não chama count) pois já era admin.
    expect(servidor.count).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(servidor.update).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// contarAdminsAtivos (Req. 21.9)
// ---------------------------------------------------------------------------

describe('contarAdminsAtivos', () => {
  it('conta administradores ativos, opcionalmente excluindo um id', async () => {
    const { deps, servidor } = makeDeps();
    servidor.count.mockResolvedValue(2);

    const total = await contarAdminsAtivos(deps.prisma, 'srv-1');

    expect(total).toBe(2);
    const where = servidor.count.mock.calls[0][0].where;
    expect(where.nivelAcesso).toBe(NivelAcesso.ADMINISTRADOR);
    expect(where.ativo).toBe(true);
    expect(where.id).toEqual({ not: 'srv-1' });
  });
});

// ---------------------------------------------------------------------------
// listar (paginação + sem hash)
// ---------------------------------------------------------------------------

describe('listar', () => {
  it('pagina e aplica filtros, selecionando campos sem senhaHash', async () => {
    const { deps, servidor } = makeDeps();
    servidor.findMany.mockResolvedValue([servidorCriado()]);
    servidor.count.mockResolvedValue(1);

    const result = await listar(
      { page: 2, pageSize: 10, nivel: NivelAcesso.ANALISTA, unidadeId: 'uni-1', ativo: true },
      deps,
    );

    expect(result.meta).toMatchObject({ total: 1, page: 2, pageSize: 10 });
    expect(result.data[0]).not.toHaveProperty('senhaHash');

    const findArgs = servidor.findMany.mock.calls[0][0];
    expect(findArgs.where).toEqual({
      nivelAcesso: NivelAcesso.ANALISTA,
      unidadeId: 'uni-1',
      ativo: true,
    });
    expect(findArgs.skip).toBe(10); // (page 2 - 1) * pageSize 10
    expect(findArgs.take).toBe(10);
    // O select NÃO inclui senhaHash.
    expect(findArgs.select).not.toHaveProperty('senhaHash');
  });

  it('lista sem filtros quando nenhum é informado', async () => {
    const { deps, servidor } = makeDeps();
    servidor.findMany.mockResolvedValue([]);
    servidor.count.mockResolvedValue(0);

    await listar({}, deps);

    expect(servidor.findMany.mock.calls[0][0].where).toEqual({});
  });
});
