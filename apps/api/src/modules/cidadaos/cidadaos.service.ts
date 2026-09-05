import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient, Cidadao, AcessoHistorico } from '@prisma/client';
import { ErrorCodes, StatusProcesso } from '@auditar/shared';
import { prisma as realPrisma } from '../../config/database.js';
import { redis as realRedis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { badRequest, notFound, validarCPF, desformatarCPF, formatarCPF } from '../../utils/index.js';
import { registrar as realRegistrar } from '../auditoria/index.js';
import type { RegistrarAuditoriaDto } from '../auditoria/index.js';
import { enviarConfirmacaoNovoEmail } from './cidadaos.email.js';
import type { EditarPerfilInput } from './cidadaos.schema.js';

/**
 * Serviço de Gestão de Conta do Cidadão (Req. 7).
 *
 * - Perfil sem `senhaHash` (nunca exposto).
 * - Edição de perfil: campos permitidos apenas; CPF/e-mail imutáveis por aqui.
 * - Alteração de e-mail: token UUID no Redis (`email:change:{token}`, TTL 24h),
 *   e-mail de confirmação enviado ao NOVO endereço; o e-mail anterior permanece
 *   ativo até a confirmação (Req. 7.2, 7.8).
 * - Alteração de senha: exige a senha atual (bcrypt.compare); mensagem de erro
 *   genérica sem revelar a senha (Req. 7.4).
 * - Histórico: últimos 10 acessos em ordem decrescente (Req. 7.5).
 */

const MODULO = 'cidadaos';

/** Prefixo da chave Redis do token de alteração de e-mail. */
export const EMAIL_CHANGE_KEY_PREFIX = 'email:change:';

/** TTL do token de alteração de e-mail: 24 horas (Req. 7.2, 7.8). */
export const EMAIL_CHANGE_TTL_SECONDS = 86_400;

/** Quantidade máxima de acessos retornados no histórico (Req. 7.5). */
export const HISTORICO_ACESSOS_LIMITE = 10;

/**
 * Prefixo da chave Redis que marca uma solicitação de exclusão de conta.
 * O valor armazenado é o timestamp ISO da solicitação (Req. 7.6, 20.6).
 */
export const EXCLUSAO_KEY_PREFIX = 'exclusao:conta:';

/**
 * Conjunto ordenado (ZSET) que indexa as solicitações de exclusão pendentes.
 * `member = cidadaoId`, `score = timestamp da solicitação em ms` — permite ao
 * `LimpezaWorker` varrer eficientemente as solicitações antigas.
 */
export const EXCLUSAO_PENDENTES_SET = 'exclusoes:pendentes';

/**
 * TTL do marcador de exclusão: 60 dias. Fornece uma rede de segurança caso o
 * worker não processe a anonimização (que ocorre aos 30 dias, Req. 20.6).
 */
export const EXCLUSAO_TTL_SECONDS = 60 * 24 * 60 * 60;

/** Status considerados "encerrados" — não bloqueiam a exclusão (Req. 7.7). */
export const STATUS_ENCERRADOS: readonly string[] = [
  StatusProcesso.FINALIZADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.APROVADO,
];

/** Prazo legal (LGPD) para processamento da solicitação: 15 dias úteis (Req. 7.6). */
export const EXCLUSAO_PRAZO_DIAS_UTEIS = 15;

/** Monta a chave Redis do marcador de exclusão para um cidadão. */
export function montarChaveExclusao(cidadaoId: string): string {
  return `${EXCLUSAO_KEY_PREFIX}${cidadaoId}`;
}

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa as instâncias reais por padrão)
// ---------------------------------------------------------------------------

/** Contrato mínimo do Redis usado pelo serviço. */
export interface CidadaosCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  /** Adiciona um membro ao conjunto ordenado de exclusões pendentes. */
  zadd(key: string, score: number, member: string): Promise<unknown>;
}

/** Função de envio do e-mail de confirmação de novo e-mail (injetável). */
export type EnviarConfirmacaoEmailFn = typeof enviarConfirmacaoNovoEmail;

export interface CidadaosDeps {
  prisma: Pick<PrismaClient, 'cidadao' | 'acessoHistorico' | 'processo'>;
  redis: CidadaosCache;
  auditar: (dto: RegistrarAuditoriaDto) => Promise<void>;
  enviarConfirmacaoEmail: EnviarConfirmacaoEmailFn;
  /** Gerador de token (uuid v4 por padrão). */
  gerarToken: () => string;
}

