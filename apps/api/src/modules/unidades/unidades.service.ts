import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { ModoAtribuicao, ErrorCodes } from '@auditar/shared';
import { badRequest, notFound } from '../../utils/errors.js';
import { registrar as defaultRegistrar } from '../auditoria/auditoria.service.js';
import type { RegistrarAuditoriaDto } from '../auditoria/auditoria.types.js';
import type { CriarUnidadeDto, EditarUnidadeDto } from './unidades.schema.js';

/**
 * Serviço do CRUD de Unidades (Painel_Administrativo → Configuração).
 *
 * Regras principais:
 *  - Criação exige nome (≤100), secretaria e Gestor responsável (Req. 14.5).
 *  - Desativação verifica Processos em andamento na Unidade; havendo pendências,
 *    exige confirmação explícita informando o número de Processos impactados
 *    (Req. 14.6).
 *  - A desativação NÃO altera status, dados ou fluxo dos Processos existentes;
 *    apenas marca a Unidade como inativa (`ativa = false`) para impedir novas
 *    associações (Req. 14.7).
 *
 * As dependências (prisma, redis, auditar) são injetáveis para facilitar os
 * testes unitários — em produção usam as instâncias reais por padrão.
 */

const MODULO = 'unidades';
const TIPO_OBJETO = 'Unidade';

/**
 * Status que representam um Processo já encerrado (não conta como "em andamento").
 * Qualquer status fora deste conjunto é tratado como Processo em andamento (Req. 14.6).
 */
const STATUS_ENCERRADOS = ['finalizado', 'rejeitado', 'cancelado'] as const;

/** Ator que dispara a operação — usado para registrar a auditoria (Req. 14.7). */
export interface Ator {
  servidorId: string;
  enderecoIp: string;
}

/** Filtros opcionais para a listagem de Unidades. */
export interface ListarUnidadesFiltros {
  ativa?: boolean;
  secretaria?: string;
}

/** Cliente mínimo de auditoria — permite injetar um mock nos testes. */
export type Auditar = (dto: RegistrarAuditoriaDto) => Promise<void>;

/** Dependências injetáveis do serviço. */
export interface UnidadesDeps {
  prisma: PrismaClient;
  redis: Redis;
  auditar: Auditar;
}

/**
 * Resolve as dependências reais preguiçosamente (lazy). Importar este módulo
 * NÃO deve carregar o Prisma Client nem abrir conexão com o Redis — só quando
 * uma operação é executada sem dependências injetadas. Isso mantém os testes
 * (que injetam mocks) independentes da geração do client Prisma.
 */
let cachedDeps: UnidadesDeps | undefined;

function resolveDeps(deps?: UnidadesDeps): UnidadesDeps {
  if (deps) return deps;
  if (!cachedDeps) {
    // Import dinâmico/tardio via require para não puxar @prisma/client no grafo
    // estático de imports do módulo.
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as {
      prisma: PrismaClient;
    };
    const { redis } = requireLocal('../../config/redis.js') as { redis: Redis };
    cachedDeps = { prisma, redis, auditar: defaultRegistrar };
  }
  return cachedDeps;
}

/** Monta o DTO base de auditoria para uma ação de servidor sobre uma Unidade. */
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
 * Conta os Processos em andamento (status fora do conjunto de encerrados)
 * vinculados a uma Unidade (Req. 14.6).
 */
export async function contarProcessosEmAndamento(
  unidadeId: string,
  deps?: UnidadesDeps,
): Promise<number> {
  const d = resolveDeps(deps);
  return d.prisma.processo.count({
    where: {
      unidadeId,
      status: { notIn: [...STATUS_ENCERRADOS] },
    },
  });
}

/** Lista as Unidades, com filtros opcionais por `ativa` e `secretaria`. */
export async function listar(
  filtros: ListarUnidadesFiltros = {},
  deps?: UnidadesDeps,
) {
  const d = resolveDeps(deps);
  const where: Record<string, unknown> = {};
  if (filtros.ativa !== undefined) {
    where.ativa = filtros.ativa;
  }
  if (filtros.secretaria) {
    where.secretaria = filtros.secretaria;
  }

  return d.prisma.unidade.findMany({
    where,
    orderBy: { nome: 'asc' },
  });
}

