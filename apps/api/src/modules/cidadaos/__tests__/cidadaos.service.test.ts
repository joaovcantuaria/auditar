import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Stubs dos módulos de infra (prisma/redis/mailer/auditoria/env) para evitar
// carregar `@prisma/client`/`ioredis` reais ou abrir conexões ao IMPORTAR o
// serviço. Todos os testes injetam mocks explícitos via `deps`. O `bcryptjs` é
// mockado para manter os testes rápidos e determinísticos.
// ---------------------------------------------------------------------------
vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../../../config/env.js', () => ({ env: { BCRYPT_ROUNDS: 12, WEB_URL: 'http://localhost:5173' } }));
vi.mock('../cidadaos.email.js', () => ({ enviarConfirmacaoNovoEmail: vi.fn(async () => undefined) }));
vi.mock('../../../modules/auditoria/index.js', () => ({ registrar: vi.fn() }));

const bcryptCompareMock = vi.fn();
const bcryptHashMock = vi.fn();
vi.mock('bcryptjs', () => ({
  default: {
    compare: (...args: unknown[]) => bcryptCompareMock(...args),
    hash: (...args: unknown[]) => bcryptHashMock(...args),
  },
}));

// Import AFTER mocks are registered.
import {
  obterPerfil,
  editarPerfil,
  solicitarAlteracaoEmail,
  confirmarAlteracaoEmail,
  alterarSenha,
  historicoAcessos,
  buscarPorCpf,
  EMAIL_CHANGE_KEY_PREFIX,
  EMAIL_CHANGE_TTL_SECONDS,
  HISTORICO_ACESSOS_LIMITE,
  type CidadaosDeps,
  type AtorCidadao,
} from '../cidadaos.service.js';

// ---------------------------------------------------------------------------
// Mocks das dependências injetadas.
// ---------------------------------------------------------------------------

const prismaMock = {
  cidadao: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  acessoHistorico: {
    findMany: vi.fn(),
  },
};

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

const auditarMock = vi.fn();
const enviarConfirmacaoEmailMock = vi.fn();

function deps(): Partial<CidadaosDeps> {
  return {
    prisma: prismaMock as unknown as CidadaosDeps['prisma'],
    redis: redisMock as unknown as CidadaosDeps['redis'],
    auditar: auditarMock,
    enviarConfirmacaoEmail: enviarConfirmacaoEmailMock as unknown as CidadaosDeps['enviarConfirmacaoEmail'],
    gerarToken: () => 'token-fixo-uuid',
  };
}

const ATOR: AtorCidadao = { cidadaoId: 'cid-1', enderecoIp: '203.0.113.10' };

function makeCidadao(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cid-1',
    nome: 'Maria Silva',
    cpf: '12345678909',
    email: 'maria@example.com',
    telefone: '11999998888',
    logradouro: 'Rua A',
    numero: '100',
    cep: '01001000',
    cidade: 'São Paulo',
    estado: 'SP',
    senhaHash: 'hash-antigo',
    ativo: true,
    emailConfirmado: true,
    tokenAtivacao: null,
    tokenAtivacaoExpira: null,
    tentativasLogin: 0,
    bloqueadoAte: null,
    doisFatoresAtivo: false,
    doisFatoresCanal: null,
    criadoEm: new Date('2024-01-01T00:00:00.000Z'),
    atualizadoEm: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auditarMock.mockResolvedValue(undefined);
  enviarConfirmacaoEmailMock.mockResolvedValue(undefined);
  redisMock.set.mockResolvedValue('OK');
  redisMock.del.mockResolvedValue(1);
  bcryptCompareMock.mockResolvedValue(true);
  bcryptHashMock.mockResolvedValue('hash-novo');
});

// ---------------------------------------------------------------------------
// obterPerfil
// ---------------------------------------------------------------------------