function resolveDeps(deps?: Partial<CidadaosDeps>): CidadaosDeps {
  return {
    prisma: deps?.prisma ?? (realPrisma as unknown as CidadaosDeps['prisma']),
    redis: deps?.redis ?? (realRedis as unknown as CidadaosCache),
    auditar: deps?.auditar ?? realRegistrar,
    enviarConfirmacaoEmail: deps?.enviarConfirmacaoEmail ?? enviarConfirmacaoNovoEmail,
    gerarToken: deps?.gerarToken ?? (() => randomUUID()),
  };
}

/** Ator que realiza a operação (extraído de req.user + ip pelo controller). */
export interface AtorCidadao {
  cidadaoId: string;
  enderecoIp: string;
}

/** Perfil do cidadão sem o hash da senha — jamais exposto ao cliente. */
export type PerfilCidadao = Omit<Cidadao, 'senhaHash'>;

/** Item do histórico de acessos exibido ao cidadão (Req. 7.5). */
export interface AcessoResumo {
  data: string;
  hora: string;
  ip: string;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Remove `senhaHash` do registro do cidadão. */
function stripSenhaHash(cidadao: Cidadao): PerfilCidadao {
  const { senhaHash: _omit, ...perfil } = cidadao;
  return perfil;
}

/** Monta a chave Redis do token de alteração de e-mail. */
function montarChaveEmailChange(token: string): string {
  return `${EMAIL_CHANGE_KEY_PREFIX}${token}`;
}

/** Estrutura persistida no Redis para a alteração de e-mail. */
interface EmailChangePayload {
  cidadaoId: string;
  novoEmail: string;
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

/**
 * Retorna os dados do perfil do cidadão autenticado, SEM o hash da senha.
 * Lança `notFound` quando o cidadão não existe.
 */
export async function obterPerfil(
  cidadaoId: string,
  deps?: Partial<CidadaosDeps>,
): Promise<PerfilCidadao> {
  const { prisma } = resolveDeps(deps);

  const cidadao = await prisma.cidadao.findUnique({ where: { id: cidadaoId } });
  if (!cidadao) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Cidadão não encontrado');
  }

  return stripSenhaHash(cidadao);
}

/**
 * Edita os campos permitidos do perfil (Req. 7.1). CPF e e-mail são imutáveis
 * por este fluxo. Registra a ação no Módulo de Auditoria e retorna o perfil
 * atualizado sem o hash da senha.
 */
export async function editarPerfil(
  cidadaoId: string,
  dto: EditarPerfilInput,
  ator: AtorCidadao,
  deps?: Partial<CidadaosDeps>,
): Promise<PerfilCidadao> {
  const { prisma, auditar } = resolveDeps(deps);

  const atual = await prisma.cidadao.findUnique({ where: { id: cidadaoId } });
  if (!atual) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Cidadão não encontrado');
  }

  // Apenas campos permitidos; CPF e e-mail nunca são atualizados aqui.
  const atualizado = await prisma.cidadao.update({
    where: { id: cidadaoId },
    data: {
      nome: dto.nome,
      telefone: dto.telefone,
      logradouro: dto.logradouro,
      numero: dto.numero,
      cep: dto.cep,
      cidade: dto.cidade,
      estado: dto.estado,
    },
  });

  await auditar({
    ator: 'cidadao',
    atorCidadaoId: cidadaoId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'editar_perfil',
    modulo: MODULO,
    objetoId: cidadaoId,
    tipoObjeto: 'Cidadao',
    valorAnterior: stripSenhaHash(atual),
    valorPosterior: stripSenhaHash(atualizado),
  });

  return stripSenhaHash(atualizado);
}

/**
 * Solicita a alteração de e-mail (Req. 7.2). Rejeita se o novo e-mail já estiver
 * em uso por OUTRA conta. Gera um token UUID, armazena `{cidadaoId, novoEmail}`
 * no Redis (TTL 24h) e envia o e-mail de confirmação para o NOVO endereço. O
 * e-mail anterior permanece ativo até a confirmação. Registra em auditoria.
 */
