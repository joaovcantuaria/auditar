import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Cliente de dados da tela de Detalhe do Processo no Painel Administrativo
 * (Task 15.2, Req 11 + Req 13).
 *
 * Concentra as chamadas HTTP às rotas do Servidor sob o prefixo `/api/v1`
 * (já aplicado pelo `baseURL` do axiosInstance — por isso os paths começam em
 * `/admin/processos`). Os nomes de campo espelham EXATAMENTE as respostas do
 * backend, lidas de:
 *
 *  - `processos.tramitacao.service.ts` / `.controller.ts` / `.router.ts` (7.6)
 *  - `mensagens.publico.*` (8.1) e `mensagens.interno.*` (8.2)
 *  - `documentos.service.ts` / `.controller.ts` (7.2)
 *
 * Endpoints consumidos:
 *  - `GET  /admin/processos/:id`                      → { data: ProcessoTramitacaoDetalhe }   (Req 11.1)
 *  - `POST /admin/processos/:id/avancar-etapa`        body { observacao? }                     (Req 11.2, 11.3, 11.9)
 *  - `POST /admin/processos/:id/rejeitar`             body { motivo }                          (Req 11.7)
 *  - `POST /admin/processos/:id/solicitar-documentos` body { documentos: string[] }            (Req 11.6)
 *  - `POST /admin/processos/:id/observacoes`          body { tipo, conteudo }                  (Req 11.4, 11.5)
 *  - `GET  /admin/processos/:id/mensagens`            → { data: MensagemPublica[] }            (Req 13.1)
 *  - `POST /admin/processos/:id/mensagens`            body { conteudo } → { data, notificacaoEntregue } (Req 13.1, 13.3, 13.7)
 *  - `GET  /admin/processos/:id/mensagens/internas`   → { data: MensagemInternaResumo[] }      (Req 13.2)
 *  - `POST /admin/processos/:id/mensagens/internas`   body { conteudo, destinatarioServidorId?, anexo? } (Req 13.2, 13.5, 13.6)
 *  - `GET  /admin/processos/:id/documentos`           → { data: DocumentoResumo[] }            (Req 5.4)
 *  - `GET  /admin/processos/:id/documentos/:docId/download` → DownloadUrlResult                (Req 5.4)
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9, 13.1, 13.2, 13.5, 13.8_
 */

// ---------------------------------------------------------------------------
// Tipos de resposta. Datas trafegam como string ISO no JSON.
// ---------------------------------------------------------------------------

/** Resumo da etapa atual do Processo (`EtapaAtualResumo` do backend, Req 11.1). */
export interface EtapaAtualResumo {
  id: string;
  nome: string;
  prazosDiasUteis: number;
}

/** Resumo de uma etapa anterior já concluída (`EtapaAnteriorResumo`, Req 11.1). */
export interface EtapaAnteriorResumo {
  id: string;
  nome: string;
  concluidaEm: string | null;
}

/** Resumo da próxima etapa prevista no Fluxo (`ProximaEtapaResumo`, Req 11.1). */
export interface ProximaEtapaResumo {
  id: string;
  nome: string;
}

/**
 * Item do histórico de movimentações exibido ao Servidor
 * (`MovimentacaoResumo` do backend). O Servidor vê observações tanto
 * públicas quanto internas (`tipoObservacao`).
 */
export interface MovimentacaoResumo {
  etapaOrigemId: string | null;
  etapaDestinoId: string | null;
  observacao: string | null;
  /** 'interna' | 'publica' | null (movimentações sem observação). */
  tipoObservacao: string | null;
  realizadoEm: string;
  servidor: { nome: string } | null;
}

/** Uma resposta do Formulário_Dinâmico associada ao Processo (Req 24.1). */
export interface RespostaFormularioResumo {
  campoId: string;
  valor: string;
}

/**
 * Ações pendentes para o avanço do Processo (Req 24.3): próxima etapa prevista
 * e documentos solicitados ainda não anexados. Espelha `AcoesPendentesResumo`
 * do backend (`processos.tramitacao.service.ts`).
 */
