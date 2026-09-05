import { z } from 'zod';
import { TipoCampo, validarCPF } from '@auditar/shared';
import type { CampoFormulario } from '@auditar/shared';
import {
  MAX_LENGTH_TEXTO_CURTO,
  MAX_LENGTH_TEXTO_LONGO,
  normalizarOpcoes,
  valorPadraoComoString,
  type FormFieldValue,
  type FormValues,
  type RespostaFormularioInput,
} from './formulario.types';

/**
 * Construção de validação a partir da configuração dos campos.
 *
 * Este módulo é a fonte única de verdade da validação do Formulário Dinâmico:
 * é usado tanto pela validação por campo (on blur — Req. 16.7) quanto pela
 * validação completa que o wizard (task 13.2) usa para liberar o avanço de
 * etapa. Mantê-lo isolado do componente garante que renderer e wizard
 * compartilhem exatamente as mesmas regras.
 *
 * Regras derivadas da configuração do campo (Req. 16.1/16.2):
 * - `obrigatorio`: valor não pode ser vazio;
 * - `validacao` (regex): aplicada a campos textuais quando preenchidos;
 * - limites de tamanho por tipo (texto_curto ≤255, texto_longo ≤4000);
 * - `numero`: string numérica (inteiro/decimal);
 * - `data`: data válida (`YYYY-MM-DD`);
 * - `cpf`: 11 dígitos com dígitos verificadores válidos (`validarCPF`);
 * - `selecao_unica`: um valor entre as `opcoes`;
 * - `selecao_multipla`: subconjunto (possivelmente vazio) das `opcoes`;
 * - `upload`: ao menos um arquivo quando obrigatório.
 *
 * _Requirements: 16.1, 16.2, 16.7_
 */

/** Mensagens de erro padrão (pt-BR), reutilizadas por campo. */
export const mensagens = {
  obrigatorio: 'Campo obrigatório',
  formato: 'Formato inválido',
  numero: 'Informe um número válido',
  data: 'Informe uma data válida',
  cpf: 'CPF inválido',
  maxTexto: (max: number) => `Máximo de ${max} caracteres`,
  opcaoInvalida: 'Selecione uma opção válida',
} as const;

const NUMERO_REGEX = /^-?\d+(\.\d+)?$/;
const DATA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** True quando o valor do campo é considerado "vazio" para fins de obrigatoriedade. */
export function isVazio(valor: FormFieldValue): boolean {
  if (valor === undefined || valor === null) return true;
  if (typeof valor === 'string') return valor.trim().length === 0;
  if (Array.isArray(valor)) return valor.length === 0;
  return false;
}

/** Compila com segurança a regex de `validacao`; retorna `null` se inválida. */
function compilarRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/**
 * Valida um único campo contra o valor informado, retornando a mensagem de erro
 * ou `undefined` quando válido. Não altera o valor (Req. 16.7).
 */
export function validarCampo(campo: CampoFormulario, valor: FormFieldValue): string | undefined {
  const vazio = isVazio(valor);

  if (campo.obrigatorio && vazio) {
    return mensagens.obrigatorio;
  }

  // Campo opcional e vazio: nada a validar.
  if (vazio) return undefined;

  switch (campo.tipo as TipoCampo) {
    case TipoCampo.TEXTO_CURTO: {
      const s = String(valor);
      if (s.length > MAX_LENGTH_TEXTO_CURTO) return mensagens.maxTexto(MAX_LENGTH_TEXTO_CURTO);
      return validarRegex(campo, s);
    }
    case TipoCampo.TEXTO_LONGO: {
      const s = String(valor);
      if (s.length > MAX_LENGTH_TEXTO_LONGO) return mensagens.maxTexto(MAX_LENGTH_TEXTO_LONGO);
      return validarRegex(campo, s);
    }
    case TipoCampo.NUMERO: {
      const s = String(valor).trim();
      if (!NUMERO_REGEX.test(s)) return mensagens.numero;
      return validarRegex(campo, s);
    }
    case TipoCampo.DATA: {
      const s = String(valor).trim();
      if (!DATA_ISO_REGEX.test(s) || Number.isNaN(Date.parse(s))) return mensagens.data;
      return undefined;
    }
    case TipoCampo.CPF: {
      const s = String(valor);
      if (!validarCPF(s)) return mensagens.cpf;
      return undefined;
    }
    case TipoCampo.SELECAO_UNICA: {
      const opcoes = normalizarOpcoes(campo.opcoes);
      if (!opcoes.includes(String(valor))) return mensagens.opcaoInvalida;
      return undefined;
    }
    case TipoCampo.SELECAO_MULTIPLA: {
      const opcoes = normalizarOpcoes(campo.opcoes);
      const selecionados = Array.isArray(valor) ? (valor as string[]) : [];
      const todasValidas = selecionados.every((v) => opcoes.includes(v));
      return todasValidas ? undefined : mensagens.opcaoInvalida;
    }
    case TipoCampo.UPLOAD:
      // Presença já coberta pela checagem de obrigatoriedade; binário é do caller.
      return undefined;
    default:
      return undefined;
  }
}

