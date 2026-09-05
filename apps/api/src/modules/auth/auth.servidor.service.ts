import bcrypt from 'bcryptjs';
import { NivelAcesso, CanalNotificacao, TipoEvento, ErrorCodes } from '@auditar/shared';
import { prisma } from '../../config/database.js';
import { signToken, blacklistToken } from '../../lib/jwt.js';
import { desformatarCPF, AppError, unauthorized, badRequest } from '../../utils/index.js';
import { registrar } from '../../modules/auditoria/index.js';

/**
 * Serviço de autenticação de Servidores.
 *
 * Regras (Req. 8):
 *  - Login com CPF + senha; mensagem de erro genérica tanto para CPF inexistente
 *    quanto para senha incorreta (Req. 8.8) — não revela existência da conta.
 *  - Bloqueio após 5 tentativas consecutivas por 30 minutos, com notificação ao
 *    Administrador (Req. 8.5).
 *  - No login bem-sucedido, carrega as permissões granulares no JWT (Req. 8.3/8.6)
 *    e registra o acesso em `AcessoHistorico`.
 *  - Timeout de 60 minutos de inatividade (Req. 8.7) é aplicado pela expiração do
 *    JWT + middleware de autenticação; o frontend cuida da renovação/inatividade.
 *    Nenhum cron adicional é necessário no backend para este fluxo.
 *  - Primeiro acesso com senha temporária exige troca antes de outras ações
 *    (Req. 21.3): `mustChangePassword` é retornado no login e `trocarSenha` limpa
 *    a flag `senhaTemporaria`.
 */

/** Número de tentativas consecutivas que dispara o bloqueio (Req. 8.5). */
const MAX_TENTATIVAS = 5;
/** Duração do bloqueio em minutos (Req. 8.5). */
const BLOQUEIO_MINUTOS = 30;
/** Custo do bcrypt para (re)hash de senhas. */
const BCRYPT_ROUNDS = 12;

/** Mensagem genérica única para credenciais inválidas / conta inexistente / inativa (Req. 8.8). */
const MSG_CREDENCIAIS = 'CPF ou senha inválidos';

export interface LoginServidorResult {
  token: string;
  servidor: {
    id: string;
    nome: string;
    nivelAcesso: number;
    senhaTemporaria: boolean;
  };
  /** true quando a senha é temporária e precisa ser trocada antes de outras ações (Req. 21.3). */
  mustChangePassword: boolean;
}

/** Calcula os minutos inteiros restantes de bloqueio a partir de agora (arredonda para cima). */
function minutosRestantes(bloqueadoAte: Date, agora: Date): number {
  const diffMs = bloqueadoAte.getTime() - agora.getTime();
  return Math.max(1, Math.ceil(diffMs / 60_000));
}

/**
 * Notifica todos os Administradores sobre o bloqueio de um Servidor (Req. 8.5).
 * Cria uma notificação de painel por Administrador ativo, contendo a identificação
 * do Servidor e o horário do bloqueio. Falhas aqui não devem interromper o fluxo
 * de login (o bloqueio já foi persistido).
 */