export async function solicitarAlteracaoEmail(
  cidadaoId: string,
  novoEmail: string,
  ator: AtorCidadao,
  deps?: Partial<CidadaosDeps>,
): Promise<void> {
  const { prisma, redis, auditar, enviarConfirmacaoEmail, gerarToken } = resolveDeps(deps);

  const cidadao = await prisma.cidadao.findUnique({ where: { id: cidadaoId } });
  if (!cidadao) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Cidadão não encontrado');
  }

  const normalizado = novoEmail.trim().toLowerCase();

  // Verifica se o novo e-mail já pertence a outra conta.
  const existente = await prisma.cidadao.findUnique({ where: { email: normalizado } });
  if (existente && existente.id !== cidadaoId) {
    throw badRequest(ErrorCodes.VALIDATION_ERROR, 'E-mail já está em uso', 'novoEmail');
  }

  const token = gerarToken();
  const payload: EmailChangePayload = { cidadaoId, novoEmail: normalizado };
  await redis.set(
    montarChaveEmailChange(token),
    JSON.stringify(payload),
    'EX',
    EMAIL_CHANGE_TTL_SECONDS,
  );

  await enviarConfirmacaoEmail(cidadao.nome, normalizado, token);

  await auditar({
    ator: 'cidadao',
    atorCidadaoId: cidadaoId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'solicitar_alteracao_email',
    modulo: MODULO,
    objetoId: cidadaoId,
    tipoObjeto: 'Cidadao',
    valorAnterior: cidadao.email,
    valorPosterior: normalizado,
  });
}

/**
 * Confirma a alteração de e-mail (Req. 7.2). Lê o token no Redis; se ausente ou
 * expirado, rejeita com `TOKEN_EXPIRED` (Req. 7.8), mantendo o e-mail anterior.
 * Caso válido, atualiza o e-mail do cidadão e remove o token (uso único).
 */
export async function confirmarAlteracaoEmail(
  token: string,
  deps?: Partial<CidadaosDeps>,
): Promise<PerfilCidadao> {
  const { prisma, redis } = resolveDeps(deps);

  const chave = montarChaveEmailChange(token);
  const raw = await redis.get(chave);
  if (!raw) {
    throw badRequest(
      ErrorCodes.TOKEN_EXPIRED,
      'Link de confirmação inválido ou expirado; a alteração foi cancelada',
      'token',
    );
  }

  let payload: EmailChangePayload;
  try {
    payload = JSON.parse(raw) as EmailChangePayload;
  } catch {
    await redis.del(chave);
    throw badRequest(
      ErrorCodes.TOKEN_EXPIRED,
      'Link de confirmação inválido ou expirado; a alteração foi cancelada',
      'token',
    );
  }

  const atualizado = await prisma.cidadao.update({
    where: { id: payload.cidadaoId },
    data: { email: payload.novoEmail },
  });

  await redis.del(chave);

  return stripSenhaHash(atualizado);
}

/**
 * Altera a senha do cidadão (Req. 7.3, 7.4). Exige a senha atual (bcrypt.compare);
 * quando incorreta, rejeita com mensagem genérica sem revelar a senha (Req. 7.4).
 * A nova senha deve ter entre 8 e 64 caracteres. Registra em auditoria (sem
 * expor as senhas).
 */
export async function alterarSenha(
  cidadaoId: string,
  senhaAtual: string,
  novaSenha: string,
  ator: AtorCidadao,
  deps?: Partial<CidadaosDeps>,
): Promise<void> {
  const { prisma, auditar } = resolveDeps(deps);

  const cidadao = await prisma.cidadao.findUnique({ where: { id: cidadaoId } });
  if (!cidadao) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Cidadão não encontrado');
  }

  const senhaCorreta = await bcrypt.compare(senhaAtual, cidadao.senhaHash);
  if (!senhaCorreta) {
    // Não revela nada sobre a senha atual (Req. 7.4).
    throw badRequest(ErrorCodes.INVALID_CREDENTIALS, 'Senha atual incorreta', 'senhaAtual');
  }

  if (novaSenha.length < 8 || novaSenha.length > 64) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'A nova senha deve conter entre 8 e 64 caracteres',
      'novaSenha',
    );
  }

  const novaSenhaHash = await bcrypt.hash(novaSenha, env.BCRYPT_ROUNDS);
  await prisma.cidadao.update({
    where: { id: cidadaoId },
    data: { senhaHash: novaSenhaHash },
  });

  await auditar({
    ator: 'cidadao',
    atorCidadaoId: cidadaoId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'alterar_senha',
    modulo: MODULO,
    objetoId: cidadaoId,
    tipoObjeto: 'Cidadao',
  });
}

