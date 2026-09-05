/// <reference types="vite/client" />

/**
 * Tipagem das variáveis de ambiente expostas ao cliente pelo Vite.
 * Apenas variáveis prefixadas com `VITE_` são embutidas no bundle.
 */
interface ImportMetaEnv {
  /** URL base da API. Se ausente, usa o prefixo relativo `/api/v1`. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
