/**
 * Tipos do módulo de Auditoria.
 *
 * O registro de auditoria captura QUEM (ator), O QUE (tipoAcao/modulo),
 * SOBRE O QUE (objetoId/tipoObjeto), COM QUAL RESULTADO (valorAnterior/valorPosterior)
 * e DE ONDE (enderecoIp) uma ação foi realizada.
 *
 * Requisitos: 17.1, 17.3, 17.8, 11.9
 */

export type AtorAuditoria = 'cidadao' | 'servidor' | 'sistema';

export interface RegistrarAuditoriaDto {
  /** Categoria do ator que realizou a ação. */
  ator: AtorAuditoria;
  /** Id do cidadão, quando o ator for um cidadão. */
  atorCidadaoId?: string;
  /** Id do servidor, quando o ator for um servidor. */
  atorServidorId?: string;
  /** Endereço IP de origem da requisição. */
  enderecoIp: string;
  /** Ação executada. ex: 'login', 'criar_processo', 'mover_etapa', 'alterar_permissoes'. */
  tipoAcao: string;
  /** Módulo de origem. ex: 'auth', 'processos', 'servidores'. */
  modulo: string;
  /** Identificador do objeto afetado (opcional). */
  objetoId?: string;
  /** Tipo do objeto afetado (opcional). ex: 'Processo', 'Servidor'. */
  tipoObjeto?: string;
  /** Valor anterior à ação. Será serializado em JSON e truncado para 1000 caracteres. */
  valorAnterior?: unknown;
  /** Valor posterior à ação. Será serializado em JSON e truncado para 1000 caracteres. */
  valorPosterior?: unknown;
}

/**
 * Payload transportado pela fila `auditoria-queue`. Diferencia-se do DTO por já
 * conter os valores anterior/posterior serializados e truncados, prontos para
 * persistência direta pelo worker.
 */
export interface AuditoriaJobData {
  ator: AtorAuditoria;
  atorCidadaoId?: string;
  atorServidorId?: string;
  enderecoIp: string;
  tipoAcao: string;
  modulo: string;
  objetoId?: string;
  tipoObjeto?: string;
  valorAnterior?: string;
  valorPosterior?: string;
}
