// RBAC — Fonte única de verdade de permissões por nível de acesso.
//
// Esta matriz e a função `temPermissao` são compartilhadas entre a API
// (`apps/api/src/middleware/rbac.ts`) e o frontend (`apps/web`), garantindo
// que backend e cliente apliquem EXATAMENTE a mesma regra de autorização.
//
// A decisão de permissão combina duas fontes:
//   1. A matriz base do nível de acesso do usuário (`RBAC_MATRIX_POR_NIVEL`).
//   2. As permissões granulares atribuídas individualmente (override aditivo,
//      ex.: Analista com REJEITAR concedido pelo Administrador — Req. 8.6).

import { NivelAcesso, Permissao } from './constants/index.js';

/**
 * Matriz de permissões por nível de acesso — espelha a tabela
 * "RBAC — Matrix de Permissões por Nível" do design.
 *
 * Observações:
 * - Administrador (1) recebe todas as permissões.
 * - Permissões marcadas com "G*" no design (ex.: REJEITAR/APROVAR do Analista)
 *   dependem de permissão granular concedida pelo Administrador (Req. 8.6),
 *   portanto NÃO constam na matriz base — chegam via `permissions`.
 */
export const RBAC_MATRIX_POR_NIVEL: Record<NivelAcesso, readonly Permissao[]> = {
  [NivelAcesso.ADMINISTRADOR]: [
    Permissao.VISUALIZAR,
    Permissao.EDITAR,
    Permissao.MOVER_ETAPA,
    Permissao.REJEITAR,
    Permissao.SOLICITAR_DOCUMENTOS,
    Permissao.OBSERVACAO_PUBLICA,
    Permissao.OBSERVACAO_INTERNA,
    Permissao.ACESSAR_RELATORIOS,
    Permissao.GERENCIAR_USUARIOS,
    Permissao.CONFIGURAR_FLUXOS,
    Permissao.ACESSAR_AUDITORIA,
    Permissao.ATRIBUIR,
    Permissao.APROVAR,
    Permissao.GERENCIAR_TAREFAS,
  ],
  [NivelAcesso.GESTOR_GERAL]: [Permissao.VISUALIZAR, Permissao.ACESSAR_RELATORIOS],
  [NivelAcesso.GESTOR_CATEGORIA]: [
    Permissao.VISUALIZAR,
    Permissao.OBSERVACAO_INTERNA,
    Permissao.ACESSAR_RELATORIOS,
    Permissao.CONFIGURAR_FLUXOS,
  ],
  [NivelAcesso.GESTOR_UNIDADE]: [
    Permissao.VISUALIZAR,
    Permissao.EDITAR,
    Permissao.MOVER_ETAPA,
    Permissao.REJEITAR,
    Permissao.SOLICITAR_DOCUMENTOS,
    Permissao.OBSERVACAO_PUBLICA,
    Permissao.OBSERVACAO_INTERNA,
    Permissao.ACESSAR_RELATORIOS,
    Permissao.ATRIBUIR,
    Permissao.APROVAR,
  ],
  [NivelAcesso.ANALISTA]: [
    Permissao.VISUALIZAR,
    Permissao.EDITAR,
    Permissao.MOVER_ETAPA,
    Permissao.SOLICITAR_DOCUMENTOS,
    Permissao.OBSERVACAO_PUBLICA,
    Permissao.OBSERVACAO_INTERNA,
    // REJEITAR e APROVAR: apenas via permissão granular (Req. 8.6)
  ],
  [NivelAcesso.INSPETOR]: [
    Permissao.VISUALIZAR,
    Permissao.OBSERVACAO_PUBLICA,
    Permissao.OBSERVACAO_INTERNA,
  ],
  [NivelAcesso.VISUALIZADOR]: [Permissao.VISUALIZAR, Permissao.ACESSAR_RELATORIOS],
};

/**
 * Verifica se um usuário possui a permissão informada, considerando tanto a
 * matriz do seu nível de acesso quanto suas permissões granulares.
 *
 * Retorna `true` quando:
 * - a matriz do `nivel` inclui a `permissao`, OU
 * - a `permissao` está na lista de `permissions` granulares.
 *
 * @param nivel       nível de acesso do usuário (`NivelAcesso`); indefinido = sem nível
 * @param permissions permissões granulares atribuídas (aditivas)
 * @param permissao   permissão requerida
 * @returns true quando o usuário está autorizado
 */
export function temPermissao(
  nivel: number | undefined,
  permissions: readonly Permissao[] | undefined,
  permissao: Permissao,
): boolean {
  // Override granular (aditivo)
  if (permissions?.includes(permissao)) return true;

  // Matriz base por nível
  if (typeof nivel === 'number') {
    const permitidas = RBAC_MATRIX_POR_NIVEL[nivel as NivelAcesso];
    if (permitidas?.includes(permissao)) return true;
  }

  return false;
}
