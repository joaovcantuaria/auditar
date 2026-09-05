import type { PrismaClient } from '@prisma/client';
import { StatusProcesso, ErrorCodes } from '@auditar/shared';
import { prisma as defaultPrisma } from '../../config/database.js';
import { redis as defaultRedis } from '../../config/redis.js';
import { registrar as defaultRegistrar } from '../../modules/auditoria/index.js';
import { badRequest, notFound } from '../../utils/index.js';
import type { CriarTipoDto, EditarTipoDto } from './tipos.schema.js';

/**
 * Serviço de Tipos de Processo (Painel Administrativo).
 *
 * Regras (Requisito 14):
 *  - 14.3: criação/edição/desativação com nome (<=100), prazo [1,365] e Unidades
 *    atendentes obrigatórias.
 *  - 14.4: nome deve ser único DENTRO da mesma Categoria (case-insensitive);
 *    duplicidade é rejeitada sem persistir.
 *  - 14.6: desativar um Tipo com Processos em andamento exige confirmação,
 *    informando quantos Processos serão impactados.
 *  - 14.7: desativação NÃO altera Processos já existentes; apenas impede novos.
 *
 * As dependências (prisma, redis, auditar) são injetáveis para facilitar os
 * testes; em produção usam as instâncias singleton do app.
 */

/** Ação de auditoria compatível com o `registrar` do módulo de auditoria. */
type Auditar = typeof defaultRegistrar;
/** Interface mínima do Redis usada por este serviço (cache de listagem). */
export interface RedisLike {
  del(...keys: string[]): Promise<number>;
}

export interface TiposServiceDeps {
  prisma: PrismaClient;
  redis: RedisLike;
  auditar: Auditar;
}

/** Identificação do ator que realiza a ação, para fins de auditoria. */
export interface Ator {
  servidorId: string;
  enderecoIp: string;
}

/**
 * Status considerados TERMINAIS — um Processo nesses estados não está mais em
 * andamento e, portanto, não conta como impactado ao desativar o Tipo (Req. 14.6).
 */
const STATUS_TERMINAIS: readonly string[] = [
  StatusProcesso.FINALIZADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.APROVADO,
];

/** Chave de cache Redis para a listagem de tipos (invalida em escritas). */
const CACHE_KEY = 'tipos-processo:listagem';

const MODULO = 'tipos-processo';
const TIPO_OBJETO = 'TipoProcesso';

function resolveDeps(deps?: Partial<TiposServiceDeps>): TiposServiceDeps {
  return {
    prisma: deps?.prisma ?? defaultPrisma,
    redis: deps?.redis ?? (defaultRedis as unknown as RedisLike),
    auditar: deps?.auditar ?? defaultRegistrar,
  };
}

/**
 * Lista os Tipos de Processo, opcionalmente filtrando por Categoria.
 * Inclui a associação de Unidades atendentes.
 */
export async function listar(categoriaId?: string, deps?: Partial<TiposServiceDeps>) {
  const { prisma } = resolveDeps(deps);
  return prisma.tipoProcesso.findMany({
    where: categoriaId ? { categoriaId } : undefined,
    include: { unidades: true },
    orderBy: { criadoEm: 'desc' },
  });
}

/**
 * Verifica se já existe um Tipo de Processo com o mesmo nome (case-insensitive)
 * dentro da Categoria informada. Lança `badRequest` (Req. 14.4) quando houver
 * conflito. `excluirId` permite ignorar o próprio registro numa edição.
 */
async function assertNomeUnico(
  prisma: PrismaClient,
  nome: string,
  categoriaId: string,
  excluirId?: string,
): Promise<void> {
  const existente = await prisma.tipoProcesso.findFirst({
    where: {
      categoriaId,
      nome: { equals: nome, mode: 'insensitive' },
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
    select: { id: true },
  });

  if (existente) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'Já existe um tipo de processo com este nome nesta categoria',
      'nome',
    );
  }
}

/**
 * Cria um novo Tipo de Processo, conectando as Unidades atendentes via as linhas
 * da tabela de junção `TipoProcessoUnidade`. Rejeita nome duplicado na mesma
 * Categoria (Req. 14.4) e registra auditoria (`criar_tipo_processo`).
 */
export async function criar(dto: CriarTipoDto, ator: Ator, deps?: Partial<TiposServiceDeps>) {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const nome = dto.nome.trim();
  if (nome.length === 0) {
    throw badRequest(ErrorCodes.CAMPO_OBRIGATORIO, 'O nome do tipo de processo é obrigatório', 'nome');
  }
  if (dto.prazoTotalDiasUteis < 1 || dto.prazoTotalDiasUteis > 365) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'O prazo total deve estar entre 1 e 365 dias úteis',
      'prazoTotalDiasUteis',
    );
  }
  if (!dto.unidadesIds || dto.unidadesIds.length === 0) {
    throw badRequest(ErrorCodes.CAMPO_OBRIGATORIO, 'Informe ao menos uma Unidade atendente', 'unidadesIds');
  }

  await assertNomeUnico(prisma, nome, dto.categoriaId);

  const criado = await prisma.tipoProcesso.create({
    data: {
      nome,
      prazoTotalDiasUteis: dto.prazoTotalDiasUteis,
      categoriaId: dto.categoriaId,
      fluxoId: dto.fluxoId,
      unidades: {
        create: dto.unidadesIds.map((unidadeId) => ({ unidadeId })),
      },
    },
    include: { unidades: true },
  });

  await redis.del(CACHE_KEY);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'criar_tipo_processo',
    modulo: MODULO,
    objetoId: criado.id,
    tipoObjeto: TIPO_OBJETO,
    valorPosterior: { nome: criado.nome, categoriaId: criado.categoriaId },
  });

  return criado;
}

