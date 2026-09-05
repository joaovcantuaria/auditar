import { Alert, Badge } from '@/components/ui';
import type { Indicador } from '../dashboard.types';
import type {
  GrupoPrazo,
  IndicadorPrazos as IndicadorPrazosData,
  ProcessoPrazo,
} from '../dashboardEstendida.types';

/**
 * Indicador de prazos (Task 27.1, Req 9.8): contagem e lista de Processos
 * vencendo em ≤3 dias úteis e vencidos, com identificação por protocolo.
 *
 * Recebe o indicador `prazos` de `GET /admin/dashboard/resumo`. Em falha isolada
 * (`erro: true`/`value == null`) mostra um Alert inline (Req 9.6).
 */

export interface IndicadorPrazosProps {
  indicador: Indicador<IndicadorPrazosData> | undefined;
}

/** Formata a data de vencimento (ISO → pt-BR curto com hora). */
function formatarPrazo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface GrupoPrazoSecaoProps {
  titulo: string;
  grupo: GrupoPrazo;
  cor: 'yellow' | 'red';
  vazioMsg: string;
}

/** Uma seção (vencendo ou vencidos): cabeçalho com contagem + lista de processos. */
function GrupoPrazoSecao({ titulo, grupo, cor, vazioMsg }: GrupoPrazoSecaoProps) {
  return (
    <section className="flex flex-col gap-2" aria-label={titulo}>
      <header className="flex items-center gap-2">
        <h4 className="font-heading text-sm font-semibold text-text-secondary">{titulo}</h4>
        <Badge color={cor}>{grupo.quantidade}</Badge>
      </header>

      {grupo.processos.length === 0 ? (
        <p className="text-sm text-text-secondary">{vazioMsg}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral/20">
          {grupo.processos.map((p: ProcessoPrazo) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="font-mono text-sm font-medium text-text-primary">
                {p.protocolo}
              </span>
              <span className="text-xs text-text-secondary">{formatarPrazo(p.prazoFinal)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function IndicadorPrazos({ indicador }: IndicadorPrazosProps) {
  const indisponivel = !indicador || indicador.erro || indicador.value == null;

  return (
    <section
      className="flex flex-col gap-4 rounded-card border border-neutral/30 bg-white p-4 shadow-sm"
      aria-label="Indicador de prazos"
    >
      <h3 className="font-heading text-sm font-semibold text-text-secondary">Prazos</h3>

      {indisponivel ? (
        <Alert variant="warning" title="Prazos indisponíveis">
          Não foi possível carregar o indicador de prazos. Os demais continuam disponíveis.
        </Alert>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <GrupoPrazoSecao
            titulo="Vencendo em até 3 dias úteis"
            grupo={(indicador.value as IndicadorPrazosData).vencendo}
            cor="yellow"
            vazioMsg="Nenhum processo vencendo no período."
          />
          <GrupoPrazoSecao
            titulo="Vencidos"
            grupo={(indicador.value as IndicadorPrazosData).vencidos}
            cor="red"
            vazioMsg="Nenhum processo vencido."
          />
        </div>
      )}
    </section>
  );
}

export default IndicadorPrazos;
