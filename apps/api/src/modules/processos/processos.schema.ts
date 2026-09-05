import { z } from 'zod';

/**
 * Schemas de validação (Zod) para a criação e listagem de Processos pelo
 * Cidadão (Req. 4, 3).
 *
 * `criarProcessoSchema` cobre o payload da etapa 6 do wizard (revisão e
 * confirmação): identifica o Tipo_de_Processo e a Unidade escolhidos, as
 * respostas do Formulário_Dinâmico (uma por campo respondido) e,
 * opcionalmente, os ids dos Documentos já enviados via presigned URL (tarefa
 * 7.2) a serem vinculados ao Processo.
 *
 * `filtroProcessoCidadaoSchema` cobre os filtros aceitos por
 * `GET /api/v1/processos` (status, categoria e período de abertura).
 */

/** Uma resposta do Cidadão a um campo do Formulário_Dinâmico. */
export const respostaFormularioSchema = z.object({
  campoId: z.string().trim().min(1, 'campoId é obrigatório'),
  // O tipo do valor depende do TipoCampo (texto, número, data, seleção...);
  // a compatibilidade é responsabilidade do Formulário_Dinâmico, não deste
  // schema de transporte — aqui apenas garantimos que a chave existe.
  valor: z.unknown(),
});

export type RespostaFormularioInput = z.infer<typeof respostaFormularioSchema>;

/** Criação de Processo pelo Cidadão — etapa 6 do wizard (Req. 4.1, 4.8). */
export const criarProcessoSchema = z.object({
  tipoProcessoId: z.string().trim().min(1, 'Tipo de processo é obrigatório'),
  unidadeId: z.string().trim().min(1, 'Unidade é obrigatória'),
  respostas: z.array(respostaFormularioSchema),
  documentoIds: z.array(z.string().trim().min(1)).optional(),
});

export type CriarProcessoInput = z.infer<typeof criarProcessoSchema>;

/**
 * Abertura de Processo pelo Servidor no Painel_Administrativo (Req. 23).
 *
 * Estende o payload da criação pelo Cidadão com o `cidadaoId` do Cidadão
 * previamente localizado por CPF (Req. 23.2). As demais regras (Tipo, Unidade,
 * respostas e documentos) são idênticas às do Portal_do_Cidadão (Req. 23.4).
 */
export const abrirProcessoAdminSchema = criarProcessoSchema.extend({
  cidadaoId: z.string().trim().min(1, 'Cidadão é obrigatório'),
});

export type AbrirProcessoAdminInput = z.infer<typeof abrirProcessoAdminSchema>;

/** Filtros da listagem de Processos do Cidadão autenticado (Req. 3.7, 3.8). */
export const filtroProcessoCidadaoSchema = z.object({
  status: z.string().trim().min(1).optional(),
  categoriaId: z.string().trim().min(1).optional(),
  periodoInicio: z.string().trim().min(1).optional(),
  periodoFim: z.string().trim().min(1).optional(),
});

export type FiltroProcessoCidadaoInput = z.infer<typeof filtroProcessoCidadaoSchema>;
