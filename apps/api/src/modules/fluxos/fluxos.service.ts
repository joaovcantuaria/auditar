import type { PrismaClient } from '@prisma/client';
import { ErrorCodes, calcularPrazoTotalFluxo } from '@auditar/shared';
import { prisma as defaultPrisma } from '../../config/database.js';
import { redis as defaultRedis } from '../../config/redis.js';
import { registrar as defaultRegistrar } from '../../modules/auditoria/index.js';
import { badRequest, notFound } from '../../utils/index.js';
import type { CriarFluxoDto, EditarFluxoDto, EtapaDto } from './fluxos.schema.js';

/**
 * Serviço de Fluxos e Etapas (Painel Administrativo).
 *
 * Regras (Requisito 15):
 *  - 15.1: um Fluxo tem entre 1 e 50 Etapas ordenadas.
 *  - 15.2/15.3: cada Etapa carrega nome, prazo [1,365], responsável padrão e
 *    até 10 automações de Notificação.
 *  - 15.4: VERSIONAMENTO — salvar um Fluxo editado NÃO altera o Fluxo existente
 *    (que os Processos anteriores referenciam via `fluxoVersaoId`); em vez disso
 *    cria uma NOVA versão (`versao + 1`), preservando a versão anterior intacta.
 *  - 15.5: o prazo total estimado é a soma dos prazos das Etapas.
 *  - 15.6: rejeitar salvamento sem ao menos uma Etapa.
 *  - 15.7: rejeitar Etapa com nome vazio ou prazo fora de [1,365].
 *  - 15.8: registrar data/hora e identidade do responsável (auditoria).
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

export interface FluxosServiceDeps {
  prisma: PrismaClient;
  redis: RedisLike;
  auditar: Auditar;
}

/** Identificação do ator que realiza a ação, para fins de auditoria. */
export interface Ator {
  servidorId: string;
  enderecoIp: string;
}

const PRAZO_MIN = 1;
const PRAZO_MAX = 365;
const ETAPAS_MAX = 50;

/** Chave de cache Redis para a listagem de fluxos (invalida em escritas). */
const CACHE_KEY = 'fluxos:listagem';

const MODULO = 'fluxos';
const TIPO_OBJETO = 'Fluxo';

function resolveDeps(deps?: Partial<FluxosServiceDeps>): FluxosServiceDeps {
  return {
    prisma: deps?.prisma ?? defaultPrisma,
    redis: deps?.redis ?? (defaultRedis as unknown as RedisLike),
    auditar: deps?.auditar ?? defaultRegistrar,
  };
}

/**
 * Calcula o prazo total estimado do Fluxo (Req. 15.5) — soma dos prazos em dias
 * úteis de todas as Etapas. Reexporta o cálculo compartilhado para uso do
 * controller/serviço.
 */
export function calcularPrazoTotal(etapas: ReadonlyArray<{ prazosDiasUteis: number }>): number {
  return calcularPrazoTotalFluxo(etapas);
}

/**
 * Valida a lista de Etapas de um Fluxo antes de persistir.
 *  - Rejeita lista vazia (Req. 15.6).
 *  - Rejeita mais de 50 Etapas (Req. 15.1).
 *  - Rejeita Etapa com nome vazio ou prazo fora de [1,365] (Req. 15.7).
 */
function validarEtapas(etapas: EtapaDto[] | undefined): asserts etapas is EtapaDto[] {
  if (!etapas || etapas.length === 0) {
    throw badRequest(ErrorCodes.CAMPO_OBRIGATORIO, 'O fluxo deve ter ao menos uma etapa', 'etapas');
  }
  if (etapas.length > ETAPAS_MAX) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `Um fluxo pode ter no máximo ${ETAPAS_MAX} etapas`,
      'etapas',
    );
  }
  etapas.forEach((etapa, index) => {
    const nome = etapa.nome?.trim() ?? '';
    if (nome.length === 0) {
      throw badRequest(
        ErrorCodes.CAMPO_OBRIGATORIO,
        'O nome da etapa é obrigatório',
        `etapas.${index}.nome`,
      );
    }
    if (
      !Number.isInteger(etapa.prazosDiasUteis) ||
      etapa.prazosDiasUteis < PRAZO_MIN ||
      etapa.prazosDiasUteis > PRAZO_MAX
    ) {
      throw badRequest(
        ErrorCodes.VALIDATION_ERROR,
        `O prazo da etapa deve estar entre ${PRAZO_MIN} e ${PRAZO_MAX} dias úteis`,
        `etapas.${index}.prazosDiasUteis`,
      );
    }
  });
}

/**
 * Monta o payload aninhado de criação de Etapas (com `ordem` sequencial pelo
 * índice e automações aninhadas) para uso no `prisma.fluxo.create`.
 */
