import type { PrismaClient, Categoria } from '@prisma/client';
import { ErrorCodes, StatusProcesso } from '@auditar/shared';
import { prisma as realPrisma } from '../../config/database.js';
import { redis as realRedis } from '../../config/redis.js';
import { badRequest, notFound } from '../../utils/index.js';
import { registrar as realRegistrar } from '../auditoria/index.js';
import type { RegistrarAuditoriaDto } from '../auditoria/index.js';
import type { CriarCategoriaInput, EditarCategoriaInput } from './categorias.schema.js';

/**
 * Serviço de Categorias.
 *
 * Regras de negócio para o CRUD de Categorias (Req. 14.1, 14.2, 14.6, 14.7):
 * - Nome obrigatório e único (case-insensitive).
 * - A lista de Categorias ativas é cacheada no Redis (`cache:categorias`, TTL 10min);
 *   qualquer escrita invalida o cache.
 * - A desativação (soft delete) verifica Processos em andamento e exige confirmação
 *   quando houver impactados.
 * - Todas as escritas são registradas no Módulo de Auditoria.
 */

export const CATEGORIAS_CACHE_KEY = 'cache:categorias';
export const CATEGORIAS_CACHE_TTL_SECONDS = 600; // 10 minutos
const MODULO = 'categorias';

/**
 * Status considerados "encerrados" — Processos nesses status NÃO contam como
 * "em andamento" ao verificar o impacto de uma desativação (Req. 14.6).
 */
const STATUS_ENCERRADOS: readonly string[] = [
  StatusProcesso.FINALIZADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.APROVADO,
];

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa as instâncias reais por padrão)
// ---------------------------------------------------------------------------

/** Contrato mínimo do Redis usado pelo serviço. */
export interface CategoriasCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface CategoriasDeps {
  prisma: Pick<PrismaClient, 'categoria' | 'processo'>;
  redis: CategoriasCache;
  auditar: (dto: RegistrarAuditoriaDto) => Promise<void>;
}

function resolveDeps(deps?: Partial<CategoriasDeps>): CategoriasDeps {
  return {
    prisma: deps?.prisma ?? (realPrisma as unknown as CategoriasDeps['prisma']),
    redis: deps?.redis ?? (realRedis as unknown as CategoriasCache),
    auditar: deps?.auditar ?? realRegistrar,
  };
}

