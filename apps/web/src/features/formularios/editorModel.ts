import { TipoCampo } from '@auditar/shared';
import type { CampoFormulario } from '@auditar/shared';
import type { CampoPayload } from './formulariosAdmin.api';
import { normalizarOpcoes, valorPadraoComoString } from './formulario.types';

/**
 * Modelo de rascunho (client-side) do editor de Formulários Dinâmicos e sua
 * validação (task 16.3).
 *
 * O editor mantém uma lista ordenada de `CampoDraft` — cada um com um `key`
 * local estável (para o React e o drag-and-drop) além dos dados do campo. A
 * ordem no array define a `ordem` enviada ao backend.
 *
 * Validação client-side (bloqueia o salvamento, Req. 16.3):
 *  - `rotulo` obrigatório (não vazio, ≤100 chars);
 *  - `valorPadrao` compatível com o `tipo` (mesma regra do backend);
 *  - `descricaoAuxiliar` ≤300 chars;
 *  - campos de seleção exigem ao menos uma opção não vazia;
 *  - máximo de 50 campos por formulário.
 *
 * As regras de compatibilidade de `valorPadrao` espelham exatamente o
 * `validarValorPadrao` do backend
 * (`apps/api/src/modules/formularios/formularios.schema.ts`) para evitar
 * rejeições no servidor após passar a validação local.
 *
 * _Requirements: 16.1, 16.2, 16.3, 16.4_
 */

/** Limites (espelham o backend). */
export const MAX_ROTULO = 100;
export const MAX_DESCRICAO = 300;
export const MAX_VALIDACAO = 500;
export const MAX_CAMPOS = 50;

/** Tipos de campo que exigem a definição de `opcoes`. */
export const TIPOS_COM_OPCOES: readonly TipoCampo[] = [
  TipoCampo.SELECAO_UNICA,
  TipoCampo.SELECAO_MULTIPLA,
];

/** Rótulos legíveis (pt-BR) por tipo de campo, para o seletor de tipo. */
export const TIPO_CAMPO_LABEL: Record<TipoCampo, string> = {
  [TipoCampo.TEXTO_CURTO]: 'Texto curto',
  [TipoCampo.TEXTO_LONGO]: 'Texto longo',
  [TipoCampo.NUMERO]: 'Número',
  [TipoCampo.DATA]: 'Data',
  [TipoCampo.SELECAO_UNICA]: 'Seleção única',
  [TipoCampo.SELECAO_MULTIPLA]: 'Seleção múltipla',
  [TipoCampo.UPLOAD]: 'Upload de arquivo',
  [TipoCampo.CPF]: 'CPF',
};

/** True quando o tipo requer `opcoes`. */
export function exigeOpcoes(tipo: TipoCampo): boolean {
  return TIPOS_COM_OPCOES.includes(tipo);
}

/**
 * Rascunho de um campo no editor. O `key` é um identificador local estável
 * (não persistido) usado como chave de lista e como id do item arrastável.
 */
export interface CampoDraft {
  /** Chave local estável (uuid-like) para React e drag-and-drop. */
  key: string;
  tipo: TipoCampo;
  rotulo: string;
  descricaoAuxiliar: string;
  obrigatorio: boolean;
  validacao: string;
  valorPadrao: string;
  /** Opções (para seleção única/múltipla). Ignorado nos demais tipos. */
  opcoes: string[];
}

/** Erros de validação de um campo (`campo -> mensagem`). */
export interface CampoDraftErros {
  rotulo?: string;
  descricaoAuxiliar?: string;
  valorPadrao?: string;
  validacao?: string;
  opcoes?: string;
}

