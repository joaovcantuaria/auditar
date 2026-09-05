import type { PrismaClient, FormularioDinamico, CampoFormulario } from '@prisma/client';
import { ErrorCodes, TipoCampo } from '@auditar/shared';
import { prisma as realPrisma } from '../../config/database.js';
import { redis as realRedis } from '../../config/redis.js';
import { badRequest, notFound } from '../../utils/index.js';
import { registrar as realRegistrar } from '../auditoria/index.js';
import type { RegistrarAuditoriaDto } from '../auditoria/index.js';
import {
  MAX_CAMPOS,
  validarValorPadrao,
  type CampoInput,
  type CriarFormularioInput,
  type EditarFormularioInput,
} from './formularios.schema.js';

/**
 * Serviço de Formulários Dinâmicos.
 *
 * Regras de negócio para o CRUD de Formulários (Req. 16.1–16.5):
 * - Um formulário é associado a um Tipo de Processo + Unidade e possui até 50 campos.
 * - Cada campo exige `rotulo` não vazio e um `valorPadrao` compatível com o tipo.
 * - A leitura pública (Portal) do formulário ativo por Tipo+Unidade é cacheada no
 *   Redis (`cache:formulario:{tipoId}:{unidadeId}`, TTL 10min); qualquer escrita
 *   invalida o cache correspondente.
 * - A reordenação de campos persiste a nova `ordem` imediatamente (Req. 16.4).
 * - Todas as escritas são registradas no Módulo de Auditoria.
 */

const MODULO = 'formularios';
export const FORMULARIO_CACHE_TTL_SECONDS = 600; // 10 minutos

/** Monta a chave de cache do formulário para um par Tipo de Processo + Unidade. */
export function formularioCacheKey(tipoProcessoId: string, unidadeId: string): string {
  return `cache:formulario:${tipoProcessoId}:${unidadeId}`;
}

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa as instâncias reais por padrão)
// ---------------------------------------------------------------------------

/** Contrato mínimo do Redis usado pelo serviço. */
export interface FormulariosCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface FormulariosDeps {
  prisma: Pick<PrismaClient, 'formularioDinamico' | 'campoFormulario'>;
  redis: FormulariosCache;
  auditar: (dto: RegistrarAuditoriaDto) => Promise<void>;
}

function resolveDeps(deps?: Partial<FormulariosDeps>): FormulariosDeps {
  return {
    prisma: deps?.prisma ?? (realPrisma as unknown as FormulariosDeps['prisma']),
    redis: deps?.redis ?? (realRedis as unknown as FormulariosCache),
    auditar: deps?.auditar ?? realRegistrar,
  };
}

/** Ator que realiza a operação (extraído de req.user + ip pelo controller). */
export interface AtorFormulario {
  servidorId: string;
  enderecoIp: string;
}

/** Formulário com seus campos ordenados. */
export type FormularioComCampos = FormularioDinamico & { campos: CampoFormulario[] };

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Invalida o cache do formulário de um par Tipo+Unidade. Falha não propaga. */
async function invalidarCache(
  redis: FormulariosCache,
  tipoProcessoId: string,
  unidadeId: string,
): Promise<void> {
  try {
    await redis.del(formularioCacheKey(tipoProcessoId, unidadeId));
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
 * Valida um conjunto de campos aplicando as regras de negócio (Req. 16.1/16.3):
 * - no máximo `MAX_CAMPOS` campos;
 * - `rotulo` não vazio;
 * - `valorPadrao` compatível com o `tipo`.
 * Lança `badRequest` (VALIDATION_ERROR) no primeiro campo inválido.
 */
function validarCampos(campos: CampoInput[]): void {
  if (campos.length > MAX_CAMPOS) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `Um formulário pode ter no máximo ${MAX_CAMPOS} campos`,
      'campos',
    );
  }

  campos.forEach((campo, index) => {
    if (!campo.rotulo || campo.rotulo.trim().length === 0) {
      throw badRequest(
        ErrorCodes.VALIDATION_ERROR,
        'Rótulo é obrigatório',
        `campos.${index}.rotulo`,
      );
    }
    if (!validarValorPadrao(campo.tipo as TipoCampo, campo.valorPadrao)) {
      throw badRequest(
        ErrorCodes.VALIDATION_ERROR,
        'Valor padrão incompatível com o tipo do campo',
        `campos.${index}.valorPadrao`,
      );
    }
  });
}

