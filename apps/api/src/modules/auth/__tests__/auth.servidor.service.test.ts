import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes, NivelAcesso } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Mocks das dependências externas do serviço.
// ---------------------------------------------------------------------------

const prismaMock = {
  servidor: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  permissaoServidor: {
    findMany: vi.fn(),
  },
  acessoHistorico: {
    create: vi.fn(),
  },
  notificacao: {
    createMany: vi.fn(),
  },
};

vi.mock('../../../config/database.js', () => ({
  get prisma() {
    return prismaMock;
  },
}));

const signTokenMock = vi.fn();
const blacklistTokenMock = vi.fn();
vi.mock('../../../lib/jwt.js', () => ({
  signToken: (...args: unknown[]) => signTokenMock(...args),
  blacklistToken: (...args: unknown[]) => blacklistTokenMock(...args),
}));

const bcryptCompareMock = vi.fn();
const bcryptHashMock = vi.fn();
vi.mock('bcryptjs', () => ({
  default: {
    compare: (...args: unknown[]) => bcryptCompareMock(...args),
    hash: (...args: unknown[]) => bcryptHashMock(...args),
  },
}));

const registrarMock = vi.fn();
vi.mock('../../../modules/auditoria/index.js', () => ({
  registrar: (...args: unknown[]) => registrarMock(...args),
}));

// Import AFTER mocks are registered.
import {
  loginServidor,
  logoutServidor,
  trocarSenha,
} from '../auth.servidor.service.js';
import { AppError } from '../../../utils/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServidor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'srv-1',
    nome: 'Maria Servidora',
    cpf: '39053344705',
    email: 'maria@municipio.gov',
    telefone: null,
    senhaHash: '$2a$12$hashedpassword',
    nivelAcesso: NivelAcesso.ANALISTA,
    ativo: true,
    senhaTemporaria: false,
    tentativasLogin: 0,
    bloqueadoAte: null,
    unidadeId: 'uni-1',
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    ...overrides,
  };
}

const IP = '203.0.113.10';
const CPF = '39053344705';

beforeEach(() => {
  vi.clearAllMocks();
  signTokenMock.mockReturnValue('signed.jwt.token');
  blacklistTokenMock.mockResolvedValue(undefined);
  bcryptHashMock.mockResolvedValue('$2a$12$novohash');
  registrarMock.mockResolvedValue(undefined);
  prismaMock.servidor.update.mockResolvedValue(undefined);
  prismaMock.permissaoServidor.findMany.mockResolvedValue([]);
  prismaMock.acessoHistorico.create.mockResolvedValue({ id: 'ac-1' });
  prismaMock.servidor.findMany.mockResolvedValue([]);
  prismaMock.notificacao.createMany.mockResolvedValue({ count: 0 });
});

// ---------------------------------------------------------------------------
// loginServidor
// ---------------------------------------------------------------------------