export interface AcoesPendentesResumo {
  proximaEtapa: ProximaEtapaResumo | null;
  documentosSolicitadosPendentes: string[];
}

/** Detalhe administrativo completo do Processo (`ProcessoTramitacaoDetalhe`, Req 11.1). */
export interface ProcessoTramitacaoDetalhe {
  protocolo: string;
  status: string;
  prioridade: number;
  cidadao: { nome: string; cpf: string } | null;
  categoria: string | null;
  tipoProcesso: string;
  unidade: string;
  servidorResponsavel: string | null;
  abertoEm: string;
  prazoFinal: string;
  etapaAtual: EtapaAtualResumo | null;
  etapasAnteriores: EtapaAnteriorResumo[];
  proximaEtapa: ProximaEtapaResumo | null;
  movimentacoes: MovimentacaoResumo[];
  /**
   * Respostas do Formulário_Dinâmico do Processo (Req 24.1). Campo aditivo do
   * detalhe estendido (Task 21.1) — base para a edição corretiva (Task 28.2).
   */
  respostas: RespostaFormularioResumo[];
  /**
   * Ações pendentes para o avanço do Processo (Req 24.3): próxima etapa +
   * documentos solicitados ainda não anexados (Task 21.1 / 28.1).
   */
  acoesPendentes: AcoesPendentesResumo;
}

/**
 * Item unificado da trilha de auditoria do Processo (`TrilhaAuditoriaItem` do
 * backend, Req 24.2). Combina `MovimentacaoProcesso` e `AuditoriaLog` num
 * formato único, ordenado cronologicamente (crescente). Datas em ISO string.
 */
export interface TrilhaAuditoriaItem {
  /** Origem do item: movimentação de tramitação ou registro de auditoria. */
  origem: 'movimentacao' | 'auditoria';
  /** Identidade do autor da ação (nome do Servidor, categoria do ator, etc.). */
  autor: string | null;
  /** Descrição da ação realizada. */
  acao: string;
  /** Valor imediatamente anterior à ação, quando aplicável. */
  valorAnterior?: string | null;
  /** Valor posterior à ação, quando aplicável. */
  valorPosterior?: string | null;
  /** Data e hora da ação (ISO string). */
  data: string;
}

/** Resumo do Processo retornado após uma ação de tramitação (`ProcessoTramitacaoResumo`). */
export interface ProcessoTramitacaoResumo {
  protocolo: string;
  status: string;
  etapaAtualId: string | null;
}

/** Mensagem do canal público (Cidadão ↔ Servidor), em ordem crescente (Req 13.1). */
export interface MensagemPublica {
  id: string;
  remetente: string;
  conteudo: string;
  enviadaEm: string;
}

/** Mensagem do canal interno (Servidor ↔ Servidor) (`MensagemInternaResumo`, Req 13.2). */
export interface MensagemInternaResumo {
  id: string;
  conteudo: string;
  remetenteServidor: { nome: string } | null;
  destinatarioServidorId: string | null;
  caminhoAnexo: string | null;
  enviadaEm: string;
}

/** Documento anexado ao Processo (`DocumentoResumo` do backend, Req 5.4). */
export interface DocumentoResumo {
  id: string;
  nomeOriginal: string;
  tamanhoBytes: number;
  enviadoEm: string;
  enviadoPorCidadao: boolean;
}

/** Resultado da geração da presigned URL de download (`DownloadUrlResult`, Req 5.4). */
export interface DownloadUrlResult {
  downloadUrl: string;
  nomeOriginal: string;
  expiraEm: string;
}

/** Resultado do envio de mensagem pelo Servidor (inclui `notificacaoEntregue`, Req 13.7). */
export interface EnviarMensagemServidorResultado {
  mensagem: MensagemPublica;
  notificacaoEntregue: boolean;
}

/** Metadados de anexo já enviado ao MinIO, aceitos pelo canal interno (Req 13.5). */
export interface AnexoInterno {
  nomeOriginal: string;
  mimeType: string;
  tamanhoBytes: number;
  caminhoStorage: string;
}