/** Converte um `CampoInput` no shape de criação de `CampoFormulario` do Prisma. */
function toCampoData(campo: CampoInput) {
  return {
    tipo: campo.tipo,
    rotulo: campo.rotulo.trim(),
    descricaoAuxiliar: campo.descricaoAuxiliar,
    obrigatorio: campo.obrigatorio ?? false,
    validacao: campo.validacao,
    valorPadrao: campo.valorPadrao,
    ordem: campo.ordem,
    opcoes: campo.opcoes ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

/**
 * Lista todos os Formulários Dinâmicos com seus campos ordenados por `ordem`.
 */
export async function listar(
  deps?: Partial<FormulariosDeps>,
): Promise<FormularioComCampos[]> {
  const { prisma } = resolveDeps(deps);
  return prisma.formularioDinamico.findMany({
    include: { campos: { orderBy: { ordem: 'asc' } } },
    orderBy: { criadoEm: 'desc' },
  }) as Promise<FormularioComCampos[]>;
}

/**
 * Leitura PÚBLICA (Portal do Cidadão) do formulário ATIVO de um par
 * Tipo de Processo + Unidade, com campos na ordem configurada (Req. 16.5).
 *
 * Serve a partir do cache Redis quando disponível; em cache miss consulta o
 * banco e popula o cache (TTL 10min). Retorna `null` quando não há formulário
 * ativo — o Portal trata a indisponibilidade (Req. 16.6).
 */
export async function obterPorTipoUnidade(
  tipoProcessoId: string,
  unidadeId: string,
  deps?: Partial<FormulariosDeps>,
): Promise<FormularioComCampos | null> {
  const { prisma, redis } = resolveDeps(deps);
  const chave = formularioCacheKey(tipoProcessoId, unidadeId);

  try {
    const cached = await redis.get(chave);
    if (cached) {
      return JSON.parse(cached) as FormularioComCampos;
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

  const formulario = (await prisma.formularioDinamico.findFirst({
    where: { tipoProcessoId, unidadeId, ativo: true },
    include: { campos: { orderBy: { ordem: 'asc' } } },
  })) as FormularioComCampos | null;

  if (formulario) {
    try {
      await redis.set(chave, JSON.stringify(formulario), 'EX', FORMULARIO_CACHE_TTL_SECONDS);
    } catch {
      // Falha ao popular o cache não deve interromper a leitura.
    }
  }

  return formulario;
}

/**
 * Cria um novo Formulário Dinâmico associado a um Tipo de Processo + Unidade.
 * Valida os campos (≤50, rótulo não vazio, valor padrão compatível — Req. 16.3)
 * antes de persistir. Cria o formulário e seus campos com a `ordem` informada,
 * invalida o cache do par Tipo+Unidade e registra a ação na Auditoria.
 */
export async function criar(
  dto: CriarFormularioInput,
  ator: AtorFormulario,
  deps?: Partial<FormulariosDeps>,
): Promise<FormularioComCampos> {
  const { prisma, redis, auditar } = resolveDeps(deps);

  validarCampos(dto.campos);

  const formulario = (await prisma.formularioDinamico.create({
    data: {
      tipoProcessoId: dto.tipoProcessoId,
      unidadeId: dto.unidadeId,
      criadoPorId: ator.servidorId,
      campos: { create: dto.campos.map(toCampoData) },
    },
    include: { campos: { orderBy: { ordem: 'asc' } } },
  })) as FormularioComCampos;

  await invalidarCache(redis, dto.tipoProcessoId, dto.unidadeId);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'criar_formulario',
    modulo: MODULO,
    objetoId: formulario.id,
    tipoObjeto: 'FormularioDinamico',
    valorPosterior: formulario,
  });

  return formulario;
}

/**
 * Salva (edita) um Formulário existente substituindo por completo sua lista de
 * campos (reconciliação: remove os antigos e recria com a nova `ordem`).
 * Revalida os campos, persiste, invalida o cache e audita (Req. 16.4).
 */
export async function salvar(
  id: string,
  dto: EditarFormularioInput,
  ator: AtorFormulario,
  deps?: Partial<FormulariosDeps>,
): Promise<FormularioComCampos> {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const atual = (await prisma.formularioDinamico.findUnique({
    where: { id },
    include: { campos: { orderBy: { ordem: 'asc' } } },
  })) as FormularioComCampos | null;
  if (!atual) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Formulário não encontrado');
  }

  validarCampos(dto.campos);

  // Reconciliação da lista de campos: remove os existentes e recria.
  await prisma.campoFormulario.deleteMany({ where: { formularioId: id } });

  const atualizado = (await prisma.formularioDinamico.update({
    where: { id },
    data: {
      campos: { create: dto.campos.map(toCampoData) },
    },
    include: { campos: { orderBy: { ordem: 'asc' } } },
  })) as FormularioComCampos;

  await invalidarCache(redis, atualizado.tipoProcessoId, atualizado.unidadeId);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'salvar_formulario',
    modulo: MODULO,
    objetoId: id,
    tipoObjeto: 'FormularioDinamico',
    valorAnterior: atual,
    valorPosterior: atualizado,
  });

  return atualizado;
}

/**
 * Reordena os campos de um formulário de acordo com a sequência de ids informada,
 * persistindo a nova `ordem` imediatamente (Req. 16.4). O índice de cada id na
 * lista `ordemIds` define o valor de `ordem` do campo correspondente.
 * Invalida o cache do par Tipo+Unidade e registra a ação na Auditoria.
 */
export async function reordenarCampos(
  id: string,
  ordemIds: string[],
  ator: AtorFormulario,
  deps?: Partial<FormulariosDeps>,
): Promise<FormularioComCampos> {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const atual = (await prisma.formularioDinamico.findUnique({
    where: { id },
    include: { campos: { orderBy: { ordem: 'asc' } } },
  })) as FormularioComCampos | null;
  if (!atual) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Formulário não encontrado');
  }

  const idsExistentes = new Set(atual.campos.map((c: CampoFormulario) => c.id));
  const desconhecido = ordemIds.find((campoId) => !idsExistentes.has(campoId));
  if (desconhecido) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'Um ou mais campos informados não pertencem ao formulário',
      'ordemIds',
    );
  }

  // Persiste a nova ordem imediatamente (Req. 16.4).
  await Promise.all(
    ordemIds.map((campoId, index) =>
      prisma.campoFormulario.update({
        where: { id: campoId },
        data: { ordem: index },
      }),
    ),
  );

  const atualizado = (await prisma.formularioDinamico.findUnique({
    where: { id },
    include: { campos: { orderBy: { ordem: 'asc' } } },
  })) as FormularioComCampos;

  await invalidarCache(redis, atual.tipoProcessoId, atual.unidadeId);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'reordenar_campos_formulario',
    modulo: MODULO,
    objetoId: id,
    tipoObjeto: 'FormularioDinamico',
    valorPosterior: { ordem: ordemIds },
  });

  return atualizado;
}