describe('obterPerfil', () => {
  it('retorna o perfil SEM o hash da senha', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(makeCidadao());

    const perfil = await obterPerfil('cid-1', deps());

    expect(perfil).not.toHaveProperty('senhaHash');
    expect(perfil.email).toBe('maria@example.com');
    expect(perfil.cpf).toBe('12345678909');
  });

  it('lança notFound quando o cidadão não existe', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(null);

    await expect(obterPerfil('inexistente', deps())).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// editarPerfil
// ---------------------------------------------------------------------------

describe('editarPerfil', () => {
  it('atualiza os campos permitidos, não expõe hash e audita (Req 7.1)', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(makeCidadao());
    prismaMock.cidadao.update.mockResolvedValue(
      makeCidadao({ nome: 'Maria Souza', telefone: '1133334444' }),
    );

    const perfil = await editarPerfil(
      'cid-1',
      { nome: 'Maria Souza', telefone: '1133334444' },
      ATOR,
      deps(),
    );

    expect(prismaMock.cidadao.update).toHaveBeenCalledWith({
      where: { id: 'cid-1' },
      data: {
        nome: 'Maria Souza',
        telefone: '1133334444',
        logradouro: undefined,
        numero: undefined,
        cep: undefined,
        cidade: undefined,
        estado: undefined,
      },
    });
    expect(perfil).not.toHaveProperty('senhaHash');
    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ator: 'cidadao',
        atorCidadaoId: 'cid-1',
        tipoAcao: 'editar_perfil',
      }),
    );
  });

  it('lança notFound quando o cidadão não existe', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(null);

    await expect(
      editarPerfil('x', { nome: 'Nova' }, ATOR, deps()),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.cidadao.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// solicitarAlteracaoEmail
// ---------------------------------------------------------------------------

describe('solicitarAlteracaoEmail', () => {
  it('rejeita e-mail já em uso por outra conta sem enfileirar token nem enviar e-mail', async () => {
    prismaMock.cidadao.findUnique
      .mockResolvedValueOnce(makeCidadao()) // busca do próprio cidadão
      .mockResolvedValueOnce(makeCidadao({ id: 'outro', email: 'novo@example.com' })); // e-mail já usado

    await expect(
      solicitarAlteracaoEmail('cid-1', 'novo@example.com', ATOR, deps()),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
      field: 'novoEmail',
    });
    expect(redisMock.set).not.toHaveBeenCalled();
    expect(enviarConfirmacaoEmailMock).not.toHaveBeenCalled();
  });

  it('armazena token 24h, envia e-mail ao NOVO endereço e mantém o e-mail antigo (Req 7.2)', async () => {
    prismaMock.cidadao.findUnique
      .mockResolvedValueOnce(makeCidadao()) // próprio cidadão
      .mockResolvedValueOnce(null); // novo e-mail livre

    await solicitarAlteracaoEmail('cid-1', 'Novo@Example.com', ATOR, deps());

    expect(redisMock.set).toHaveBeenCalledWith(
      `${EMAIL_CHANGE_KEY_PREFIX}token-fixo-uuid`,
      JSON.stringify({ cidadaoId: 'cid-1', novoEmail: 'novo@example.com' }),
      'EX',
      EMAIL_CHANGE_TTL_SECONDS,
    );
    expect(EMAIL_CHANGE_TTL_SECONDS).toBe(86_400);
    expect(enviarConfirmacaoEmailMock).toHaveBeenCalledWith(
      'Maria Silva',
      'novo@example.com',
      'token-fixo-uuid',
    );
    // O e-mail do cidadão NÃO é alterado neste passo (permanece ativo).
    expect(prismaMock.cidadao.update).not.toHaveBeenCalled();
    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'solicitar_alteracao_email' }),
    );
  });
});

// ---------------------------------------------------------------------------
// confirmarAlteracaoEmail
// ---------------------------------------------------------------------------

