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
export declare const RBAC_MATRIX_POR_NIVEL: Record<NivelAcesso, readonly Permissao[]>;
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
export declare function temPermissao(nivel: number | undefined, permissions: readonly Permissao[] | undefined, permissao: Permissao): boolean;
//# sourceMappingURL=rbac.d.ts.map