describe('loginServidor', () => {
  it('CPF inexistente retorna erro genérico sem vazar existência (Req 8.8)', async () => {
    prismaMock.servidor.findUnique.mockResolvedValue(null);

    await expect(loginServidor(CPF, 'qualquer', IP)).rejects.toMatchObject({
      statusCode: 401,
      code: ErrorCodes.INVALID_CREDENTIALS,
      message: 'CPF ou senha inválidos',
    });
    // Nenhuma tentativa registrada porque a conta não existe.
    expect(prismaMock.servidor.update).not.toHaveBeenCalled();
  });

  it('conta inativa retorna a mesma mensagem genérica', async () => {
    prismaMock.servidor.findUnique.mockResolvedValue(makeServidor({ ativo: false }));

    await expect(loginServidor(CPF, 'qualquer', IP)).rejects.toMatchObject({
      statusCode: 401,
      code: ErrorCodes.INVALID_CREDENTIALS,
      message: 'CPF ou senha inválidos',
    });
  });

  it('senha incorreta incrementa o contador de tentativas', async () => {
    prismaMock.servidor.findUnique.mockResolvedValue(makeServidor({ tentativasLogin: 2 }));
    bcryptCompareMock.mockResolvedValue(false);

    await expect(loginServidor(CPF, 'errada', IP)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CREDENTIALS,
    });

    expect(prismaMock.servidor.update).toHaveBeenCalledWith({
      where: { id: 'srv-1' },
      data: { tentativasLogin: 3 },
    });
    expect(prismaMock.servidor.findMany).not.toHaveBeenCalled();
  });

  it('5ª tentativa incorreta bloqueia por 30min e notifica administradores (Req 8.5)', async () => {
    prismaMock.servidor.findUnique.mockResolvedValue(makeServidor({ tentativasLogin: 4 }));
    bcryptCompareMock.mockResolvedValue(false);
    prismaMock.servidor.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

    const antes = Date.now();
    await expect(loginServidor(CPF, 'errada', IP)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CREDENTIALS,
    });

    // Bloqueio persistido com contador zerado e bloqueadoAte ~30min à frente.
    expect(prismaMock.servidor.update).toHaveBeenCalledTimes(1);
    const updateArg = prismaMock.servidor.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'srv-1' });
    expect(updateArg.data.tentativasLogin).toBe(0);
    expect(updateArg.data.bloqueadoAte).toBeInstanceOf(Date);
    const deltaMs = updateArg.data.bloqueadoAte.getTime() - antes;
    expect(deltaMs).toBeGreaterThanOrEqual(29 * 60_000);
    expect(deltaMs).toBeLessThanOrEqual(31 * 60_000);

    // Administradores consultados e notificados.
    expect(prismaMock.servidor.findMany).toHaveBeenCalledWith({
      where: { nivelAcesso: NivelAcesso.ADMINISTRADOR, ativo: true },
      select: { id: true },
    });
    expect(prismaMock.notificacao.createMany).toHaveBeenCalledTimes(1);
    const notifArg = prismaMock.notificacao.createMany.mock.calls[0][0];
    expect(notifArg.data).toHaveLength(2);
    expect(notifArg.data[0].servidorId).toBe('admin-1');
  });

  it('conta bloqueada é rejeitada com tempo restante (Req 8.5)', async () => {
    const bloqueadoAte = new Date(Date.now() + 12 * 60_000);
    prismaMock.servidor.findUnique.mockResolvedValue(makeServidor({ bloqueadoAte }));

    let caught: unknown;
    try {
      await loginServidor(CPF, 'qualquer', IP);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AppError);
    const appErr = caught as AppError;
    expect(appErr.statusCode).toBe(423);
    expect(appErr.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    expect(appErr.message).toMatch(/12 minuto/);
    // Não chega a comparar a senha.
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  it('login com sucesso zera contadores, embute nivel+permissions no token e registra acesso', async () => {
    prismaMock.servidor.findUnique.mockResolvedValue(
      makeServidor({ tentativasLogin: 3, senhaTemporaria: false }),
    );
    bcryptCompareMock.mockResolvedValue(true);
    prismaMock.permissaoServidor.findMany.mockResolvedValue([
      { permissao: 'visualizar' },
      { permissao: 'editar' },
    ]);

    const result = await loginServidor(CPF, 'correta', IP);

    // Reset de contadores e bloqueio.
    expect(prismaMock.servidor.update).toHaveBeenCalledWith({
      where: { id: 'srv-1' },
      data: { tentativasLogin: 0, bloqueadoAte: null },
    });

    // Token assinado com role servidor, nivel e permissões granulares.
    expect(signTokenMock).toHaveBeenCalledWith({
      sub: 'srv-1',
      role: 'servidor',
      nivel: NivelAcesso.ANALISTA,
      permissions: ['visualizar', 'editar'],
    });

    // Acesso registrado no histórico + auditoria.
    expect(prismaMock.acessoHistorico.create).toHaveBeenCalledWith({
      data: { servidorId: 'srv-1', enderecoIp: IP },
    });
    expect(registrarMock).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      token: 'signed.jwt.token',
      servidor: {
        id: 'srv-1',
        nome: 'Maria Servidora',
        nivelAcesso: NivelAcesso.ANALISTA,
        senhaTemporaria: false,
      },
      mustChangePassword: false,
    });
  });

  it('login com senha temporária sinaliza mustChangePassword (Req 21.3)', async () => {
    prismaMock.servidor.findUnique.mockResolvedValue(makeServidor({ senhaTemporaria: true }));
    bcryptCompareMock.mockResolvedValue(true);

    const result = await loginServidor(CPF, 'temporaria', IP);

    expect(result.mustChangePassword).toBe(true);
    expect(result.servidor.senhaTemporaria).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// logoutServidor
// ---------------------------------------------------------------------------

describe('logoutServidor', () => {
  it('adiciona o jti à blacklist com a expiração informada', async () => {
    await logoutServidor('jti-123', 1_700_000_000);
    expect(blacklistTokenMock).toHaveBeenCalledWith('jti-123', 1_700_000_000);
  });
});

// ---------------------------------------------------------------------------
// trocarSenha
// ---------------------------------------------------------------------------

describe('trocarSenha', () => {
  it('rejeita quando a senha atual está incorreta', async () => {
    prismaMock.servidor.findUnique.mockResolvedValue({
      id: 'srv-1',
      senhaHash: '$2a$12$hash',
    });
    bcryptCompareMock.mockResolvedValue(false);

    await expect(trocarSenha('srv-1', 'errada', 'novaSenha123')).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.INVALID_CREDENTIALS,
      field: 'senhaAtual',
    });
    expect(prismaMock.servidor.update).not.toHaveBeenCalled();
  });

  it('sucesso faz hash da nova senha e limpa senhaTemporaria (Req 21.3)', async () => {
    prismaMock.servidor.findUnique.mockResolvedValue({
      id: 'srv-1',
      senhaHash: '$2a$12$hash',
    });
    bcryptCompareMock.mockResolvedValue(true);
    bcryptHashMock.mockResolvedValue('$2a$12$novohash');

    await trocarSenha('srv-1', 'atualCorreta', 'novaSenhaSegura');

    expect(bcryptHashMock).toHaveBeenCalledWith('novaSenhaSegura', 12);
    expect(prismaMock.servidor.update).toHaveBeenCalledWith({
      where: { id: 'srv-1' },
      data: { senhaHash: '$2a$12$novohash', senhaTemporaria: false },
    });
  });
});