describe('confirmarAlteracaoEmail', () => {
  it('atualiza o e-mail e remove o token quando válido (Req 7.2)', async () => {
    redisMock.get.mockResolvedValue(
      JSON.stringify({ cidadaoId: 'cid-1', novoEmail: 'novo@example.com' }),
    );
    prismaMock.cidadao.update.mockResolvedValue(makeCidadao({ email: 'novo@example.com' }));

    const perfil = await confirmarAlteracaoEmail('token-fixo-uuid', deps());

    expect(prismaMock.cidadao.update).toHaveBeenCalledWith({
      where: { id: 'cid-1' },
      data: { email: 'novo@example.com' },
    });
    expect(redisMock.del).toHaveBeenCalledWith(`${EMAIL_CHANGE_KEY_PREFIX}token-fixo-uuid`);
    expect(perfil).not.toHaveProperty('senhaHash');
    expect(perfil.email).toBe('novo@example.com');
  });

  it('rejeita token expirado/ausente com TOKEN_EXPIRED e não altera o e-mail (Req 7.8)', async () => {
    redisMock.get.mockResolvedValue(null);

    await expect(
      confirmarAlteracaoEmail('token-expirado', deps()),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.TOKEN_EXPIRED,
    });
    expect(prismaMock.cidadao.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// alterarSenha
// ---------------------------------------------------------------------------

describe('alterarSenha', () => {
  it('rejeita senha atual incorreta sem revelar a senha e sem atualizar (Req 7.4)', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(makeCidadao());
    bcryptCompareMock.mockResolvedValue(false);

    await expect(
      alterarSenha('cid-1', 'errada', 'novaSenha123', ATOR, deps()),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.INVALID_CREDENTIALS,
      field: 'senhaAtual',
    });
    expect(prismaMock.cidadao.update).not.toHaveBeenCalled();
    expect(bcryptHashMock).not.toHaveBeenCalled();
  });

  it('atualiza a senha (hash) quando a senha atual está correta (Req 7.3)', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(makeCidadao());
    bcryptCompareMock.mockResolvedValue(true);
    prismaMock.cidadao.update.mockResolvedValue(makeCidadao({ senhaHash: 'hash-novo' }));

    await alterarSenha('cid-1', 'atualCorreta', 'novaSenhaForte1', ATOR, deps());

    expect(bcryptCompareMock).toHaveBeenCalledWith('atualCorreta', 'hash-antigo');
    expect(bcryptHashMock).toHaveBeenCalledWith('novaSenhaForte1', 12);
    expect(prismaMock.cidadao.update).toHaveBeenCalledWith({
      where: { id: 'cid-1' },
      data: { senhaHash: 'hash-novo' },
    });
    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'alterar_senha' }),
    );
  });
});

// ---------------------------------------------------------------------------
// historicoAcessos
// ---------------------------------------------------------------------------

describe('historicoAcessos', () => {
  it('retorna os últimos 10 acessos em ordem decrescente com data/hora/ip (Req 7.5)', async () => {
    prismaMock.acessoHistorico.findMany.mockResolvedValue([
      { id: 'a1', cidadaoId: 'cid-1', servidorId: null, enderecoIp: '203.0.113.10', acessadoEm: new Date('2024-05-02T14:30:15.000Z') },
      { id: 'a2', cidadaoId: 'cid-1', servidorId: null, enderecoIp: '203.0.113.11', acessadoEm: new Date('2024-05-01T09:00:00.000Z') },
    ]);

    const acessos = await historicoAcessos('cid-1', deps());

    expect(prismaMock.acessoHistorico.findMany).toHaveBeenCalledWith({
      where: { cidadaoId: 'cid-1' },
      orderBy: { acessadoEm: 'desc' },
      take: HISTORICO_ACESSOS_LIMITE,
    });
    expect(HISTORICO_ACESSOS_LIMITE).toBe(10);
    expect(acessos).toEqual([
      { data: '2024-05-02', hora: '14:30:15', ip: '203.0.113.10' },
      { data: '2024-05-01', hora: '09:00:00', ip: '203.0.113.11' },
    ]);
  });

  it('retorna lista vazia quando não há acessos', async () => {
    prismaMock.acessoHistorico.findMany.mockResolvedValue([]);
    await expect(historicoAcessos('cid-1', deps())).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buscarPorCpf — busca de Cidadão para abertura administrativa (Req. 23.2, 23.3)
// ---------------------------------------------------------------------------

describe('buscarPorCpf', () => {
  it('rejeita CPF inválido antes de consultar o banco (Req 23.2)', async () => {
    await expect(buscarPorCpf('11111111111', deps())).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.CPF_INVALIDO,
      field: 'cpf',
    });
    expect(prismaMock.cidadao.findUnique).not.toHaveBeenCalled();
  });

  it('retorna 404 quando o Cidadão não é encontrado (Req 23.3)', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(null);

    await expect(buscarPorCpf('123.456.789-09', deps())).rejects.toMatchObject({
      statusCode: 404,
    });
    // Consulta pelo CPF apenas com os 11 dígitos (desformatado).
    expect(prismaMock.cidadao.findUnique).toHaveBeenCalledWith({ where: { cpf: '12345678909' } });
  });

  it('retorna os dados de identificação (sem senhaHash) quando encontrado', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(makeCidadao());

    const resultado = await buscarPorCpf('12345678909', deps());

    expect(resultado).toEqual({
      id: 'cid-1',
      nome: 'Maria Silva',
      cpf: '12345678909',
      cpfFormatado: '123.456.789-09',
      email: 'maria@example.com',
      telefone: '11999998888',
      ativo: true,
    });
    expect(resultado as Record<string, unknown>).not.toHaveProperty('senhaHash');
  });
});
