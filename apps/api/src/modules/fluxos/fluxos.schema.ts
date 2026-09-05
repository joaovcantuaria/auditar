import { z } from 'zod';

/**
 * Schemas de validação (Zod) para Fluxos e Etapas.
 *
 * Regras espelham o Requisito 15:
 *  - 15.1: um Fluxo tem no mínimo 1 e no máximo 50 Etapas.
 *  - 15.2: cada Etapa tem nome (<=100), prazo entre 1 e 365 dias úteis, Servidor
 *    responsável padrão (opcional), documentos obrigatórios (até 20), observações
 *    obrigatórias (até 1.000 caracteres) e automações.
 *  - 15.3: cada Etapa pode ter no máximo 10 automações.
 */

const NOME_MAX = 100;
const PRAZO_MIN = 1;
const PRAZO_MAX = 365;
const ETAPAS_MIN = 1;
const ETAPAS_MAX = 50;
const DOCS_MAX = 20;
const OBS_MAX = 1000;
const AUTOMACOES_MAX = 10;

const nomeFluxoSchema = z
  .string()
  .trim()
  .min(1, 'O nome do fluxo é obrigatório')
  .max(NOME_MAX, `O nome deve ter no máximo ${NOME_MAX} caracteres`);

const nomeEtapaSchema = z
  .string()
  .trim()
  .min(1, 'O nome da etapa é obrigatório')
  .max(NOME_MAX, `O nome da etapa deve ter no máximo ${NOME_MAX} caracteres`);

const prazoEtapaSchema = z
  .number({ invalid_type_error: 'O prazo da etapa deve ser um número inteiro' })
  .int('O prazo da etapa deve ser um número inteiro')
  .min(PRAZO_MIN, `O prazo da etapa deve ser no mínimo ${PRAZO_MIN} dia útil`)
  .max(PRAZO_MAX, `O prazo da etapa deve ser no máximo ${PRAZO_MAX} dias úteis`);

/** Automação por Etapa (Req. 15.3). */
export const automacaoSchema = z.object({
  tipo: z.enum(['email_cidadao', 'alerta_servidor', 'alterar_status'], {
    errorMap: () => ({ message: 'Tipo de automação inválido' }),
  }),
  payload: z.string(),
});

/** Etapa individual do Fluxo (Req. 15.2 / 15.3). */
export const etapaSchema = z.object({
  nome: nomeEtapaSchema,
  prazosDiasUteis: prazoEtapaSchema,
  servidorPadraoId: z.string().uuid('Servidor responsável inválido').optional(),
  documentosObrigatorios: z
    .array(z.string())
    .max(DOCS_MAX, `Uma etapa pode ter no máximo ${DOCS_MAX} documentos obrigatórios`)
    .optional(),
  observacoesObrigatorias: z
    .string()
    .max(OBS_MAX, `As observações obrigatórias devem ter no máximo ${OBS_MAX} caracteres`)
    .optional(),
  automacoes: z
    .array(automacaoSchema)
    .max(AUTOMACOES_MAX, `Uma etapa pode ter no máximo ${AUTOMACOES_MAX} automações`)
    .optional(),
});

const etapasSchema = z
  .array(etapaSchema)
  .min(ETAPAS_MIN, 'Um fluxo deve ter ao menos uma etapa')
  .max(ETAPAS_MAX, `Um fluxo pode ter no máximo ${ETAPAS_MAX} etapas`);

/** Payload de criação de um Fluxo (Req. 15.1 / 15.2). */
export const criarFluxoSchema = z.object({
  nome: nomeFluxoSchema,
  etapas: etapasSchema,
});

/** Payload de edição de um Fluxo — mesmo formato da criação (Req. 15.4). */
export const editarFluxoSchema = z.object({
  nome: nomeFluxoSchema,
  etapas: etapasSchema,
});

export type AutomacaoDto = z.infer<typeof automacaoSchema>;
export type EtapaDto = z.infer<typeof etapaSchema>;
export type CriarFluxoDto = z.infer<typeof criarFluxoSchema>;
export type EditarFluxoDto = z.infer<typeof editarFluxoSchema>;
