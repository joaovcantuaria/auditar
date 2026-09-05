import type { PrismaClient, PreferenciaNotificacao } from '@prisma/client';
import { TipoEvento, CanalNotificacao } from '@auditar/shared';
import { prisma as realPrisma } from '../../config/database.js';
import type { SalvarPreferenciasInput } from './preferencias.schema.js';

/**
 * Serviço de Preferências de Notificação do Cidadão (Req. 6.3, 6.4).
 *
 * O modelo `PreferenciaNotificacao` guarda uma linha por tipo de evento, cada
 * uma com a lista de canais escolhidos. O horário de silêncio (`inicioSilencio`
 * / `fimSilencio`) é uma configuração única do cidadão; como o schema o
 * armazena por linha, o mesmo par é REPLICADO em todas as linhas ao salvar
 * (Req. 6.4). A leitura extrai a janela da primeira linha que a possuir.
 *
 * O salvamento é uma operação trivial (deleta as linhas antigas e recria as
 * novas em massa), concluindo bem abaixo do limite de 5 segundos (Req. 6.3). A
 * aplicação efetiva do horário de silêncio no momento do envio pertence ao
 * NotificaçãoWorker (task 9.1); aqui apenas persistimos a preferência.
 */

// ---------------------------------------------------------------------------
// Injeção de dependências (usa a instância real por padrão; testes injetam mock)
// ---------------------------------------------------------------------------

export interface PreferenciasDeps {
  prisma: Pick<PrismaClient, 'preferenciaNotificacao'>;
}

function resolveDeps(deps?: Partial<PreferenciasDeps>): PreferenciasDeps {
  return {
    prisma: deps?.prisma ?? (realPrisma as unknown as PreferenciasDeps['prisma']),
  };
}

// ---------------------------------------------------------------------------
// Tipos e defaults
// ---------------------------------------------------------------------------

/** Todos os tipos de evento de notificação (Req. 6.1). */
export const TODOS_TIPOS_EVENTO = Object.values(TipoEvento) as TipoEvento[];

/** Canais padrão quando o cidadão ainda não configurou preferências. */
export const CANAIS_PADRAO: CanalNotificacao[] = [
  CanalNotificacao.PAINEL,
  CanalNotificacao.EMAIL,
];

/** Uma preferência por evento, conforme exposta ao cliente. */
export interface PreferenciaResumo {
  tipoEvento: string;
  canais: string[];
}

/** Conjunto de preferências do cidadão + janela de silêncio opcional. */
export interface PreferenciasCidadao {
  preferencias: PreferenciaResumo[];
  inicioSilencio: string | null;
  fimSilencio: string | null;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Preferências padrão: todos os eventos → [painel, email], sem silêncio. */
function preferenciasPadrao(): PreferenciasCidadao {
  return {
    preferencias: TODOS_TIPOS_EVENTO.map((tipoEvento) => ({
      tipoEvento,
      canais: [...CANAIS_PADRAO],
    })),
    inicioSilencio: null,
    fimSilencio: null,
  };
}

/** Converte as linhas persistidas na forma exposta ao cliente. */
function mapearLinhas(linhas: PreferenciaNotificacao[]): PreferenciasCidadao {
  const comJanela = linhas.find(
    (l) => l.inicioSilencio != null || l.fimSilencio != null,
  );
  return {
    preferencias: linhas.map((l) => ({
      tipoEvento: l.tipoEvento,
      canais: l.canais,
    })),
    inicioSilencio: comJanela?.inicioSilencio ?? null,
    fimSilencio: comJanela?.fimSilencio ?? null,
  };
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

/**
 * Retorna as preferências de notificação do cidadão. Se ainda não houver
 * nenhuma preferência salva, retorna os padrões sensatos (todos os eventos com
 * [painel, email] e sem horário de silêncio) — Req. 6.3, 6.7.
 */
export async function obterPreferencias(
  cidadaoId: string,
  deps?: Partial<PreferenciasDeps>,
): Promise<PreferenciasCidadao> {
  const { prisma } = resolveDeps(deps);

  const linhas = await prisma.preferenciaNotificacao.findMany({
    where: { cidadaoId },
  });

  if (linhas.length === 0) {
    return preferenciasPadrao();
  }

  return mapearLinhas(linhas);
}

/**
 * Salva as preferências de notificação do cidadão (Req. 6.3, 6.4). Substitui
 * todas as linhas existentes por uma linha por tipo de evento informado, com os
 * canais escolhidos. O horário de silêncio (`inicioSilencio`/`fimSilencio`) é
 * replicado em todas as linhas para atender ao formato do schema. Concluído bem
 * abaixo dos 5 segundos exigidos. Retorna as preferências salvas.
 */
export async function salvarPreferencias(
  cidadaoId: string,
  dto: SalvarPreferenciasInput,
  deps?: Partial<PreferenciasDeps>,
): Promise<PreferenciasCidadao> {
  const { prisma } = resolveDeps(deps);

  const inicioSilencio = dto.inicioSilencio ?? null;
  const fimSilencio = dto.fimSilencio ?? null;

  // Substitui completamente as preferências do cidadão: remove as antigas e
  // recria uma linha por tipo de evento com os canais escolhidos.
  await prisma.preferenciaNotificacao.deleteMany({ where: { cidadaoId } });

  if (dto.preferencias.length > 0) {
    await prisma.preferenciaNotificacao.createMany({
      data: dto.preferencias.map((p) => ({
        cidadaoId,
        tipoEvento: p.tipoEvento,
        canais: p.canais,
        inicioSilencio,
        fimSilencio,
      })),
    });
  }

  return {
    preferencias: dto.preferencias.map((p) => ({
      tipoEvento: p.tipoEvento,
      canais: [...p.canais],
    })),
    inicioSilencio,
    fimSilencio,
  };
}
