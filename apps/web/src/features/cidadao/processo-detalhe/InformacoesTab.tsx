import { StatusProcesso } from '@auditar/shared';
import { StatusBadge } from '@/components/ui';
import type { ProcessoDetalhe } from './api';
import { formatarData } from './helpers';

/**
 * Aba Informações do Detalhe do Processo (Req 5.1, 5.2).
 *
 * Exibe os dados cadastrais do Processo (protocolo, status, tipo/categoria/
 * unidade, datas, etapa atual) e as respostas do formulário submetido. Os
 * rótulos das respostas usam o `campoId` retornado pelo backend, já que a
 * projeção pública não inclui o rótulo original do campo.
 */
export interface InformacoesTabProps {
  processo: ProcessoDetalhe;
}

/** Linha rótulo → valor de um bloco de definição. */
function DefItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm font-medium text-text-secondary">{label}</dt>
      <dd className="text-base text-text-primary">{value || '—'}</dd>
    </div>
  );
}

export function InformacoesTab({ processo }: InformacoesTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DefItem label="Protocolo" value={processo.protocolo} />
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm font-medium text-text-secondary">Status</dt>
          <dd>
            <StatusBadge status={processo.status as StatusProcesso} />
          </dd>
        </div>
        <DefItem label="Categoria" value={processo.categoria ?? '—'} />
        <DefItem label="Tipo de processo" value={processo.tipoProcesso} />
        <DefItem label="Unidade" value={processo.unidade} />
        <DefItem label="Etapa atual" value={processo.etapaAtual ?? '—'} />
        <DefItem label="Aberto em" value={formatarData(processo.abertoEm)} />
        <DefItem label="Prazo final" value={formatarData(processo.prazoFinal)} />
      </dl>

      <section aria-labelledby="respostas-heading">
        <h3 id="respostas-heading" className="mb-2 text-base font-semibold text-text-primary">
          Dados do formulário
        </h3>
        {processo.respostas.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nenhuma informação de formulário foi registrada para este processo.
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {processo.respostas.map((r) => (
              <DefItem key={r.campoId} label={r.campoId} value={r.valor} />
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

export default InformacoesTab;