/** Ator que realiza a operação (extraído de req.user + ip pelo controller). */
export interface AtorCategoria {
  servidorId: string;
  enderecoIp: string;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Invalida o cache da lista de categorias ativas. Falha de cache não propaga. */
async function invalidarCache(redis: CategoriasCache): Promise<void> {
  try {
    await redis.del(CATEGORIAS_CACHE_KEY);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'warn',
        scope: MODULO,
        event: 'invalidar_cache_falhou',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Verifica se já existe outra Categoria com o mesmo nome (comparação
 * case-insensitive), opcionalmente excluindo um id (para o caso de edição).
 */
async function existeNomeDuplicado(
  prisma: CategoriasDeps['prisma'],
  nome: string,
  excluirId?: string,
): Promise<boolean> {
  const alvo = nome.trim().toLowerCase();
  const candidatas: Array<{ id: string; nome: string }> = await prisma.categoria.findMany({
    select: { id: true, nome: true },
  });
  return candidatas.some(
    (c) => c.id !== excluirId && c.nome.trim().toLowerCase() === alvo,
  );
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

/**
 * Lista todas as Categorias (ativas e inativas). A lista de Categorias ATIVAS é
 * servida a partir do cache Redis quando disponível; em cache miss, consulta o
 * banco e popula o cache (TTL 10min). Categorias inativas são sempre buscadas do
 * banco e agregadas ao resultado.
 */
export async function listar(deps?: Partial<CategoriasDeps>): Promise<Categoria[]> {
  const { prisma, redis } = resolveDeps(deps);

  let cacheadas: Categoria[] | undefined;

  try {
    const cached = await redis.get(CATEGORIAS_CACHE_KEY);
    if (cached) {
      cacheadas = JSON.parse(cached) as Categoria[];
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'warn',
        scope: MODULO,
        event: 'leitura_cache_falhou',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  let ativas: Categoria[];
  if (cacheadas !== undefined) {
    ativas = cacheadas;
  } else {
    ativas = await prisma.categoria.findMany({
      where: { ativa: true },
      orderBy: { nome: 'asc' },
    });
    try {
      await redis.set(
        CATEGORIAS_CACHE_KEY,
        JSON.stringify(ativas),
        'EX',
        CATEGORIAS_CACHE_TTL_SECONDS,
      );
    } catch {
      // Falha ao popular o cache não deve interromper a listagem.
    }
  }

  const inativas: Categoria[] = await prisma.categoria.findMany({
    where: { ativa: false },
    orderBy: { nome: 'asc' },
  });

  return [...ativas, ...inativas];
}

/**
 * Cria uma nova Categoria. Rejeita nome em branco ou duplicado (case-insensitive)
 * com `VALIDATION_ERROR` (Req. 14.2). Após criar, invalida o cache e registra a
 * ação no Módulo de Auditoria.
 */
export async function criar(
  dto: CriarCategoriaInput,
  ator: AtorCategoria,
  deps?: Partial<CategoriasDeps>,
): Promise<Categoria> {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const nome = dto.nome.trim();
  if (nome.length === 0) {
    throw badRequest(ErrorCodes.VALIDATION_ERROR, 'Nome é obrigatório', 'nome');
  }

  if (await existeNomeDuplicado(prisma, nome)) {
    throw badRequest(ErrorCodes.VALIDATION_ERROR, 'nome duplicado', 'nome');
  }

  const categoria = await prisma.categoria.create({
    data: {
      nome,
      descricao: dto.descricao,
      icone: dto.icone,
      cor: dto.cor,
      secretaria: dto.secretaria,
      gestorId: dto.gestorId,
    },
  });

  await invalidarCache(redis);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'criar_categoria',
    modulo: MODULO,
    objetoId: categoria.id,
    tipoObjeto: 'Categoria',
    valorPosterior: categoria,
  });

  return categoria;
}

/**
 * Edita uma Categoria existente. Garante que a Categoria existe (`notFound`) e
 * revalida a unicidade do nome EXCLUINDO o próprio registro (Req. 14.2). Após
 * atualizar, invalida o cache e registra a ação no Módulo de Auditoria.
 */
export async function editar(
  id: string,
  dto: EditarCategoriaInput,
  ator: AtorCategoria,
  deps?: Partial<CategoriasDeps>,
): Promise<Categoria> {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const atual = await prisma.categoria.findUnique({ where: { id } });
  if (!atual) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Categoria não encontrada');
  }

  if (dto.nome !== undefined) {
    const nome = dto.nome.trim();
    if (nome.length === 0) {
      throw badRequest(ErrorCodes.VALIDATION_ERROR, 'Nome não pode ser vazio', 'nome');
    }
    if (await existeNomeDuplicado(prisma, nome, id)) {
      throw badRequest(ErrorCodes.VALIDATION_ERROR, 'nome duplicado', 'nome');
    }
  }

  const atualizada = await prisma.categoria.update({
    where: { id },
    data: {
      nome: dto.nome?.trim(),
      descricao: dto.descricao,
      icone: dto.icone,
      cor: dto.cor,
      secretaria: dto.secretaria,
      gestorId: dto.gestorId,
    },
  });

  await invalidarCache(redis);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'editar_categoria',
    modulo: MODULO,
    objetoId: id,
    tipoObjeto: 'Categoria',
    valorAnterior: atual,
    valorPosterior: atualizada,
  });

  return atualizada;
}

/**
 * Conta os Processos em andamento vinculados a uma Categoria, atravessando a
 * relação Processo → TipoProcesso → Categoria. "Em andamento" = qualquer status
 * que NÃO esteja entre os status encerrados (Req. 14.6).
 */
export async function contarProcessosEmAndamento(
  categoriaId: string,
  deps?: Partial<CategoriasDeps>,
): Promise<number> {
  const { prisma } = resolveDeps(deps);
  return prisma.processo.count({
    where: {
      status: { notIn: STATUS_ENCERRADOS },
      tipoProcesso: { categoriaId },
    },
  });
}

/** Resultado da desativação: quando `precisaConfirmacao`, nada foi persistido. */
export interface DesativarResultado {
  precisaConfirmacao: boolean;
  processosImpactados: number;
  categoria?: Categoria;
}

/**
 * Desativa (soft delete) uma Categoria. Conta os Processos em andamento na
 * Categoria; se houver impactados e a confirmação não tiver sido dada, retorna
 * `precisaConfirmacao: true` sem alterar nada (Req. 14.6). Ao confirmar (ou quando
 * não há impactados), define `ativa = false`, invalida o cache e audita (Req. 14.7).
 */
export async function desativar(
  id: string,
  ator: AtorCategoria,
  confirmar = false,
  deps?: Partial<CategoriasDeps>,
): Promise<DesativarResultado> {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const atual = await prisma.categoria.findUnique({ where: { id } });
  if (!atual) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Categoria não encontrada');
  }

  const processosImpactados = await contarProcessosEmAndamento(id, { prisma });

  if (processosImpactados > 0 && !confirmar) {
    return { precisaConfirmacao: true, processosImpactados };
  }

  const categoria = await prisma.categoria.update({
    where: { id },
    data: { ativa: false },
  });

  await invalidarCache(redis);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'desativar_categoria',
    modulo: MODULO,
    objetoId: id,
    tipoObjeto: 'Categoria',
    valorAnterior: atual,
    valorPosterior: categoria,
  });

  return { precisaConfirmacao: false, processosImpactados, categoria };
}
