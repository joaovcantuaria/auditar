/**
 * MODO DEMONSTRAÇÃO — liga o site sem depender da API.
 *
 * Ativado só quando o build tem `VITE_DEMO_MODE=true` (ver `main.tsx`, que
 * importa este módulo dinamicamente para ele nem entrar no bundle normal).
 * Troca o "adapter" do axios por um simulador que responde com os dados de
 * `db.ts`, e simula o upload direto ao storage.
 */
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { axiosInstance } from '@/lib/axiosInstance';
import { DEMO_UPLOAD_PREFIX, DemoHttpError, despachar, type Sessao } from './handlers';
import { reiniciarDb } from './db';

/** Atraso artificial para a interface mostrar os estados de carregamento. */
const LATENCIA_MS = 250;

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function lerSessao(config: InternalAxiosRequestConfig): Sessao | null {
  const headers = AxiosHeaders.from(config.headers);
  const auth = String(headers.get('Authorization') ?? '');
  const m = /^Bearer demo\.(cidadao|servidor)\.(.+)$/.exec(auth);
  return m ? { role: m[1] as Sessao['role'], id: m[2]! } : null;
}

function lerCorpo(data: unknown): Record<string, unknown> {
  if (typeof data === 'string' && data) {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function lerQuery(params: unknown): Record<string, string> {
  const q: Record<string, string> = {};
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== '') q[k] = String(v);
    }
  }
  return q;
}

/** Normaliza a URL da requisição para o caminho da API (sem `/api/v1` e sem query). */
function caminho(config: InternalAxiosRequestConfig): { path: string; query: Record<string, string> } {
  const url = new URL(config.url ?? '/', 'http://demo.local/');
  const query = lerQuery(config.params);
  url.searchParams.forEach((v, k) => {
    query[k] ??= v;
  });
  const path = url.pathname.replace(/^.*\/api\/v1/, '') || '/';
  return { path, query };
}

const demoAdapter: AxiosAdapter = async (config) => {
  await esperar(LATENCIA_MS);
  const { path, query } = caminho(config);

  // Upload "direto ao storage" simulado.
  if (path.startsWith(DEMO_UPLOAD_PREFIX)) {
    return { data: '', status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse;
  }

  try {
    const { status, data } = despachar({
      method: (config.method ?? 'get').toUpperCase(),
      path,
      query,
      body: lerCorpo(config.data),
      sessao: lerSessao(config),
    });
    return { data, status, statusText: 'OK', headers: {}, config } as AxiosResponse;
  } catch (err) {
    const status = err instanceof DemoHttpError ? err.status : 500;
    const mensagem = err instanceof Error ? err.message : 'Erro na demonstração.';
    const extra = err instanceof DemoHttpError ? err.extra : {};
    if (!(err instanceof DemoHttpError)) console.error('[demo]', err);
    const response = {
      data: { error: mensagem, code: `DEMO_${status}`, ...extra },
      status,
      statusText: 'Erro',
      headers: {},
      config,
    } as AxiosResponse;
    throw new AxiosError(mensagem, AxiosError.ERR_BAD_REQUEST, config, null, response);
  }
};

export function instalarModoDemonstracao(): void {
  // `?resetDemo=1` na URL volta os dados ao estado inicial.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('resetDemo')) {
      reiniciarDb();
      url.searchParams.delete('resetDemo');
      window.history.replaceState(null, '', url.toString());
    }
  } catch {
    // ignora
  }

  axiosInstance.defaults.adapter = demoAdapter;

  // Upload com o axios global (fora do axiosInstance) para a URL simulada.
  const adapterPadrao = axios.getAdapter(axios.defaults.adapter);
  axios.defaults.adapter = (config) =>
    String(config.url ?? '').startsWith(DEMO_UPLOAD_PREFIX) ? demoAdapter(config) : adapterPadrao(config);

  // Upload com `fetch` (wizard e anexos do painel) para a URL simulada.
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(DEMO_UPLOAD_PREFIX) || url.includes(DEMO_UPLOAD_PREFIX)) {
      return esperar(LATENCIA_MS).then(() => new Response(null, { status: 200 }));
    }
    return fetchOriginal(input, init);
  };
}

export { reiniciarDb };
