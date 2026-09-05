import { isAxiosError } from 'axios';
import type { Categoria, TipoProcesso, Unidade } from '@auditar/shared';
import { axiosInstance } from '@/lib/axiosInstance';
import type { RespostaFormularioInput } from '@/features/formularios';

/**
 * Camada de acesso à API do wizard de criação de Processo (task 13.2).
 *
 * A baseURL do axios já inclui `/api/v1`, portanto os caminhos abaixo são
 * relativos.
 *
 * ---------------------------------------------------------------------------
 * IMPORTANTE — Catálogo (steps 1–3): LACUNA DE ENDPOINT PÚBLICO
 * ---------------------------------------------------------------------------
 * O wizard precisa que o Cidadão ESCOLHA, nesta ordem, uma Categoria ativa,
 * um Tipo de Processo (filtrado pela categoria) e uma Unidade atendente. No
 * backend atual, porém, as únicas rotas de catálogo existentes são
 * ADMINISTRATIVAS e exigem um Servidor autenticado (`authenticate +
 * requireServidor`):
 *
 *   - `GET /admin/config/categorias`      → `{ data: Categoria[] }`      (Permissao.VISUALIZAR)
 *   - `GET /admin/config/tipos-processo`  → `TipoProcesso[]` (array cru) (`?categoriaId=`)
 *   - `GET /admin/config/unidades`        → `{ data: Unidade[] }`
 *
 * A ÚNICA rota pública voltada ao Portal do Cidadão é
 * `GET /formularios?tipoId=&unidadeId=` (formularioPublicRouter), consumida no
 * step 4 via `useFormularioDinamico`. NÃO existe uma rota pública de catálogo
 * (categorias/tipos/unidades) equivalente — e o `MeusProcessosPage` (task 13.1)
 * já documenta a mesma ausência.
 *
 * DECISÃO (sem inventar rotas de backend): o wizard consome as rotas
 * administrativas acima para popular os steps 1–3. Isso funciona quando a
 * sessão tem privilégio de Servidor; numa sessão de Cidadão puro elas retornam
 * 401/403 e os steps exibem a indisponibilidade (Alert) sem quebrar o fluxo.
 *
 * TODO(backend): expor um catálogo PÚBLICO para o Portal do Cidadão, no mesmo
 * molde do `formularioPublicRouter`, retornando SOMENTE itens ativos, p.ex.:
 *   - `GET /categorias`               (ativas)
 *   - `GET /tipos-processo?categoriaId=` (ativos, da categoria)
 *   - `GET /unidades?tipoProcessoId=`    (ativas, atendentes do tipo)
 * Quando existir, trocar apenas os paths abaixo (o restante do wizard não muda).
 *
 * ---------------------------------------------------------------------------
 * IMPORTANTE — Ordem do upload de Documentos (steps 5–6)
 * ---------------------------------------------------------------------------
 * O Processo só existe APÓS a submissão do step 6 (`POST /processos`). O
 * endpoint que gera a presigned URL de upload
 * (`POST /processos/:id/documentos/upload-url`) exige um `:id` de Processo
 * EXISTENTE (valida os limites agregados do Processo e monta o caminho no
 * bucket com o `processoId`). Logo, NÃO é possível enviar arquivos antes de
 * criar o Processo.
 *
 * FLUXO ESCOLHIDO (opção "a" — criar primeiro, depois anexar):
 *   1. `POST /processos` com `{ tipoProcessoId, unidadeId, respostas }` → `{ protocolo, processoId }`.
 *   2. Para cada arquivo coletado no step 5, em sequência:
 *        a. `POST /processos/:id/documentos/upload-url` (metadados) → `{ uploadUrl, caminhoStorage }`;
 *        b. `PUT <uploadUrl>` direto ao MinIO com o binário do arquivo;
 *        c. `POST /processos/:id/documentos` (confirmação) → `Documento`.
 *   Os documentos já ficam vinculados ao Processo criado (não precisamos
 *   passar `documentoIds` na criação). O campo opcional `documentoIds` de
 *   `criarProcessoSchema` serve ao caso inverso (docs pré-enviados) e não se
 *   aplica aqui, já que o upload depende de um `processoId` existente.
 *
 * _Requirements: 4.1–4.13, 16.5, 16.6_
 */

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const wizardQueryKeys = {
  categorias: ['wizard', 'categorias'] as const,
  tipos: (categoriaId: string) => ['wizard', 'tipos', categoriaId] as const,
  unidades: (tipoProcessoId: string) => ['wizard', 'unidades', tipoProcessoId] as const,
};

// ---------------------------------------------------------------------------
// Tipos de resposta
// ---------------------------------------------------------------------------

/** Formato padrão de erro da API (`{ error, code, field? }`). */
export interface ApiError {
  error?: string;
  code?: string;
  field?: string;
}

/** Tipo de Processo com as Unidades atendentes já incluídas (relação). */
export interface TipoProcessoComUnidades extends TipoProcesso {
  unidades: Array<{ unidadeId: string }>;
}

