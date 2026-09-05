import { TipoCampo } from '@auditar/shared';
import type { CampoFormulario, FormularioDinamico } from '@auditar/shared';

/**
 * Tipos compartilhados do módulo de Formulários Dinâmicos (Portal do Cidadão).
 *
 * O backend (`GET /api/v1/formularios?tipoId=&unidadeId=`) devolve o
 * `FormularioDinamico` ATIVO do par Tipo de Processo + Unidade, com seus
 * `campos` já ordenados por `ordem` crescente. O shape espelha exatamente o
 * modelo Prisma / `@auditar/shared`:
 *
 * Campo (`CampoFormulario`):
 *   { id, formularioId, tipo, rotulo (≤100), descricaoAuxiliar? (≤300),
 *     obrigatorio, validacao? (regex), valorPadrao?, ordem, opcoes? (string[]) }
 *
 * Tipos válidos (`TipoCampo`): texto_curto, texto_longo, numero, data,
 * selecao_unica, selecao_multipla, upload, cpf.
 *
 * _Requirements: 16.1, 16.2, 16.5, 16.6, 16.7_
 */

/** Formulário com seus campos, como retornado pelo endpoint público. */
export interface FormularioComCampos extends FormularioDinamico {
  campos: CampoFormulario[];
}

/**
 * Envelope de resposta da API pública. O controller responde
 * `{ data: <FormularioComCampos> }` em caso de sucesso (200).
 */
export interface FormularioApiResponse {
  data: FormularioComCampos;
}

/**
 * Valor de um campo no estado do formulário renderizado.
 *
 * - texto_curto / texto_longo / cpf: `string`
 * - numero: `string` (valor bruto do input; convertido pelo caller ao submeter)
 * - data: `string` no formato ISO `YYYY-MM-DD`
 * - selecao_unica: `string` (valor selecionado)
 * - selecao_multipla: `string[]` (valores marcados)
 * - upload: `File[]` — o binário é tratado pelo caller/wizard, não pelo renderer
 */
export type FormFieldValue = string | string[] | File[] | undefined;

/** Mapa `campoId -> valor` que representa o estado completo do formulário. */
export type FormValues = Record<string, FormFieldValue>;

/** Mapa `campoId -> mensagem de erro` (adjacente ao campo — Req. 16.7). */
export type FormErrors = Record<string, string | undefined>;

/**
 * Uma resposta no formato esperado pelo endpoint de criação de processo
 * (`POST /api/v1/processos`), que persiste `RespostaFormulario[]`.
 */
export interface RespostaFormularioInput {
  campoId: string;
  valor: string;
}

/** Comprimentos máximos por tipo, conforme Req. 16.1. */
export const MAX_LENGTH_TEXTO_CURTO = 255;
export const MAX_LENGTH_TEXTO_LONGO = 4000;

/** Type guard: o `tipo` (string do backend) é um `TipoCampo` conhecido. */
export function isTipoCampo(tipo: string): tipo is TipoCampo {
  return (Object.values(TipoCampo) as string[]).includes(tipo);
}

/** Normaliza `opcoes` (Json? no backend) para um array de strings seguro. */
export function normalizarOpcoes(opcoes: CampoFormulario['opcoes']): string[] {
  if (!Array.isArray(opcoes)) return [];
  return opcoes.filter((o): o is string => typeof o === 'string');
}

/** Normaliza `valorPadrao` (unknown no backend) para string, quando aplicável. */
export function valorPadraoComoString(valorPadrao: CampoFormulario['valorPadrao']): string {
  return typeof valorPadrao === 'string' ? valorPadrao : '';
}