/** Formata um registro de acesso em data/hora/ip para exibição (Req. 7.5). */
function formatarAcesso(acesso: Pick<AcessoHistorico, 'acessadoEm' | 'enderecoIp'>): AcessoResumo {
  const quando = acesso.acessadoEm instanceof Date ? acesso.acessadoEm : new Date(acesso.acessadoEm);
  const iso = quando.toISOString();
  return {
    data: iso.slice(0, 10), // AAAA-MM-DD
    hora: iso.slice(11, 19), // HH:MM:SS
    ip: acesso.enderecoIp,
  };
}

/**
 * Retorna os últimos 10 acessos do cidadão em ordem cronológica decrescente,
 * com data, hora e endereço IP de cada acesso (Req. 7.5).
 */
export async function historicoAcessos(
  cidadaoId: string,
  deps?: Partial<CidadaosDeps>,
): Promise<AcessoResumo[]> {
  const { prisma } = resolveDeps(deps);

  const acessos = await prisma.acessoHistorico.findMany({
    where: { cidadaoId },
    orderBy: { acessadoEm: 'desc' },
    take: HISTORICO_ACESSOS_LIMITE,
  });

  return acessos.map(formatarAcesso);
}

// ---------------------------------------------------------------------------
// Exclusão de conta (LGPD) — Req. 7.6, 7.7, 20.6
// ---------------------------------------------------------------------------

/** Resumo de um processo em andamento exibido na confirmação de exclusão (Req. 7.7). */
export interface ProcessoEmAndamento {
  protocolo: string;
  tipoProcesso: string;
}

/**
 * Resultado da solicitação de exclusão de conta.
 *
 * - `requerConfirmacao: true` — há processos em andamento e o cidadão ainda não
 *   confirmou; a lista é devolvida e NADA é registrado (Req. 7.7).
 * - `requerConfirmacao: false` — a solicitação foi registrada; `agendadoPara`
 *   indica o prazo-limite (15 dias úteis) para processamento (Req. 7.6).
 */
export interface ResultadoExclusao {
  requerConfirmacao: boolean;
  processos: ProcessoEmAndamento[];
  /** ISO date do prazo-limite de processamento, quando registrado. */
  agendadoPara?: string;
}

/**
 * Lista os processos do cidadão que ainda estão em andamento — ou seja, cujo
 * status NÃO está entre os encerrados (finalizado, rejeitado, aprovado). Cada
 * item traz o protocolo e o nome do tipo de processo (Req. 7.7).
 */
export async function listarProcessosEmAndamento(
  cidadaoId: string,
  deps?: Partial<CidadaosDeps>,
): Promise<ProcessoEmAndamento[]> {
  const { prisma } = resolveDeps(deps);

  const processos = await prisma.processo.findMany({
    where: {
      cidadaoId,
      status: { notIn: STATUS_ENCERRADOS as string[] },
    },
    select: {
      protocolo: true,
      tipoProcesso: { select: { nome: true } },
    },
  });

  return processos.map((p) => ({
    protocolo: p.protocolo,
    tipoProcesso: p.tipoProcesso?.nome ?? '',
  }));
}

/**
 * Adiciona `dias` dias úteis à data informada (sábados e domingos não contam).
 * Feriados não são considerados aqui — a data resultante é um limite superior
 * conservador para exibição ao cidadão (Req. 7.6).
 */
function adicionarDiasUteis(base: Date, dias: number): Date {
  const resultado = new Date(base.getTime());
  let restantes = dias;
  while (restantes > 0) {
    resultado.setUTCDate(resultado.getUTCDate() + 1);
    const diaSemana = resultado.getUTCDay();
    if (diaSemana !== 0 && diaSemana !== 6) {
      restantes -= 1;
    }
  }
  return resultado;
}

/**
 * Solicita a exclusão da conta do cidadão conforme a LGPD (Req. 7.6, 7.7).
 *
 * 1. Busca os processos em andamento. Se houver algum e `confirmar` for falso,
 *    retorna `{ requerConfirmacao: true, processos }` SEM registrar nada — o
 *    Portal deve exibir os impactos e exigir confirmação explícita (Req. 7.7).
 * 2. Com a confirmação (ou sem processos em andamento), grava o marcador no
 *    Redis (`exclusao:conta:{id}` = timestamp ISO, TTL 60 dias), indexa a
 *    solicitação no ZSET `exclusoes:pendentes` e registra em auditoria.
 * 3. Retorna o prazo-limite de processamento (15 dias úteis) para exibição — a
 *    anonimização efetiva ocorre aos 30 dias via `LimpezaWorker` (Req. 20.6).
 */
