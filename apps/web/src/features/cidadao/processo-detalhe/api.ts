import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Cliente de dados da tela de Detalhe do Processo (Portal do Cidadão, Task 13.3).
 *
 * Concentra as chamadas HTTP às rotas do Cidadão sob o prefixo `/api/v1`
 * (já aplicado pelo `baseURL` do axiosInstance — por isso os paths abaixo
 * começam em `/processos`). Os nomes de campo espelham exatamente as respostas
 * do backend:
 *
 *  - `GET /processos/:id`                       → { data: ProcessoDetalhe }
 *  - `GET /processos/:id/historico`             → { data: HistoricoItem[] }
 *  - `GET /processos/:id/documentos`            → { data: DocumentoResumo[] }
 *  - `GET /processos/:id/documentos/:docId/download` → DownloadUrlResult
 *  - `POST /processos/:id/documentos/upload-url`     → UploadUrlResult
 *  - `POST /processos/:id/documentos`                → Documento (201)
 *  - `GET /processos/:id/mensagens`             → { data: MensagemPublica[] }
 *  - `POST /processos/:id/mensagens`            → { data: MensagemPublica } (201)
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 5.10_
 */

// ---------------------------------------------------------------------------
// Tipos de resposta (espelham `processos.detalhe.service.ts` / `documentos.service.ts`
// / `mensagens.publico.*`). Datas trafegam como string ISO no JSON.
// ---------------------------------------------------------------------------

/** Resposta de um campo do formulário submetido (Req 5.2). */
export interface RespostaResumo {
  campoId: string;
  valor: string;
}

/** Detalhe do Processo para a aba Informações (Req 5.1, 5.2). */
export interface ProcessoDetalhe {
  protocolo: string;
  categoria: string | null;
  tipoProcesso: string;
  unidade: string;
  abertoEm: string;
  prazoFinal: string;
  status: string;
  etapaAtual: string | null;
  respostas: RespostaResumo[];
}

/** Item da cronologia de movimentações (Req 5.3), em ordem crescente. */
export interface HistoricoItem {
  data: string;
  acao: string;
  responsavel: string;
  observacao: string | null;
}

/** Documento anexado ao Processo (Req 5.4). */
export interface DocumentoResumo {
  id: string;
  nomeOriginal: string;
  tamanhoBytes: number;
  enviadoEm: string;
  enviadoPorCidadao: boolean;
}

/** Mensagem do canal público (Req 5.5), em ordem crescente. */
export interface MensagemPublica {
  id: string;
  remetente: string;
  conteudo: string;
  enviadaEm: string;
}

/** Resultado da geração da presigned URL de download (Req 5.4). */
export interface DownloadUrlResult {
  downloadUrl: string;
  nomeOriginal: string;
  expiraEm: string;
}

/** Resultado da geração da presigned URL de upload (Req 4.5, 4.7). */
export interface UploadUrlResult {
  uploadUrl: string;
  caminhoStorage: string;
  expiraEm: string;
}

// ---------------------------------------------------------------------------
// Chamadas HTTP
// ---------------------------------------------------------------------------

/** Envelope `{ data }` usado pela maioria das respostas de leitura. */
interface DataEnvelope<T> {
  data: T;
}

export async function fetchProcessoDetalhe(id: string): Promise<ProcessoDetalhe> {
  const { data } = await axiosInstance.get<DataEnvelope<ProcessoDetalhe>>(`/processos/${id}`);
  return data.data;
}

export async function fetchProcessoHistorico(id: string): Promise<HistoricoItem[]> {
  const { data } = await axiosInstance.get<DataEnvelope<HistoricoItem[]>>(
    `/processos/${id}/historico`,
  );
  return data.data;
}

export async function fetchProcessoDocumentos(id: string): Promise<DocumentoResumo[]> {
  const { data } = await axiosInstance.get<DataEnvelope<DocumentoResumo[]>>(
    `/processos/${id}/documentos`,
  );
  return data.data;
}

export async function fetchProcessoMensagens(id: string): Promise<MensagemPublica[]> {
  const { data } = await axiosInstance.get<DataEnvelope<MensagemPublica[]>>(
    `/processos/${id}/mensagens`,
  );
  return data.data;
}

export async function fetchDownloadUrl(id: string, docId: string): Promise<DownloadUrlResult> {
  const { data } = await axiosInstance.get<DownloadUrlResult>(
    `/processos/${id}/documentos/${docId}/download`,
  );
  return data;
}

export async function requestUploadUrl(
  id: string,
  arquivo: { nomeOriginal: string; mimeType: string; tamanhoBytes: number },
): Promise<UploadUrlResult> {
  const { data } = await axiosInstance.post<UploadUrlResult>(
    `/processos/${id}/documentos/upload-url`,
    arquivo,
  );
  return data;
}

export async function confirmarDocumento(
  id: string,
  dto: {
    nomeOriginal: string;
    mimeType: string;
    tamanhoBytes: number;
    caminhoStorage: string;
  },
): Promise<DocumentoResumo> {
  const { data } = await axiosInstance.post<DocumentoResumo>(`/processos/${id}/documentos`, dto);
  return data;
}

export async function enviarMensagem(id: string, conteudo: string): Promise<MensagemPublica> {
  const { data } = await axiosInstance.post<DataEnvelope<MensagemPublica>>(
    `/processos/${id}/mensagens`,
    { conteudo },
  );
  return data.data;
}
