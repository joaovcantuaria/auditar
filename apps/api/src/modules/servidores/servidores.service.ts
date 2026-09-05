import { createRequire } from 'node:module';
import { randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { NivelAcesso, ErrorCodes, StatusProcesso, type PaginatedResult } from '@auditar/shared';
import { env } from '../../config/env.js';
import { validarCPF, desformatarCPF } from '../../utils/cpf.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { getPaginationParams, buildPaginatedResult } from '../../utils/paginacao.js';
import { registrar as defaultRegistrar } from '../auditoria/auditoria.service.js';
import type { RegistrarAuditoriaDto } from '../auditoria/auditoria.types.js';
import type {
  CriarServidorDto,
  EditarServidorDto,
  PaginacaoServidorDto,
} from './servidores.schema.js';

/**
 * Serviço do CRUD de Servidores (Painel_Administrativo → Gestão de Servidores).
 *
 * Regras principais (Req. 21):
 *  - Criação exige nome/CPF/email/nível/Unidade; CPF é validado pelos dígitos
 *    verificadores (Req. 21.1) e não pode duplicar conta existente (Req. 21.2).
 *  - No cadastro bem-sucedido, gera uma senha temporária (≥ 8 caracteres),
 *    persiste apenas o hash e envia a senha por email ao endereço institucional,
 *    marcando `senhaTemporaria = true` para exigir troca no primeiro login
 *    (Req. 21.3).
 *  - Edição permite alterar nome, email, telefone, nível e Unidade, porém o CPF
 *    é IMUTÁVEL (Req. 21.5).
 *  - Existe um limite de 3 (env.MAX_ADMINS) contas de Administrador ativas
 *    simultâneas — criar/editar para Administrador acima do limite é rejeitado
 *    (Req. 21.9).
 *
 * As dependências (prisma, mailer, auditar) são injetáveis para facilitar os
 * testes unitários — em produção usam as instâncias reais por padrão.
 */

const MODULO = 'servidores';
const TIPO_OBJETO = 'Servidor';

/** Comprimento da senha temporária gerada (≥ 8 caracteres — Req. 21.3). */
const SENHA_TEMP_TAMANHO = 12;

/** Ator que dispara a operação — usado para registrar a auditoria. */
export interface Ator {
  servidorId: string;
  enderecoIp: string;
}

/** Cliente mínimo de auditoria — permite injetar um mock nos testes. */
export type Auditar = (dto: RegistrarAuditoriaDto) => Promise<void>;

/** Interface mínima do mailer usada pelo serviço (facilita injeção em testes). */
export interface Mailer {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<unknown>;
}

/** Dependências injetáveis do serviço. */
export interface ServidoresDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  fromAddress: string;
  auditar: Auditar;
}

/**
 * Resolve as dependências reais preguiçosamente (lazy). Importar este módulo
 * NÃO deve carregar o Prisma Client nem abrir conexões — só quando uma operação
 * é executada sem dependências injetadas. Mantém os testes (que injetam mocks)
 * independentes da geração do client Prisma.
 */
let cachedDeps: ServidoresDeps | undefined;

function resolveDeps(deps?: ServidoresDeps): ServidoresDeps {
  if (deps) return deps;
  if (!cachedDeps) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as {
      prisma: PrismaClient;
    };
    const { mailer, fromAddress } = requireLocal('../../config/mailer.js') as {
      mailer: Mailer;
      fromAddress: string;
    };
    cachedDeps = { prisma, mailer, fromAddress, auditar: defaultRegistrar };
  }
  return cachedDeps;
}