/**
 * Edita um Tipo de Processo existente. Reavalia a unicidade do nome dentro da
 * Categoria (excluindo o próprio registro — Req. 14.4) e reconcilia as Unidades
 * atendentes quando `unidadesIds` for informado. Registra auditoria.
 */
export async function editar(
  id: string,
  dto: EditarTipoDto,
  ator: Ator,
  deps?: Partial<TiposServiceDeps>,
) {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const atual = await prisma.tipoProcesso.findUnique({
    where: { id },
    include: { unidades: true },
  });
  if (!atual) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Tipo de processo não encontrado');
  }

  const categoriaId = dto.categoriaId ?? atual.categoriaId;
  const nome = dto.nome?.trim();

  if (nome !== undefined) {
    if (nome.length === 0) {
      throw badRequest(ErrorCodes.CAMPO_OBRIGATORIO, 'O nome do tipo de processo é obrigatório', 'nome');
    }
    await assertNomeUnico(prisma, nome, categoriaId, id);
  } else if (dto.categoriaId && dto.categoriaId !== atual.categoriaId) {
    // Mudou de categoria sem alterar o nome: reavalia unicidade na nova categoria.
    await assertNomeUnico(prisma, atual.nome, dto.categoriaId, id);
  }

  const atualizado = await prisma.tipoProcesso.update({
    where: { id },
    data: {
      nome,
      categoriaId: dto.categoriaId,
      prazoTotalDiasUteis: dto.prazoTotalDiasUteis,
      fluxoId: dto.fluxoId === undefined ? undefined : dto.fluxoId,
      ...(dto.unidadesIds
        ? {
            unidades: {
              deleteMany: {},
              create: dto.unidadesIds.map((unidadeId) => ({ unidadeId })),
            },
          }
        : {}),
    },
    include: { unidades: true },
  });

  await redis.del(CACHE_KEY);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'editar_tipo_processo',
    modulo: MODULO,
    objetoId: id,
    tipoObjeto: TIPO_OBJETO,
    valorAnterior: { nome: atual.nome, categoriaId: atual.categoriaId },
    valorPosterior: { nome: atualizado.nome, categoriaId: atualizado.categoriaId },
  });

  return atualizado;
}

/** Resultado da desativação: ou requer confirmação, ou o Tipo atualizado. */
export type DesativarResult =
  | { requerConfirmacao: true; processosImpactados: number }
  | { requerConfirmacao: false; tipo: Awaited<ReturnType<typeof desativarConfirmado>> };

/**
 * Desativa um Tipo de Processo.
 *
 * Se houver Processos em andamento (status não-terminal) e `confirmar` for false,
 * retorna a contagem de impactados e exige confirmação (Req. 14.6). Confirmada a
 * operação, marca `ativo = false`. Os Processos já existentes NÃO são alterados
 * (Req. 14.7) — apenas a criação de novos fica impedida.
 */
export async function desativar(
  id: string,
  confirmar: boolean,
  ator: Ator,
  deps?: Partial<TiposServiceDeps>,
): Promise<DesativarResult> {
  const { prisma } = resolveDeps(deps);

  const atual = await prisma.tipoProcesso.findUnique({ where: { id }, select: { id: true, ativo: true } });
  if (!atual) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Tipo de processo não encontrado');
  }

  const processosImpactados = await prisma.processo.count({
    where: {
      tipoProcessoId: id,
      status: { notIn: STATUS_TERMINAIS },
    },
  });

  if (processosImpactados > 0 && !confirmar) {
    return { requerConfirmacao: true, processosImpactados };
  }

  const tipo = await desativarConfirmado(id, ator, deps);
  return { requerConfirmacao: false, tipo };
}

/** Aplica de fato a desativação e registra auditoria. */
async function desativarConfirmado(id: string, ator: Ator, deps?: Partial<TiposServiceDeps>) {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const tipo = await prisma.tipoProcesso.update({
    where: { id },
    data: { ativo: false },
    include: { unidades: true },
  });

  await redis.del(CACHE_KEY);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'desativar_tipo_processo',
    modulo: MODULO,
    objetoId: id,
    tipoObjeto: TIPO_OBJETO,
    valorPosterior: { ativo: false },
  });

  return tipo;
}