// ---------------------------------------------------------------------------
// Helpers de envelope
// ---------------------------------------------------------------------------

/** Envelope `{ data }` usado pela maioria das respostas de leitura. */
interface DataEnvelope<T> {
  data: T;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** GET detalhe administrativo completo do Processo (Req 11.1). */
export async function fetchProcessoAdmin(id: string): Promise<ProcessoTramitacaoDetalhe> {
  const { data } = await axiosInstance.get<DataEnvelope<ProcessoTramitacaoDetalhe>>(
    `/admin/processos/${id}`,
  );
  return data.data;
}

/** GET trilha de auditoria unificada do Processo (Req 24.2). */
export async function fetchTrilhaAuditoria(id: string): Promise<TrilhaAuditoriaItem[]> {
  const { data } = await axiosInstance.get<DataEnvelope<TrilhaAuditoriaItem[]>>(
    `/admin/processos/${id}/auditoria`,
  );
  return data.data;
}

/** GET mensagens do canal público (Req 13.1). */
export async function fetchMensagensPublicas(id: string): Promise<MensagemPublica[]> {
  const { data } = await axiosInstance.get<DataEnvelope<MensagemPublica[]>>(
    `/admin/processos/${id}/mensagens`,
  );
  return data.data;
}

/** GET mensagens do canal interno (Req 13.2). */
export async function fetchMensagensInternas(id: string): Promise<MensagemInternaResumo[]> {
  const { data } = await axiosInstance.get<DataEnvelope<MensagemInternaResumo[]>>(
    `/admin/processos/${id}/mensagens/internas`,
  );
  return data.data;
}

/** GET documentos anexados ao Processo (Req 5.4). */
export async function fetchDocumentos(id: string): Promise<DocumentoResumo[]> {
  const { data } = await axiosInstance.get<DataEnvelope<DocumentoResumo[]>>(
    `/admin/processos/${id}/documentos`,
  );
  return data.data;
}

/** GET presigned URL de download de um documento (Req 5.4). */
export async function fetchDownloadUrl(id: string, docId: string): Promise<DownloadUrlResult> {
  const { data } = await axiosInstance.get<DownloadUrlResult>(
    `/admin/processos/${id}/documentos/${docId}/download`,
  );
  return data;
}

// ---------------------------------------------------------------------------
// Ações de tramitação (Req 11)
// ---------------------------------------------------------------------------

/** POST avança/finaliza o Processo, com observação opcional (Req 11.2, 11.3, 11.9). */
export async function avancarEtapa(
  id: string,
  observacao?: string,
): Promise<ProcessoTramitacaoResumo> {
  const { data } = await axiosInstance.post<DataEnvelope<ProcessoTramitacaoResumo>>(
    `/admin/processos/${id}/avancar-etapa`,
    { observacao },
  );
  return data.data;
}

/** POST rejeita o Processo com o motivo informado (Req 11.7). */
export async function rejeitarProcesso(
  id: string,
  motivo: string,
): Promise<ProcessoTramitacaoResumo> {
  const { data } = await axiosInstance.post<DataEnvelope<ProcessoTramitacaoResumo>>(
    `/admin/processos/${id}/rejeitar`,
    { motivo },
  );
  return data.data;
}

/** POST solicita documentos adicionais ao Cidadão (Req 11.6). */
export async function solicitarDocumentos(
  id: string,
  documentos: string[],
): Promise<ProcessoTramitacaoResumo> {
  const { data } = await axiosInstance.post<DataEnvelope<ProcessoTramitacaoResumo>>(
    `/admin/processos/${id}/solicitar-documentos`,
    { documentos },
  );
  return data.data;
}

/** Corpo aceito por `POST /admin/processos/:id/observacoes` (Req 11.4, 11.5). */
export interface RegistrarObservacaoInput {
  tipo: 'interna' | 'publica';
  conteudo: string;
}

/** Movimentação criada ao registrar uma observação (`ObservacaoCriada` do backend). */
export interface ObservacaoCriada {
  id: string;
  processoId: string;
  observacao: string | null;
  tipoObservacao: string | null;
  realizadoEm: string;
}

/** POST registra observação interna ou pública (Req 11.4, 11.5). */
export async function registrarObservacao(
  id: string,
  input: RegistrarObservacaoInput,
): Promise<ObservacaoCriada> {
  const { data } = await axiosInstance.post<DataEnvelope<ObservacaoCriada>>(
    `/admin/processos/${id}/observacoes`,
    input,
  );
  return data.data;
}

// ---------------------------------------------------------------------------
// Mensagens (Req 13)
// ---------------------------------------------------------------------------

/** POST envia mensagem do Servidor ao Cidadão no canal público (Req 13.1, 13.3, 13.7). */
export async function enviarMensagemPublica(
  id: string,
  conteudo: string,
): Promise<EnviarMensagemServidorResultado> {
  const { data } = await axiosInstance.post<
    DataEnvelope<MensagemPublica> & { notificacaoEntregue: boolean }
  >(`/admin/processos/${id}/mensagens`, { conteudo });
  return { mensagem: data.data, notificacaoEntregue: data.notificacaoEntregue };
}

/** Corpo aceito pelo envio de mensagem interna (Req 13.2, 13.5, 13.6). */
export interface EnviarMensagemInternaInput {
  conteudo: string;
  destinatarioServidorId?: string;
  anexo?: AnexoInterno;
}

/** POST envia mensagem no canal interno (Servidor ↔ Servidor) (Req 13.2, 13.5, 13.6). */
export async function enviarMensagemInterna(
  id: string,
  input: EnviarMensagemInternaInput,
): Promise<MensagemInternaResumo> {
  const { data } = await axiosInstance.post<DataEnvelope<MensagemInternaResumo>>(
    `/admin/processos/${id}/mensagens/internas`,
    input,
  );
  return data.data;
}

// ---------------------------------------------------------------------------
// Anexo do canal interno — reuso do fluxo de presigned URL de Documentos (Req 13.5)
// ---------------------------------------------------------------------------

/** Resultado da geração da presigned URL de upload (`UploadUrlResult` do backend). */
export interface UploadUrlResult {
  uploadUrl: string;
  caminhoStorage: string;
  expiraEm: string;
}

/**
 * POST solicita uma presigned URL de upload ao MinIO, reutilizando o endpoint
 * de Documentos (Req 13.5). O binário é enviado direto ao MinIO com a URL
 * retornada; NÃO se deve chamar a confirmação de Documento para anexos de
 * mensagem — ver `mensagens.interno.service.ts`.
 */
export async function requestUploadUrl(
  id: string,
  arquivo: { nomeOriginal: string; mimeType: string; tamanhoBytes: number },
): Promise<UploadUrlResult> {
  const { data } = await axiosInstance.post<UploadUrlResult>(
    `/admin/processos/${id}/documentos/upload-url`,
    arquivo,
  );
  return data;
}

// ---------------------------------------------------------------------------
// Edição corretiva do Processo (Task 28.2, Req 24.4, 24.5, 24.7)
// ---------------------------------------------------------------------------

/** Uma correção de resposta do Formulário_Dinâmico por `campoId` (Req 24.4). */
export interface CorrecaoResposta {
  campoId: string;
  valor: string;
}

/**
 * Corpo aceito por `PATCH /admin/processos/:id` — Edição_Corretiva (Req 24.4).
 * Espelha o `edicaoCorretivaSchema` do backend: `prioridade` (0–10) e/ou
 * correções de `respostas` por `campoId`. Ao menos um dos dois deve ser
 * informado (o backend rejeita corpo vazio).
 */
export interface EdicaoCorretivaInput {
  prioridade?: number;
  respostas?: CorrecaoResposta[];
}

/** Resultado da edição corretiva (`EdicaoCorretivaResultado` do backend). */
export interface EdicaoCorretivaResultado {
  protocolo: string;
  prioridade: number;
  camposAlterados: string[];
}

/**
 * PATCH aplica a Edição_Corretiva (prioridade e/ou respostas) e registra a
 * auditoria por campo (Req 24.5). Requer a permissão `editar` (aplicada por
 * middleware no backend); sem ela o backend responde 403. Falha na auditoria
 * ⇒ 500 `SYS_001` sem persistir (Req 24.7). O erro propaga para o consumidor.
 */
export async function editarProcessoCorretivo(
  id: string,
  input: EdicaoCorretivaInput,
): Promise<EdicaoCorretivaResultado> {
  const { data } = await axiosInstance.patch<DataEnvelope<EdicaoCorretivaResultado>>(
    `/admin/processos/${id}`,
    input,
  );
  return data.data;
}

// ---------------------------------------------------------------------------
// Anexação de documentos no painel (Task 28.2, Req 24.6, 25) — reuso do fluxo
// presigned do Cidadão: upload-url → PUT MinIO → confirmação.
// ---------------------------------------------------------------------------

/** Metadados de um arquivo a anexar ao Processo. */
export interface ArquivoMetadados {
  nomeOriginal: string;
  mimeType: string;
  tamanhoBytes: number;
}

/**
 * Confirma um upload já realizado no MinIO, persistindo o Documento vinculado
 * ao Processo (`POST /admin/processos/:id/documentos`). O `caminhoStorage` vem
 * da presigned URL obtida em `requestUploadUrl`.
 */
export async function confirmarDocumento(
  id: string,
  metadados: ArquivoMetadados & { caminhoStorage: string },
): Promise<DocumentoResumo> {
  const { data } = await axiosInstance.post<DataEnvelope<DocumentoResumo>>(
    `/admin/processos/${id}/documentos`,
    metadados,
  );
  return data.data;
}

/**
 * Anexa UM arquivo ao Processo pelo painel, na sequência
 * upload-url → PUT direto ao MinIO → confirmação (mesmo fluxo do Cidadão,
 * Req 24.6). O binário é enviado FORA do axiosInstance (sem Bearer nem baseURL
 * `/api/v1`), com o Content-Type do próprio arquivo.
 *
 * @throws propaga o erro (incl. validação de formato/tamanho do backend,
 *   Req 25.2) para o chamador reportar por arquivo.
 */
export async function anexarDocumento(id: string, file: File): Promise<DocumentoResumo> {
  const metadados: ArquivoMetadados = {
    nomeOriginal: file.name,
    mimeType: file.type,
    tamanhoBytes: file.size,
  };

  // 1. Presigned URL de upload (o backend valida formato/tamanho/limites aqui).
  const url = await requestUploadUrl(id, metadados);

  // 2. Envia o binário DIRETO ao MinIO.
  const resposta = await fetch(url.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  if (!resposta.ok) {
    throw new Error(`Falha no envio do arquivo "${file.name}" ao armazenamento.`);
  }

  // 3. Confirma o upload, persistindo o Documento.
  return confirmarDocumento(id, { ...metadados, caminhoStorage: url.caminhoStorage });
}

// ---------------------------------------------------------------------------
// PDF consolidado do Processo (Task 28.2, Req 26.1, 26.2, 26.6)
// ---------------------------------------------------------------------------

/**
 * GET `/admin/processos/:id/pdf` (Req 26.1) com `responseType: 'blob'` e dispara
 * o download no navegador criando um object URL temporário e um clique
 * programático em um `<a download>`. Requer a permissão `visualizar` (aplicada
 * por middleware no backend, Req 26.6). O erro (`PDF_001`, Req 26.5) propaga
 * para o consumidor exibir e permitir nova tentativa.
 */
export async function baixarPdfProcesso(id: string, protocolo: string): Promise<void> {
  const resposta = await axiosInstance.get<Blob>(`/admin/processos/${id}/pdf`, {
    responseType: 'blob',
  });

  const blob = new Blob([resposta.data], { type: 'application/pdf' });
  const objectUrl = window.URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `processo-${protocolo}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Libera o object URL após o clique (evita vazamento de memória).
    window.URL.revokeObjectURL(objectUrl);
  }
}