async function notificarAdministradoresBloqueio(
  servidor: { id: string; nome: string; cpf: string },
  bloqueadoEmUtc: Date,
): Promise<void> {
  try {
    const administradores = await prisma.servidor.findMany({
      where: { nivelAcesso: NivelAcesso.ADMINISTRADOR, ativo: true },
      select: { id: true },
    });

    if (administradores.length === 0) {
      return;
    }

    const conteudo = JSON.stringify({
      mensagem: 'Conta de servidor bloqueada por tentativas de login malsucedidas',
      servidorId: servidor.id,
      servidorNome: servidor.nome,
      bloqueadoEm: bloqueadoEmUtc.toISOString(),
    });

    await prisma.notificacao.createMany({
      data: administradores.map((admin: { id: string }) => ({
        servidorId: admin.id,
        tipoEvento: TipoEvento.ATRIBUICAO,
        canal: CanalNotificacao.PAINEL,
        conteudo,
      })),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'auth.servidor',
        event: 'notificar_admin_bloqueio_falhou',
        servidorId: servidor.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Autentica um Servidor por CPF + senha.
 *
 * @param cpf CPF informado (pode vir formatado; será normalizado para 11 dígitos).
 * @param senha senha em texto puro.
 * @param ip endereço IP de origem, para auditoria e histórico de acessos.
 * @throws AppError 401 genérico quando CPF não existe, conta inativa ou senha incorreta (Req. 8.8).
 * @throws AppError 423 (ACCOUNT_LOCKED) quando a conta está bloqueada, com minutos restantes.
 */
export async function loginServidor(
  cpf: string,
  senha: string,
  ip: string,
): Promise<LoginServidorResult> {
  const cpfNormalizado = desformatarCPF(cpf);
  const agora = new Date();

  const servidor = await prisma.servidor.findUnique({
    where: { cpf: cpfNormalizado },
  });

  // Req. 8.8: CPF inexistente → mesma mensagem genérica de credenciais inválidas.
  if (!servidor) {
    throw unauthorized(MSG_CREDENCIAIS);
  }

  // Conta inativa → mesma mensagem genérica (não revela estado da conta).
  if (!servidor.ativo) {
    throw unauthorized(MSG_CREDENCIAIS);
  }

  // Conta bloqueada e ainda dentro do período de bloqueio (Req. 8.5).
  if (servidor.bloqueadoAte && servidor.bloqueadoAte.getTime() > agora.getTime()) {
    const restante = minutosRestantes(servidor.bloqueadoAte, agora);
    throw new AppError(
      423,
      ErrorCodes.ACCOUNT_LOCKED,
      `Conta bloqueada temporariamente. Tente novamente em ${restante} minuto(s).`,
    );
  }

  const senhaCorreta = await bcrypt.compare(senha, servidor.senhaHash);

  if (!senhaCorreta) {
    const tentativas = servidor.tentativasLogin + 1;

    if (tentativas >= MAX_TENTATIVAS) {
      const bloqueadoAte = new Date(agora.getTime() + BLOQUEIO_MINUTOS * 60_000);
      await prisma.servidor.update({
        where: { id: servidor.id },
        // Zera o contador ao bloquear: após o desbloqueio recomeça do zero.
        data: { tentativasLogin: 0, bloqueadoAte },
      });
      await notificarAdministradoresBloqueio(servidor, agora);
    } else {
      await prisma.servidor.update({
        where: { id: servidor.id },
        data: { tentativasLogin: tentativas },
      });
    }

    // Req. 8.8: senha incorreta → mesma mensagem genérica.
    throw unauthorized(MSG_CREDENCIAIS);
  }

  // Sucesso: zera contadores e limpa bloqueio.
  await prisma.servidor.update({
    where: { id: servidor.id },
    data: { tentativasLogin: 0, bloqueadoAte: null },
  });

  // Carrega permissões granulares concedidas (Req. 8.3/8.6) para embutir no JWT.
  const permissoesConcedidas = await prisma.permissaoServidor.findMany({
    where: { servidorId: servidor.id, concedida: true },
    select: { permissao: true },
  });
  const permissions = permissoesConcedidas.map((p: { permissao: string }) => p.permissao);

  const token = signToken({
    sub: servidor.id,
    role: 'servidor',
    nivel: servidor.nivelAcesso,
    permissions,
  });

  // Registra o acesso no histórico.
  await prisma.acessoHistorico.create({
    data: { servidorId: servidor.id, enderecoIp: ip },
  });

  // Auditoria assíncrona do login.
  await registrar({
    ator: 'servidor',
    atorServidorId: servidor.id,
    enderecoIp: ip,
    tipoAcao: 'login',
    modulo: 'auth',
    objetoId: servidor.id,
    tipoObjeto: 'Servidor',
  });

  return {
    token,
    servidor: {
      id: servidor.id,
      nome: servidor.nome,
      nivelAcesso: servidor.nivelAcesso,
      senhaTemporaria: servidor.senhaTemporaria,
    },
    mustChangePassword: servidor.senhaTemporaria,
  };
}

/**
 * Encerra a sessão do Servidor adicionando o `jti` do token à blacklist (Req. 8).
 *
 * @param jti identificador do JWT.
 * @param exp expiração do token em epoch seconds.
 */
export async function logoutServidor(jti: string, exp: number): Promise<void> {
  await blacklistToken(jti, exp);
}

/**
 * Troca a senha do Servidor. Exige a senha atual correta e define uma nova senha,
 * limpando a flag `senhaTemporaria` (obrigatório no primeiro acesso — Req. 21.3).
 *
 * @param servidorId id do servidor autenticado.
 * @param senhaAtual senha atual em texto puro.
 * @param novaSenha nova senha em texto puro (já validada pelo schema: 8–64 chars).
 * @throws AppError 401 genérico quando o servidor não existe.
 * @throws AppError 400 (INVALID_CREDENTIALS) quando a senha atual está incorreta.
 */
export async function trocarSenha(
  servidorId: string,
  senhaAtual: string,
  novaSenha: string,
): Promise<void> {
  const servidor = await prisma.servidor.findUnique({
    where: { id: servidorId },
    select: { id: true, senhaHash: true },
  });

  if (!servidor) {
    throw unauthorized(MSG_CREDENCIAIS);
  }

  const atualCorreta = await bcrypt.compare(senhaAtual, servidor.senhaHash);
  if (!atualCorreta) {
    throw badRequest(ErrorCodes.INVALID_CREDENTIALS, 'Senha atual incorreta', 'senhaAtual');
  }

  const novaSenhaHash = await bcrypt.hash(novaSenha, BCRYPT_ROUNDS);

  await prisma.servidor.update({
    where: { id: servidor.id },
    data: { senhaHash: novaSenhaHash, senhaTemporaria: false },
  });
}