export async function solicitarExclusao(
  cidadaoId: string,
  confirmar: boolean,
  ator: AtorCidadao,
  deps?: Partial<CidadaosDeps>,
): Promise<ResultadoExclusao> {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const cidadao = await prisma.cidadao.findUnique({ where: { id: cidadaoId } });
  if (!cidadao) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Cidadão não encontrado');
  }

  const emAndamento = await listarProcessosEmAndamento(cidadaoId, deps);

  // Há processos em andamento e o cidadão ainda não confirmou: exibir impactos
  // e exigir confirmação explícita, sem registrar a solicitação (Req. 7.7).
  if (emAndamento.length > 0 && !confirmar) {
    return { requerConfirmacao: true, processos: emAndamento };
  }

  const agora = new Date();
  const agoraIso = agora.toISOString();

  await redis.set(montarChaveExclusao(cidadaoId), agoraIso, 'EX', EXCLUSAO_TTL_SECONDS);
  await redis.zadd(EXCLUSAO_PENDENTES_SET, agora.getTime(), cidadaoId);

  await auditar({
    ator: 'cidadao',
    atorCidadaoId: cidadaoId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'solicitar_exclusao_conta',
    modulo: MODULO,
    objetoId: cidadaoId,
    tipoObjeto: 'Cidadao',
    valorPosterior: { solicitadoEm: agoraIso, processosEmAndamento: emAndamento.length },
  });

  const agendadoPara = adicionarDiasUteis(agora, EXCLUSAO_PRAZO_DIAS_UTEIS).toISOString();

  return { requerConfirmacao: false, processos: emAndamento, agendadoPara };
}

// ---------------------------------------------------------------------------
// Busca de Cidadão por CPF para abertura administrativa (Req. 23.2, 23.3)
// ---------------------------------------------------------------------------

/**
 * Dados de identificação do Cidadão retornados na busca por CPF para a abertura
 * de um Processo pelo Servidor (Req. 23.2). Contém apenas os campos necessários
 * para o Servidor confirmar o Cidadão antes de prosseguir — nunca a senha nem
 * dados sensíveis adicionais.
 */
export interface IdentificacaoCidadao {
  id: string;
  nome: string;
  /** CPF apenas com os 11 dígitos (fonte da verdade). */
  cpf: string;
  /** CPF formatado para exibição (`000.000.000-00`). */
  cpfFormatado: string;
  email: string;
  telefone: string;
  ativo: boolean;
}

/**
 * Localiza um Cidadão pelo CPF para a abertura de Processo no Painel
 * Administrativo (Req. 23.2, 23.3).
 *
 * - Valida o CPF (11 dígitos numéricos + dígitos verificadores). CPF inválido
 *   → `VALIDATION_ERROR` (400).
 * - Cidadão inexistente → `notFound` (404) com `CIDADAO_NAO_ENCONTRADO`,
 *   sinalizando ao Portal que o cadastro de um novo Cidadão pode ser oferecido
 *   (Req. 23.3).
 * - Encontrado → retorna os dados de identificação (sem `senhaHash`).
 */
export async function buscarPorCpf(
  cpf: string,
  deps?: Partial<CidadaosDeps>,
): Promise<IdentificacaoCidadao> {
  const { prisma } = resolveDeps(deps);

  const cpfLimpo = desformatarCPF(cpf ?? '');
  if (!validarCPF(cpfLimpo)) {
    throw badRequest(ErrorCodes.CPF_INVALIDO, 'CPF inválido', 'cpf');
  }

  const cidadao = await prisma.cidadao.findUnique({ where: { cpf: cpfLimpo } });
  if (!cidadao) {
    // 404 (VAL_001) sinaliza ao Portal que o cadastro de um novo Cidadão pode
    // ser oferecido antes de prosseguir (Req. 23.3).
    throw notFound(
      ErrorCodes.VALIDATION_ERROR,
      'Cidadão não encontrado; é possível cadastrar um novo Cidadão',
    );
  }

  return {
    id: cidadao.id,
    nome: cidadao.nome,
    cpf: cidadao.cpf,
    cpfFormatado: formatarCPF(cidadao.cpf),
    email: cidadao.email,
    telefone: cidadao.telefone,
    ativo: cidadao.ativo,
  };
}
