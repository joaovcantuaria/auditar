import { StatusBadge } from '@/components/ui';
import { comoStatusProcesso, formatarData, formatarDataHora } from './helpers';
import type { ProcessoTramitacaoDetalhe } from './api';

/**
 * Aba Informações do Detalhe Administrativo do Processo (Task 15.2, Req 11.1).
 *
 * Exibe a etapa atual, as etapas anteriores concluídas (com a data de
 * conclusão), a próxima etapa prevista no Fluxo, os dados gerais do Processo
 * e o Servidor responsável.
 */
export interface InformacoesTabProps {
  processo: ProcessoTramitacaoDetalhe;
}

/** Linha rótulo/valor de um bloco de dados. */
function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-secondary">{rotulo}</dt>
      <dd className="text-sm text-text-primary">{valor || '—'}</dd>
    </div>
  );
}

export function InformacoesTab({ processo }: InformacoesTabProps) {
  const status = comoStatusProcesso(processo.status);

  return (
    <div className="flex flex-col gap-6">
      {/* --- Andamento no fluxo (Req 11.1) -------------------------------- */}
      <section
        aria-labelledby="info-fluxo-heading"
        className="rounded-card border border-neutral bg-white p-4"
      >
        <h3 id="info-fluxo-heading" className="mb-3 text-base font-semibold text-text-primary">
          Andamento no fluxo
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Etapa atual
            </p>
            <p className="text-sm font-medium text-text-primary">
              {processo.etapaAtual
                ? `${processo.etapaAtual.nome} (${processo.etapaAtual.prazosDiasUteis} dia(s) útil(eis))`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Próxima etapa
            </p>
            <p className="text-sm text-text-primary">
              {processo.proximaEtapa ? processo.proximaEtapa.nome : 'Última etapa (finalização)'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Status
            </p>
            {status ? (
              <StatusBadge status={status} />
            ) : (
              <span className="text-sm text-text-primary">{processo.status}</span>
            )}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-secondary">
            Etapas anteriores concluídas
          </p>
          {processo.etapasAnteriores.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhuma etapa anterior concluída.</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {processo.etapasAnteriores.map((etapa) => (
                <li key={etapa.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-text-primary">{etapa.nome}</span>
                  <span className="text-xs text-text-secondary">
                    {etapa.concluidaEm ? `Concluída em ${formatarDataHora(etapa.concluidaEm)}` : '—'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* --- Dados do processo -------------------------------------------- */}
      <section
        aria-labelledby="info-dados-heading"
        className="rounded-card border border-neutral bg-white p-4"
      >
        <h3 id="info-dados-heading" className="mb-3 text-base font-semibold text-text-primary">
          Dados do processo
        </h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Protocolo" valor={processo.protocolo} />
          <Campo rotulo="Categoria" valor={processo.categoria ?? '—'} />
          <Campo rotulo="Tipo de processo" valor={processo.tipoProcesso} />
          <Campo rotulo="Unidade" valor={processo.unidade} />
          <Campo rotulo="Aberto em" valor={formatarData(processo.abertoEm)} />
          <Campo rotulo="Prazo final" valor={formatarData(processo.prazoFinal)} />
          <Campo rotulo="Prioridade" valor={String(processo.prioridade)} />
          <Campo
            rotulo="Servidor responsável"
            valor={processo.servidorResponsavel ?? 'Não atribuído'}
          />
        </dl>
      </section>

      {/* --- Cidadão ------------------------------------------------------- */}
      <section
        aria-labelledby="info-cidadao-heading"
        className="rounded-card border border-neutral bg-white p-4"
      >
        <h3 id="info-cidadao-heading" className="mb-3 text-base font-semibold text-text-primary">
          Cidadão
        </h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" valor={processo.cidadao?.nome ?? '—'} />
          <Campo rotulo="CPF" valor={processo.cidadao?.cpf ?? '—'} />
        </dl>
      </section>
    </div>
  );
}

export default InformacoesTab;