/** Aplica a `validacao` (regex) do campo, se houver, a um valor textual. */
function validarRegex(campo: CampoFormulario, valor: string): string | undefined {
  if (!campo.validacao) return undefined;
  const re = compilarRegex(campo.validacao);
  if (!re) return undefined; // regex mal formada: ignora (config do admin)
  return re.test(valor) ? undefined : mensagens.formato;
}

/**
 * Constrói um schema Zod dinâmico a partir dos campos. Cada entrada do objeto é
 * chaveada pelo `campo.id` e delega a lógica de validação a `validarCampo`, o
 * que garante paridade total com a validação por campo (on blur).
 *
 * O wizard (13.2) usa `schema.safeParse(values).success` para liberar o avanço.
 */
export function construirSchema(campos: CampoFormulario[]): z.ZodType<FormValues> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const campo of campos) {
    shape[campo.id] = z
      .custom<FormFieldValue>()
      .superRefine((valor, ctx) => {
        const erro = validarCampo(campo, valor as FormFieldValue);
        if (erro) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: erro });
        }
      });
  }

  return z.object(shape) as unknown as z.ZodType<FormValues>;
}

/**
 * Valida todos os campos de uma vez, retornando o mapa `campoId -> erro` apenas
 * com as entradas inválidas. Útil ao tentar avançar (mostra todos os pendentes).
 */
export function validarTodos(
  campos: CampoFormulario[],
  values: FormValues,
): Record<string, string> {
  const erros: Record<string, string> = {};
  for (const campo of campos) {
    const erro = validarCampo(campo, values[campo.id]);
    if (erro) erros[campo.id] = erro;
  }
  return erros;
}

/** True quando todos os campos estão válidos para os valores atuais. */
export function formularioValido(campos: CampoFormulario[], values: FormValues): boolean {
  return Object.keys(validarTodos(campos, values)).length === 0;
}

/**
 * Constrói o estado inicial do formulário aplicando `valorPadrao` de cada campo
 * (Req. 16.2). Seleção múltipla e upload iniciam como coleções vazias.
 */
export function valoresIniciais(campos: CampoFormulario[]): FormValues {
  const values: FormValues = {};
  for (const campo of campos) {
    if (campo.tipo === TipoCampo.SELECAO_MULTIPLA) {
      values[campo.id] = [];
    } else if (campo.tipo === TipoCampo.UPLOAD) {
      values[campo.id] = [] as File[];
    } else {
      values[campo.id] = valorPadraoComoString(campo.valorPadrao);
    }
  }
  return values;
}

/**
 * Transforma os valores do formulário no array `respostas` esperado pelo
 * endpoint de criação de processo (`[{ campoId, valor }]`).
 *
 * - Campos de `upload` são omitidos (o binário é enviado pelo caller/wizard).
 * - `selecao_multipla` é serializada como JSON de string[].
 * - Demais valores são convertidos para string.
 * - Campos vazios e opcionais são omitidos do payload.
 */
export function toRespostas(
  campos: CampoFormulario[],
  values: FormValues,
): RespostaFormularioInput[] {
  const respostas: RespostaFormularioInput[] = [];

  for (const campo of campos) {
    if (campo.tipo === TipoCampo.UPLOAD) continue;

    const valor = values[campo.id];
    if (isVazio(valor)) continue;

    if (campo.tipo === TipoCampo.SELECAO_MULTIPLA) {
      const selecionados = Array.isArray(valor) ? (valor as string[]) : [];
      respostas.push({ campoId: campo.id, valor: JSON.stringify(selecionados) });
      continue;
    }

    respostas.push({ campoId: campo.id, valor: String(valor) });
  }

  return respostas;
}