function montarEtapasCreate(etapas: EtapaDto[]) {
  return etapas.map((etapa, index) => ({
    nome: etapa.nome.trim(),
    prazosDiasUteis: etapa.prazosDiasUteis,
    ordem: index,
    servidorPadraoId: etapa.servidorPadraoId,
    automacoes: etapa.automacoes && etapa.automacoes.length > 0
      ? {
          create: etapa.automacoes.map((a) => ({ tipo: a.tipo, payload: a.payload })),
        }
      : undefined,
  }));
}

/** Include padrão: Etapas ordenadas por `ordem` com suas automações. */
const includeEtapas = {
  etapas: {
    orderBy: { ordem: 'asc' as const },
    include: { automacoes: true },
  },
};

/**
 * Lista os Fluxos com suas Etapas (ordenadas por `ordem`).
 */
export async function listar(deps?: Partial<FluxosServiceDeps>) {
  const { prisma } = resolveDeps(deps);
  return prisma.fluxo.findMany({
    include: includeEtapas,
    orderBy: { criadoEm: 'desc' },
  });
}

/**
 * Obtém um Fluxo com suas Etapas (ordenadas) e automações, acrescentando o
 * prazo total estimado calculado (Req. 15.5).
 */
export async function obter(id: string, deps?: Partial<FluxosServiceDeps>) {
  const { prisma } = resolveDeps(deps);

  const fluxo = await prisma.fluxo.findUnique({
    where: { id },
    include: includeEtapas,
  });
  if (!fluxo) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Fluxo não encontrado');
  }

  return {
    ...fluxo,
    prazoTotalDiasUteis: calcularPrazoTotal(fluxo.etapas),
  };
}

/**
 * Cria um novo Fluxo (versão 1) com suas Etapas e automações aninhadas.
 * Rejeita Etapas vazias (Req. 15.6) e Etapas inválidas (Req. 15.7), registra
 * auditoria com data/hora e identidade do responsável (Req. 15.8).
 */
export async function criar(dto: CriarFluxoDto, ator: Ator, deps?: Partial<FluxosServiceDeps>) {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const nome = dto.nome.trim();
  if (nome.length === 0) {
    throw badRequest(ErrorCodes.CAMPO_OBRIGATORIO, 'O nome do fluxo é obrigatório', 'nome');
  }
  validarEtapas(dto.etapas);

  const criado = await prisma.fluxo.create({
    data: {
      nome,
      versao: 1,
      criadoPorId: ator.servidorId,
      etapas: {
        create: montarEtapasCreate(dto.etapas),
      },
    },
    include: includeEtapas,
  });

  await redis.del(CACHE_KEY);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'criar_fluxo',
    modulo: MODULO,
    objetoId: criado.id,
    tipoObjeto: TIPO_OBJETO,
    valorPosterior: { nome: criado.nome, versao: criado.versao, etapas: criado.etapas.length },
  });

  return criado;
}

/**
 * Salva a edição de um Fluxo aplicando VERSIONAMENTO (Req. 15.4).
 *
 * Em vez de mutar o Fluxo existente (que Processos anteriores referenciam via
 * `fluxoVersaoId`), cria uma NOVA linha de Fluxo com `versao = anterior + 1` e
 * as novas Etapas. O Fluxo anterior permanece intacto, de modo que os Processos
 * existentes continuam vinculados à versão antiga.
 *
 * Rejeita Etapas vazias (Req. 15.6) / inválidas (Req. 15.7) e registra
 * auditoria (Req. 15.8).
 */
export async function salvarEdicao(
  id: string,
  dto: EditarFluxoDto,
  ator: Ator,
  deps?: Partial<FluxosServiceDeps>,
) {
  const { prisma, redis, auditar } = resolveDeps(deps);

  const anterior = await prisma.fluxo.findUnique({
    where: { id },
    select: { id: true, versao: true, nome: true },
  });
  if (!anterior) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Fluxo não encontrado');
  }

  const nome = dto.nome.trim();
  if (nome.length === 0) {
    throw badRequest(ErrorCodes.CAMPO_OBRIGATORIO, 'O nome do fluxo é obrigatório', 'nome');
  }
  validarEtapas(dto.etapas);

  // Nova VERSÃO: cria um novo Fluxo, preservando o anterior (Req. 15.4).
  const novaVersao = await prisma.fluxo.create({
    data: {
      nome,
      versao: anterior.versao + 1,
      criadoPorId: ator.servidorId,
      etapas: {
        create: montarEtapasCreate(dto.etapas),
      },
    },
    include: includeEtapas,
  });

  await redis.del(CACHE_KEY);

  await auditar({
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao: 'editar_fluxo',
    modulo: MODULO,
    objetoId: novaVersao.id,
    tipoObjeto: TIPO_OBJETO,
    valorAnterior: { fluxoId: anterior.id, versao: anterior.versao },
    valorPosterior: { fluxoId: novaVersao.id, versao: novaVersao.versao, etapas: novaVersao.etapas.length },
  });

  return novaVersao;
}
