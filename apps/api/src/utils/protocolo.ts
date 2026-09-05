import type { Redis } from 'ioredis';
import { formatarProtocolo } from '@auditar/shared';

/** Objeto genérico que pode fornecer um prefixo de protocolo (Unidade/Categoria). */
export interface ComPrefixoProtocolo {
  prefixoProtocolo?: string | null;
}

/** Opções nomeadas para a geração de protocolo. */
export interface GerarProtocoloOpts {
  /** Sigla opcional (2-5 letras maiúsculas) derivada da Unidade ou Categoria. */
  prefixo?: string;
  /** Data de referência (default: agora). Usada para derivar o ano. */
  now?: Date;
}

/**
 * Normaliza o prefixo: string vazia/espacos ou nulo → undefined; caso contrário
 * a sigla em caixa alta sem espacos nas bordas.
 */
function normalizarPrefixo(prefixo?: string | null): string | undefined {
  if (prefixo == null) return undefined;
  const limpo = prefixo.trim();
  return limpo.length > 0 ? limpo : undefined;
}

/**
 * Resolve o prefixo aplicável a um processo: a Unidade tem precedência sobre a
 * Categoria. Retorna undefined quando nenhum prefixo está configurado
 * (normalizando string vazia para undefined).
 *
 * Req. 4.8b: precedência Unidade → Categoria → sem prefixo.
 */
export function resolverPrefixo(
  unidade?: ComPrefixoProtocolo | null,
  categoria?: ComPrefixoProtocolo | null,
): string | undefined {
  return (
    normalizarPrefixo(unidade?.prefixoProtocolo) ??
    normalizarPrefixo(categoria?.prefixoProtocolo) ??
    undefined
  );
}

/**
 * Gera um protocolo único no formato `[PREFIXO-]AAAA-NNNNN` usando um `INCR`
 * atômico do Redis. A sequência é independente por (prefixo, ano):
 *   - com prefixo:  chave `protocolo:seq:{prefixo}:{ano}`  → `PREFIXO-AAAA-NNNNN`
 *   - sem prefixo:  chave `protocolo:seq:{ano}`            → `AAAA-NNNNN`
 * A chave sem prefixo é preservada para manter a sequência já existente dos
 * processos atuais (retrocompatibilidade — Req. 4.8).
 *
 * O segundo parâmetro é retrocompatível e aceita:
 *   - uma `string` → tratada como prefixo (assinatura do design);
 *   - uma `Date`   → tratada como `now` (assinatura legada dos call sites atuais);
 *   - um objeto `{ prefixo?, now? }` → opções nomeadas.
 *
 * TTL de 2 anos em cada chave para evitar vazamento de memória.
 */
export async function gerarProtocolo(
  redis: Pick<Redis, 'incr' | 'expire'>,
  opts?: string | Date | GerarProtocoloOpts,
  now?: Date,
): Promise<string> {
  // Normaliza os diferentes formatos aceitos no 2º parâmetro.
  let prefixo: string | undefined;
  let referencia: Date;

  if (typeof opts === 'string') {
    prefixo = normalizarPrefixo(opts);
    referencia = now ?? new Date();
  } else if (opts instanceof Date) {
    // Assinatura legada: gerarProtocolo(redis, now)
    prefixo = undefined;
    referencia = opts;
  } else if (opts && typeof opts === 'object') {
    prefixo = normalizarPrefixo(opts.prefixo);
    referencia = opts.now ?? now ?? new Date();
  } else {
    prefixo = undefined;
    referencia = now ?? new Date();
  }

  const ano = referencia.getFullYear();
  const escopo = prefixo ? `${prefixo}:${ano}` : `${ano}`;
  const chave = `protocolo:seq:${escopo}`;
  const seq = await redis.incr(chave); // atômico → garante unicidade
  await redis.expire(chave, 63_072_000); // 2 anos

  const base = formatarProtocolo(ano, seq); // AAAA-NNNNN
  return prefixo ? `${prefixo}-${base}` : base;
}