/** Campos retornados nas leituras — NUNCA inclui `senhaHash` (Req. de segurança). */
const SELECT_SERVIDOR = {
  id: true,
  nome: true,
  cpf: true,
  email: true,
  telefone: true,
  nivelAcesso: true,
  ativo: true,
  senhaTemporaria: true,
  unidadeId: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

/** Monta o DTO base de auditoria para uma ação de servidor sobre um Servidor. */
function auditoriaBase(
  tipoAcao: string,
  ator: Ator,
  objetoId: string,
  extra: Partial<RegistrarAuditoriaDto> = {},
): RegistrarAuditoriaDto {
  return {
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao,
    modulo: MODULO,
    objetoId,
    tipoObjeto: TIPO_OBJETO,
    ...extra,
  };
}

/**
 * Gera uma senha temporária aleatória com no mínimo 8 caracteres (Req. 21.3),
 * garantindo a presença de ao menos uma letra minúscula, uma maiúscula, um
 * dígito e um símbolo, com o restante preenchido por bytes aleatórios.
 */
export function gerarSenhaTemporaria(tamanho: number = SENHA_TEMP_TAMANHO): string {
  const minusculas = 'abcdefghijkmnopqrstuvwxyz';
  const maiusculas = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digitos = '23456789';
  const simbolos = '!@#$%&*?';
  const todos = minusculas + maiusculas + digitos + simbolos;

  const total = Math.max(8, tamanho);
  const obrigatorios = [
    minusculas[randomInt(minusculas.length)],
    maiusculas[randomInt(maiusculas.length)],
    digitos[randomInt(digitos.length)],
    simbolos[randomInt(simbolos.length)],
  ];

  const restante: string[] = [];
  const bytes = randomBytes(total - obrigatorios.length);
  for (let i = 0; i < bytes.length; i += 1) {
    restante.push(todos[bytes[i] % todos.length]);
  }

  // Embaralha (Fisher–Yates) para não deixar os obrigatórios sempre no início.
  const chars = [...obrigatorios, ...restante];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Conta as contas de Administrador ativas (Req. 21.9). Aceita `excluirId` para
 * desconsiderar o próprio Servidor ao promovê-lo na edição.
 */
export async function contarAdminsAtivos(
  prisma: PrismaClient,
  excluirId?: string,
): Promise<number> {
  return prisma.servidor.count({
    where: {
      nivelAcesso: NivelAcesso.ADMINISTRADOR,
      ativo: true,
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
  });
}

/** Filtros aplicados na listagem de Servidores. */
export interface ListarServidoresFiltros extends PaginacaoServidorDto {}

/**
 * Lista os Servidores paginados, com filtros opcionais por nível, Unidade e
 * status ativo. Nunca retorna o `senhaHash`.
 */
export async function listar(
  filtros: ListarServidoresFiltros = {},
  deps?: ServidoresDeps,
): Promise<PaginatedResult<Record<string, unknown>>> {
  const d = resolveDeps(deps);
  const { skip, take, page, pageSize } = getPaginationParams(filtros.page, filtros.pageSize);

  const where: Record<string, unknown> = {};
  if (filtros.nivel !== undefined) where.nivelAcesso = filtros.nivel;
  if (filtros.unidadeId) where.unidadeId = filtros.unidadeId;
  if (filtros.ativo !== undefined) where.ativo = filtros.ativo;

  const [data, total] = await Promise.all([
    d.prisma.servidor.findMany({
      where,
      select: SELECT_SERVIDOR,
      orderBy: { nome: 'asc' },
      skip,
      take,
    }),
    d.prisma.servidor.count({ where }),
  ]);

  return buildPaginatedResult(data as Record<string, unknown>[], total, page, pageSize);
}

/** Resultado da criação: o Servidor (sem hash) + indicação do envio do email. */
export interface CriarServidorResult {
  servidor: Record<string, unknown>;
  senhaEnviada: boolean;
}

/**
 * Cadastra um novo Servidor (Req. 21.1, 21.2, 21.3, 21.9).
 *
 * Fluxo: valida os dígitos do CPF → normaliza → rejeita CPF duplicado →
 * respeita o limite de Administradores → gera senha temporária + hash → cria →
 * envia o email da senha temporária → audita. O envio de email não desfaz o
 * cadastro em caso de falha (Req. 21.4): `senhaEnviada` indica o resultado.
 */
export async function criar(
  dto: CriarServidorDto,
  ator: Ator,
  deps?: ServidoresDeps,
): Promise<CriarServidorResult> {
  const d = resolveDeps(deps);

  // Req. 21.1: valida os dígitos verificadores do CPF.
  if (!validarCPF(dto.cpf)) {
    throw badRequest(ErrorCodes.CPF_INVALIDO, 'CPF inválido', 'cpf');
  }
  const cpfNormalizado = desformatarCPF(dto.cpf);

  // Req. 21.2: rejeita CPF já vinculado a uma conta existente.
  const existenteCpf = await d.prisma.servidor.findUnique({
    where: { cpf: cpfNormalizado },
    select: { id: true },
  });
  if (existenteCpf) {
    throw badRequest(ErrorCodes.CPF_DUPLICADO, 'CPF já vinculado a uma conta existente', 'cpf');
  }

  // Req. 21.9: respeita o limite de Administradores ativos simultâneos.
  if (dto.nivelAcesso === NivelAcesso.ADMINISTRADOR) {
    const admins = await contarAdminsAtivos(d.prisma);
    if (admins >= env.MAX_ADMINS) {
      throw badRequest(
        ErrorCodes.VALIDATION_ERROR,
        `Limite de ${env.MAX_ADMINS} administradores ativos simultâneos atingido`,
        'nivelAcesso',
      );
    }
  }

  // Req. 21.3: gera senha temporária (≥ 8 chars), persiste apenas o hash.
  const senhaTemporaria = gerarSenhaTemporaria();
  const senhaHash = await bcrypt.hash(senhaTemporaria, env.BCRYPT_ROUNDS);

  const servidor = await d.prisma.servidor.create({
    data: {
      nome: dto.nome.trim(),
      cpf: cpfNormalizado,
      email: dto.email.trim(),
      telefone: dto.telefone?.trim(),
      senhaHash,
      nivelAcesso: dto.nivelAcesso,
      senhaTemporaria: true,
      unidadeId: dto.unidadeId.trim(),
    },
    select: SELECT_SERVIDOR,
  });

  // Req. 21.3/21.4: envia a senha temporária por email. Uma falha no envio NÃO
  // desfaz o cadastro — apenas sinaliza `senhaEnviada = false` para o Admin.
  let senhaEnviada = true;
  try {
    await enviarEmailSenhaTemporaria(
      d,
      { nome: dto.nome.trim(), email: dto.email.trim() },
      senhaTemporaria,
    );
  } catch (err) {
    senhaEnviada = false;
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'servidores',
        event: 'envio_senha_temporaria_falhou',
        servidorId: (servidor as { id: string }).id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  await d.auditar(
    auditoriaBase('criar_servidor', ator, (servidor as { id: string }).id, {
      valorPosterior: servidor,
    }),
  );

  return { servidor, senhaEnviada };
}

/**
 * Obtém um Servidor pelo id, incluindo as permissões granulares concedidas
 * (Req. 21.5/8.6). Nunca retorna o `senhaHash`.
 */
export async function obter(id: string, deps?: ServidoresDeps) {
  const d = resolveDeps(deps);
  const servidor = await d.prisma.servidor.findUnique({
    where: { id },
    select: { ...SELECT_SERVIDOR, permissoes: true },
  });
  if (!servidor) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Servidor não encontrado');
  }
  return servidor;
}

/**
 * Edita um Servidor existente (Req. 21.5). O CPF é imutável — o schema de edição
 * nem aceita o campo; se um `cpf` chegar mesmo assim, é ignorado por segurança.
 * Ao promover para Administrador, respeita o limite de ativos (Req. 21.9).
 */
export async function editar(
  id: string,
  dto: EditarServidorDto,
  ator: Ator,
  deps?: ServidoresDeps,
) {
  const d = resolveDeps(deps);

  const existente = await d.prisma.servidor.findUnique({
    where: { id },
    select: SELECT_SERVIDOR,
  });
  if (!existente) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Servidor não encontrado');
  }

  // Req. 21.9: ao promover para Administrador, respeita o limite (desconsiderando
  // o próprio, caso já seja Administrador ativo).
  const jaEraAdmin =
    (existente as { nivelAcesso: number }).nivelAcesso === NivelAcesso.ADMINISTRADOR;
  if (dto.nivelAcesso === NivelAcesso.ADMINISTRADOR && !jaEraAdmin) {
    const admins = await contarAdminsAtivos(d.prisma, id);
    if (admins >= env.MAX_ADMINS) {
      throw badRequest(
        ErrorCodes.VALIDATION_ERROR,
        `Limite de ${env.MAX_ADMINS} administradores ativos simultâneos atingido`,
        'nivelAcesso',
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (dto.nome !== undefined) data.nome = dto.nome.trim();
  if (dto.email !== undefined) data.email = dto.email.trim();
  if (dto.telefone !== undefined) data.telefone = dto.telefone.trim();
  if (dto.nivelAcesso !== undefined) data.nivelAcesso = dto.nivelAcesso;
  if (dto.unidadeId !== undefined) data.unidadeId = dto.unidadeId.trim();
  // CPF nunca é copiado para `data` — imutável (Req. 21.5).

  const servidor = await d.prisma.servidor.update({
    where: { id },
    data,
    select: SELECT_SERVIDOR,
  });

  await d.auditar(
    auditoriaBase('editar_servidor', ator, id, {
      valorAnterior: existente,
      valorPosterior: servidor,
    }),
  );

  return servidor;
}

/** Cor primária do design system usada no template do e-mail. */
const COR_PRIMARIA = '#0066CC';

/** Envia o email com a senha temporária ao endereço institucional (Req. 21.3). */
async function enviarEmailSenhaTemporaria(
  deps: ServidoresDeps,
  destinatario: { nome: string; email: string },
  senhaTemporaria: string,
): Promise<void> {
  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2933;">
    <div style="background: ${COR_PRIMARIA}; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Auditar</h1>
    </div>
    <div style="padding: 24px; background: #ffffff;">
      <p>Olá, ${destinatario.nome},</p>
      <p>Sua conta de acesso ao Painel Administrativo do Auditar foi criada. Use a senha temporária abaixo no primeiro acesso:</p>
      <p style="text-align: center; margin: 32px 0;">
        <span style="background: #f0f4f8; color: #1f2933; padding: 12px 24px; border-radius: 6px; display: inline-block; font-weight: bold; font-size: 18px; letter-spacing: 2px;">${senhaTemporaria}</span>
      </p>
      <p style="color: #616e7c; font-size: 13px;">Por segurança, o sistema exigirá a troca desta senha no seu primeiro login.</p>
    </div>
    <div style="padding: 16px; text-align: center; color: #9aa5b1; font-size: 12px;">
      Auditar — Sistema de Gestão de Processos Administrativos Municipais
    </div>
  </div>`;

  await deps.mailer.sendMail({
    from: deps.fromAddress,
    to: destinatario.email,
    subject: 'Acesso ao Painel Administrativo — Auditar',
    html,
    text:
      `Olá, ${destinatario.nome}.\n\n` +
      `Sua conta de acesso ao Painel Administrativo do Auditar foi criada.\n` +
      `Senha temporária: ${senhaTemporaria}\n\n` +
      `O sistema exigirá a troca desta senha no seu primeiro login.`,
  });
}

// ---------------------------------------------------------------------------
// Desativação de Servidor e Permissões Granulares (Task 6.2)
// Req. 8.6, 8.9, 21.6, 21.7, 21.8
// ---------------------------------------------------------------------------

/**
 * Status TERMINAIS de um Processo — um Processo nesses estados NÃO está mais em
 * andamento e, portanto, NÃO precisa ser reatribuído ao desativar o Servidor
 * responsável (Req. 21.7). Todos os demais status são considerados "em
 * andamento" (atribuídos ativamente ao Servidor).
 */
const STATUS_TERMINAIS: readonly string[] = [
  StatusProcesso.APROVADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.FINALIZADO,
];

/** Prefixo da chave de kill-switch de revogação de sessão no Redis. */
const REVOGADO_PREFIX = 'servidor:revogado:';

/**
 * Interface mínima do Redis usada por este serviço (facilita injeção em testes).
 * Compatível com `ioredis` (`set(key, value)`).
 */
export interface RedisLike {
  set(key: string, value: string): Promise<unknown>;
}

/** Resolve a instância real do Redis preguiçosamente (lazy), como o resolveDeps. */
function resolveRedis(redis?: RedisLike): RedisLike {
  if (redis) return redis;
  const requireLocal = createRequire(import.meta.url);
  const { redis: realRedis } = requireLocal('../../config/redis.js') as { redis: RedisLike };
  return realRedis;
}

/** Uma reatribuição de Processo: move `processoId` para `novoServidorId`. */
export interface Reatribuicao {
  processoId: string;
  novoServidorId: string;
}

/** Resumo de um Processo atribuído em andamento. */
export interface ProcessoAtribuido {
  id: string;
  protocolo: string;
}

/**
 * Lista os Processos atribuídos ao Servidor que ainda estão EM ANDAMENTO — ou
 * seja, cujo status NÃO é terminal (Req. 21.7). Retorna apenas `id` e
 * `protocolo` para exibição ao Administrador.
 */
export async function listarProcessosAtribuidos(
  servidorId: string,
  deps?: ServidoresDeps,
): Promise<ProcessoAtribuido[]> {
  const d = resolveDeps(deps);
  const processos = await d.prisma.processo.findMany({
    where: {
      servidorResponsavelId: servidorId,
      status: { notIn: STATUS_TERMINAIS as string[] },
    },
    select: { id: true, protocolo: true },
  });
  return processos as ProcessoAtribuido[];
}

/**
 * Desativa a conta de um Servidor sem excluí-la, preservando o histórico
 * (Req. 21.6). Antes de confirmar:
 *  - lista os Processos em andamento atribuídos e exige que TODOS estejam
 *    cobertos pelas reatribuições informadas — caso contrário rejeita listando
 *    os Processos ainda pendentes (Req. 21.7);
 *  - aplica cada reatribuição (troca do `servidorResponsavelId`) e audita;
 *  - marca `ativo = false` e grava um kill-switch em Redis
 *    (`servidor:revogado:{id}` = timestamp) que o middleware de autenticação
 *    consulta para encerrar as sessões ativas em ≤5s (Req. 21.8);
 *  - audita a ação `desativar_servidor`.
 */
export async function desativar(
  servidorId: string,
  reatribuicoes: Reatribuicao[],
  ator: Ator,
  deps?: ServidoresDeps,
  redisClient?: RedisLike,
): Promise<{ id: string; ativo: boolean; reatribuidos: number }> {
  const d = resolveDeps(deps);
  const redis = resolveRedis(redisClient);

  // 1. Garante que o Servidor existe.
  const existente = await d.prisma.servidor.findUnique({
    where: { id: servidorId },
    select: { id: true, ativo: true, nivelAcesso: true },
  });
  if (!existente) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Servidor não encontrado');
  }

  // 2. Processos em andamento atribuídos: exige reatribuição de cada um (Req. 21.7).
  const emAndamento = await listarProcessosAtribuidos(servidorId, d);
  const cobertos = new Set((reatribuicoes ?? []).map((r) => r.processoId));
  const pendentes = emAndamento.filter((p) => !cobertos.has(p.id));
  if (pendentes.length > 0) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `Existem ${pendentes.length} Processo(s) em andamento que precisam ser reatribuídos antes de desativar o Servidor: ${pendentes
        .map((p) => p.protocolo)
        .join(', ')}`,
      'reatribuicoes',
    );
  }

  // 3. Aplica as reatribuições, auditando cada uma.
  for (const r of reatribuicoes ?? []) {
    await d.prisma.processo.update({
      where: { id: r.processoId },
      data: { servidorResponsavelId: r.novoServidorId },
    });
    await d.auditar({
      ator: 'servidor',
      atorServidorId: ator.servidorId,
      enderecoIp: ator.enderecoIp,
      tipoAcao: 'reatribuir_processo',
      modulo: MODULO,
      objetoId: r.processoId,
      tipoObjeto: 'Processo',
      valorAnterior: { servidorResponsavelId: servidorId },
      valorPosterior: { servidorResponsavelId: r.novoServidorId },
    });
  }

  // 4. Desativa o Servidor + kill-switch de sessão (Req. 21.6, 21.8).
  const servidor = await d.prisma.servidor.update({
    where: { id: servidorId },
    data: { ativo: false },
    select: SELECT_SERVIDOR,
  });

  await redis.set(`${REVOGADO_PREFIX}${servidorId}`, String(Date.now()));

  await d.auditar(
    auditoriaBase('desativar_servidor', ator, servidorId, {
      valorAnterior: { ativo: existente.ativo },
      valorPosterior: { ativo: false },
    }),
  );

  return {
    id: (servidor as { id: string }).id,
    ativo: (servidor as { ativo: boolean }).ativo,
    reatribuidos: (reatribuicoes ?? []).length,
  };
}

/** Uma permissão granular a ser aplicada a um Servidor. */
export interface PermissaoInput {
  permissao: string;
  concedida: boolean;
}

/**
 * Substitui o conjunto de permissões granulares de um Servidor (Req. 8.6). As
 * linhas existentes de `PermissaoServidor` são removidas e recriadas com o novo
 * conjunto. Registra na Auditoria os valores ANTERIOR e POSTERIOR das
 * permissões alteradas (Req. 8.9). Retorna as permissões atualizadas.
 */
export async function atualizarPermissoes(
  servidorId: string,
  permissoes: PermissaoInput[],
  ator: Ator,
  deps?: ServidoresDeps,
): Promise<PermissaoInput[]> {
  const d = resolveDeps(deps);

  // Garante que o Servidor existe.
  const existente = await d.prisma.servidor.findUnique({
    where: { id: servidorId },
    select: { id: true },
  });
  if (!existente) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Servidor não encontrado');
  }

  // Captura o estado ANTERIOR das permissões para a auditoria (Req. 8.9).
  const anteriores = await d.prisma.permissaoServidor.findMany({
    where: { servidorId },
    select: { permissao: true, concedida: true },
  });

  // Substitui o conjunto: apaga tudo e recria.
  await d.prisma.permissaoServidor.deleteMany({ where: { servidorId } });
  if (permissoes.length > 0) {
    await d.prisma.permissaoServidor.createMany({
      data: permissoes.map((p) => ({
        servidorId,
        permissao: p.permissao,
        concedida: p.concedida,
      })),
    });
  }

  await d.auditar(
    auditoriaBase('alterar_permissoes', ator, servidorId, {
      valorAnterior: anteriores,
      valorPosterior: permissoes,
    }),
  );

  return permissoes;
}