/** Gera uma chave local única para um `CampoDraft`. */
export function novaKey(): string {
  return `campo-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** Cria um campo em branco do tipo informado (padrão: texto curto). */
export function novoCampoDraft(tipo: TipoCampo = TipoCampo.TEXTO_CURTO): CampoDraft {
  return {
    key: novaKey(),
    tipo,
    rotulo: '',
    descricaoAuxiliar: '',
    obrigatorio: false,
    validacao: '',
    valorPadrao: '',
    opcoes: exigeOpcoes(tipo) ? [''] : [],
  };
}

/** Converte um `CampoFormulario` (backend) num `CampoDraft` do editor. */
export function campoParaDraft(campo: CampoFormulario): CampoDraft {
  const tipo = (Object.values(TipoCampo) as string[]).includes(campo.tipo)
    ? (campo.tipo as TipoCampo)
    : TipoCampo.TEXTO_CURTO;
  return {
    key: campo.id || novaKey(),
    tipo,
    rotulo: campo.rotulo ?? '',
    descricaoAuxiliar: campo.descricaoAuxiliar ?? '',
    obrigatorio: Boolean(campo.obrigatorio),
    validacao: campo.validacao ?? '',
    valorPadrao: valorPadraoComoString(campo.valorPadrao),
    opcoes: normalizarOpcoes(campo.opcoes),
  };
}

/**
 * Verifica se um `valorPadrao` é compatível com o `tipo` (Req. 16.2/16.3).
 * Espelha `validarValorPadrao` do backend: valor vazio é sempre compatível.
 */
export function valorPadraoCompativel(tipo: TipoCampo, valorPadrao: string): boolean {
  const v = valorPadrao?.trim() ?? '';
  if (v === '') return true;

  switch (tipo) {
    case TipoCampo.NUMERO:
      return /^-?\d+(\.\d+)?$/.test(v);
    case TipoCampo.DATA:
      return !Number.isNaN(Date.parse(v));
    case TipoCampo.CPF:
      return v.replace(/\D/g, '').length === 11;
    case TipoCampo.SELECAO_UNICA:
    case TipoCampo.SELECAO_MULTIPLA:
      // O valor padrão, quando informado, deve ser uma das opções.
      return true; // validado adicionalmente contra opções em `validarCampoDraft`
    default:
      return true;
  }
}

/** Mensagens de erro (pt-BR) do editor. */
export const erroMsg = {
  rotuloObrigatorio: 'Rótulo é obrigatório',
  rotuloLongo: `Máximo de ${MAX_ROTULO} caracteres`,
  descricaoLonga: `Máximo de ${MAX_DESCRICAO} caracteres`,
  validacaoLonga: `Máximo de ${MAX_VALIDACAO} caracteres`,
  valorPadraoIncompativel: 'Valor padrão incompatível com o tipo do campo',
  valorPadraoForaOpcoes: 'Valor padrão deve ser uma das opções',
  opcoesObrigatorias: 'Informe ao menos uma opção',
  regexInvalida: 'Expressão de validação inválida',
} as const;

/** Compila com segurança uma regex; `true` se válida (ou vazia). */
function regexValida(pattern: string): boolean {
  if (!pattern) return true;
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Valida um único campo do editor, retornando o mapa de erros (vazio = válido).
 * Aplica as regras do Req. 16.3 (rótulo obrigatório e valor padrão compatível).
 */
export function validarCampoDraft(campo: CampoDraft): CampoDraftErros {
  const erros: CampoDraftErros = {};

  // Rótulo obrigatório (Req. 16.3).
  if (!campo.rotulo || campo.rotulo.trim().length === 0) {
    erros.rotulo = erroMsg.rotuloObrigatorio;
  } else if (campo.rotulo.length > MAX_ROTULO) {
    erros.rotulo = erroMsg.rotuloLongo;
  }

  if (campo.descricaoAuxiliar.length > MAX_DESCRICAO) {
    erros.descricaoAuxiliar = erroMsg.descricaoLonga;
  }

  if (campo.validacao.length > MAX_VALIDACAO) {
    erros.validacao = erroMsg.validacaoLonga;
  } else if (!regexValida(campo.validacao)) {
    erros.validacao = erroMsg.regexInvalida;
  }

  // Opções obrigatórias para tipos de seleção.
  const opcoesLimpa = campo.opcoes.map((o) => o.trim()).filter((o) => o.length > 0);
  if (exigeOpcoes(campo.tipo) && opcoesLimpa.length === 0) {
    erros.opcoes = erroMsg.opcoesObrigatorias;
  }

  // Valor padrão compatível com o tipo (Req. 16.3).
  const vp = campo.valorPadrao?.trim() ?? '';
  if (vp !== '') {
    if (!valorPadraoCompativel(campo.tipo, campo.valorPadrao)) {
      erros.valorPadrao = erroMsg.valorPadraoIncompativel;
    } else if (exigeOpcoes(campo.tipo) && opcoesLimpa.length > 0 && !opcoesLimpa.includes(vp)) {
      // Para seleção, o valor padrão precisa ser uma das opções definidas.
      erros.valorPadrao = erroMsg.valorPadraoForaOpcoes;
    }
  }

  return erros;
}

/** True quando o mapa de erros de um campo está vazio. */
export function campoValido(erros: CampoDraftErros): boolean {
  return Object.keys(erros).length === 0;
}

/**
 * Valida a lista completa de campos, retornando um mapa `key -> erros`. Só
 * inclui entradas com pelo menos um erro. Também impõe o limite de 50 campos.
 */
export function validarCampos(campos: CampoDraft[]): {
  porCampo: Record<string, CampoDraftErros>;
  erroGlobal?: string;
} {
  const porCampo: Record<string, CampoDraftErros> = {};
  for (const campo of campos) {
    const erros = validarCampoDraft(campo);
    if (!campoValido(erros)) {
      porCampo[campo.key] = erros;
    }
  }
  const erroGlobal =
    campos.length > MAX_CAMPOS
      ? `Um formulário pode ter no máximo ${MAX_CAMPOS} campos`
      : campos.length === 0
        ? 'Adicione ao menos um campo ao formulário'
        : undefined;

  return { porCampo, erroGlobal };
}

/** True quando toda a lista está válida e apta a salvar. */
export function formularioAptoParaSalvar(campos: CampoDraft[]): boolean {
  const { porCampo, erroGlobal } = validarCampos(campos);
  return !erroGlobal && Object.keys(porCampo).length === 0;
}

/**
 * Converte a lista de rascunhos no payload de campos do backend, derivando a
 * `ordem` da posição no array (Req. 16.4) e limpando opções vazias. Campos que
 * não são de seleção não enviam `opcoes`.
 */
export function draftsParaPayload(campos: CampoDraft[]): CampoPayload[] {
  return campos.map((campo, index) => {
    const base: CampoPayload = {
      tipo: campo.tipo,
      rotulo: campo.rotulo.trim(),
      obrigatorio: campo.obrigatorio,
      ordem: index,
    };
    const descricao = campo.descricaoAuxiliar.trim();
    if (descricao) base.descricaoAuxiliar = descricao;

    const validacao = campo.validacao.trim();
    if (validacao) base.validacao = validacao;

    const valorPadrao = campo.valorPadrao.trim();
    if (valorPadrao) base.valorPadrao = valorPadrao;

    if (exigeOpcoes(campo.tipo)) {
      base.opcoes = campo.opcoes.map((o) => o.trim()).filter((o) => o.length > 0);
    }
    return base;
  });
}

/**
 * Converte os rascunhos em `CampoFormulario[]` "sintéticos" para alimentar o
 * `DynamicFormRenderer` no painel de PREVIEW ao vivo. Usa o `key` local como
 * `id` do campo (estável dentro da sessão de edição).
 */
export function draftsParaCamposPreview(campos: CampoDraft[]): CampoFormulario[] {
  return campos.map((campo, index) => ({
    id: campo.key,
    formularioId: 'preview',
    tipo: campo.tipo,
    rotulo: campo.rotulo.trim() || `Campo ${index + 1}`,
    descricaoAuxiliar: campo.descricaoAuxiliar.trim() || null,
    obrigatorio: campo.obrigatorio,
    validacao: campo.validacao.trim() || null,
    valorPadrao: campo.valorPadrao.trim() || null,
    ordem: index,
    opcoes: exigeOpcoes(campo.tipo)
      ? campo.opcoes.map((o) => o.trim()).filter((o) => o.length > 0)
      : null,
  }));
}