/** Resultado da criação de Processo (`POST /processos`). */
export interface CriarProcessoResultado {
  protocolo: string;
  processoId: string;
}

/** Resposta de `POST /processos/:id/documentos/upload-url`. */
interface UploadUrlResult {
  uploadUrl: string;
  caminhoStorage: string;
  expiraEm: string;
}

// ---------------------------------------------------------------------------
// Helpers de erro
// ---------------------------------------------------------------------------

/** Extrai a mensagem amigável de erro de uma resposta da API. */
export function extrairMensagemErro(err: unknown, fallback: string): string {
  if (isAxiosError<ApiError>(err)) {
    return err.response?.data?.error ?? fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

// ---------------------------------------------------------------------------
// Catálogo (steps 1–3) — ver LACUNA documentada no topo do arquivo.
// ---------------------------------------------------------------------------

/** Lista as Categorias. O consumidor filtra as ATIVAS (Req. 4.1). */
export async function listarCategorias(): Promise<Categoria[]> {
  const { data } = await axiosInstance.get<{ data: Categoria[] }>('/admin/config/categorias');
  return data.data;
}

/** Lista os Tipos de Processo de uma Categoria. O consumidor filtra os ATIVOS (Req. 4.12). */
export async function listarTiposPorCategoria(
  categoriaId: string,
): Promise<TipoProcessoComUnidades[]> {
  const { data } = await axiosInstance.get<TipoProcessoComUnidades[]>(
    '/admin/config/tipos-processo',
    { params: { categoriaId } },
  );
  return data;
}

/** Lista as Unidades. O consumidor filtra as ATIVAS/atendentes (Req. 4.3, 4.13). */
export async function listarUnidades(): Promise<Unidade[]> {
  const { data } = await axiosInstance.get<{ data: Unidade[] }>('/admin/config/unidades');
  return data.data;
}

// ---------------------------------------------------------------------------
// Criação de Processo (step 6) — `POST /processos`
// ---------------------------------------------------------------------------

/** Payload de criação, com os campos EXATOS de `criarProcessoSchema`. */
export interface CriarProcessoPayload {
  tipoProcessoId: string;
  unidadeId: string;
  respostas: RespostaFormularioInput[];
  documentoIds?: string[];
}

/**
 * Cria o Processo (step 6). Retorna `{ protocolo, processoId }` (Req. 4.8).
 * Falhas propagam para que o wizard preserve os dados e permita nova tentativa
 * (Req. 4.11).
 */
export async function criarProcesso(
  payload: CriarProcessoPayload,
): Promise<CriarProcessoResultado> {
  const { data } = await axiosInstance.post<CriarProcessoResultado>('/processos', payload);
  return data;
}

// ---------------------------------------------------------------------------
// Upload de Documentos (após criação) — ver ORDEM documentada no topo.
// ---------------------------------------------------------------------------

/** Resultado do envio de um único arquivo. */
export interface UploadResultado {
  nome: string;
  sucesso: boolean;
  erro?: string;
}

/**
 * Envia UM arquivo já com o Processo criado, na sequência
 * upload-url → PUT MinIO → confirmação.
 *
 * @throws propaga o erro para o chamador decidir como reportá-lo por arquivo.
 */
export async function enviarDocumento(processoId: string, file: File): Promise<void> {
  const metadados = {
    nomeOriginal: file.name,
    mimeType: file.type,
    tamanhoBytes: file.size,
  };

  // 1. Solicita a presigned URL de upload (valida formato/tamanho no backend).
  const { data: url } = await axiosInstance.post<UploadUrlResult>(
    `/processos/${processoId}/documentos/upload-url`,
    metadados,
  );

  // 2. Envia o binário DIRETO ao MinIO (fora do axiosInstance: sem Bearer nem
  //    baseURL `/api/v1`, e com o Content-Type do próprio arquivo).
  const resposta = await fetch(url.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  if (!resposta.ok) {
    throw new Error(`Falha no envio do arquivo "${file.name}" ao armazenamento.`);
  }

  // 3. Confirma o upload, persistindo o Documento vinculado ao Processo.
  await axiosInstance.post(`/processos/${processoId}/documentos`, {
    ...metadados,
    caminhoStorage: url.caminhoStorage,
  });
}

/**
 * Envia todos os arquivos coletados no step 5, em sequência, tolerando falhas
 * individuais: retorna o resultado por arquivo para exibição ao Cidadão. A
 * criação do Processo NÃO é revertida por uma falha de anexo — o Protocolo já
 * foi gerado (Req. 4.8) e o Cidadão pode reenviar depois pela tela de detalhe.
 */
export async function enviarDocumentos(
  processoId: string,
  files: File[],
): Promise<UploadResultado[]> {
  const resultados: UploadResultado[] = [];
  for (const file of files) {
    try {
      await enviarDocumento(processoId, file);
      resultados.push({ nome: file.name, sucesso: true });
    } catch (err) {
      resultados.push({
        nome: file.name,
        sucesso: false,
        erro: extrairMensagemErro(err, 'Não foi possível anexar este arquivo.'),
      });
    }
  }
  return resultados;
}