/**
 * Cria uma nova Unidade. Reforça a presença dos campos obrigatórios (Req. 14.5)
 * mesmo que a validação de schema já os garanta, e registra a ação na auditoria.
 */
export async function criar(dto: CriarUnidadeDto, ator: Ator, deps?: UnidadesDeps) {
  const d = resolveDeps(deps);
  if (!dto.nome?.trim()) {
    throw badRequest(ErrorCodes.CAMPO_OBRIGATORIO, 'Nome é obrigatório', 'nome');
  }
  if (!dto.secretaria?.trim()) {
    throw badRequest(ErrorCodes.CAMPO_OBRIGATORIO, 'Secretaria é obrigatória', 'secretaria');
  }
  if (!dto.gestorId?.trim()) {
    throw badRequest(ErrorCodes.CAMPO_OBRIGATORIO, 'Gestor responsável é obrigatório', 'gestorId');
  }

  const unidade = await d.prisma.unidade.create({
    data: {
      nome: dto.nome.trim(),
      secretaria: dto.secretaria.trim(),
      gestorId: dto.gestorId.trim(),
      endereco: dto.endereco?.trim(),
      telefone: dto.telefone?.trim(),
      horarioFuncionamento: dto.horarioFuncionamento?.trim(),
      modoAtribuicao: dto.modoAtribuicao ?? ModoAtribuicao.MANUAL,
    },
  });

  await d.auditar(
    auditoriaBase('criar_unidade', ator, unidade.id, { valorPosterior: unidade }),
  );

  return unidade;
}

/** Edita uma Unidade existente. Garante a existência antes de atualizar (Req. 14.5). */
export async function editar(
  id: string,
  dto: EditarUnidadeDto,
  ator: Ator,
  deps?: UnidadesDeps,
) {
  const d = resolveDeps(deps);
  const existente = await d.prisma.unidade.findUnique({ where: { id } });
  if (!existente) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Unidade não encontrada');
  }

  const data: Record<string, unknown> = {};
  if (dto.nome !== undefined) data.nome = dto.nome.trim();
  if (dto.secretaria !== undefined) data.secretaria = dto.secretaria.trim();
  if (dto.gestorId !== undefined) data.gestorId = dto.gestorId.trim();
  if (dto.endereco !== undefined) data.endereco = dto.endereco.trim();
  if (dto.telefone !== undefined) data.telefone = dto.telefone.trim();
  if (dto.horarioFuncionamento !== undefined) {
    data.horarioFuncionamento = dto.horarioFuncionamento.trim();
  }
  if (dto.modoAtribuicao !== undefined) data.modoAtribuicao = dto.modoAtribuicao;

  const unidade = await d.prisma.unidade.update({ where: { id }, data });

  await d.auditar(
    auditoriaBase('editar_unidade', ator, id, {
      valorAnterior: existente,
      valorPosterior: unidade,
    }),
  );

  return unidade;
}

/** Resultado da desativação quando há Processos em andamento e falta confirmação. */
export interface DesativarRequerConfirmacao {
  requerConfirmacao: true;
  processosImpactados: number;
}

/**
 * Desativa uma Unidade (Req. 14.6, 14.7).
 *
 * - Se houver Processos em andamento e `confirmar` for falso, retorna
 *   `{ requerConfirmacao: true, processosImpactados }` sem persistir alterações.
 * - Quando confirmado (ou sem pendências), marca `ativa = false`. Não altera
 *   nenhum Processo existente — apenas impede novas associações.
 */
export async function desativar(
  id: string,
  confirmar: boolean,
  ator: Ator,
  deps?: UnidadesDeps,
): Promise<DesativarRequerConfirmacao | { id: string; ativa: boolean }> {
  const d = resolveDeps(deps);
  const existente = await d.prisma.unidade.findUnique({ where: { id } });
  if (!existente) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Unidade não encontrada');
  }

  const processosImpactados = await contarProcessosEmAndamento(id, d);
  if (processosImpactados > 0 && !confirmar) {
    return { requerConfirmacao: true, processosImpactados };
  }

  const unidade = await d.prisma.unidade.update({
    where: { id },
    data: { ativa: false },
  });

  await d.auditar(
    auditoriaBase('desativar_unidade', ator, id, {
      valorAnterior: { ativa: existente.ativa },
      valorPosterior: { ativa: false, processosImpactados },
    }),
  );

  return unidade;
}
