import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { queryKeys } from '@/hooks/useSocket';
import { Alert, Button, Spinner } from '@/components/ui';
import { fetchProcessoDetalhe } from './processo-detalhe/api';
import { isStatusTerminal } from './processo-detalhe/helpers';
import { InformacoesTab } from './processo-detalhe/InformacoesTab';
import { HistoricoTab } from './processo-detalhe/HistoricoTab';
import { DocumentosTab } from './processo-detalhe/DocumentosTab';
import { ComunicacaoTab } from './processo-detalhe/ComunicacaoTab';
import { PrazosTab } from './processo-detalhe/PrazosTab';

/**
 * Página de Detalhe do Processo (Portal do Cidadão, Task 13.3).
 *
 * Layout em abas: Informações, Histórico, Documentos, Comunicação e Prazos
 * (Req 5.1–5.8). O detalhe é carregado por `queryKeys.processo(id)`, a mesma
 * key invalidada pelos eventos de socket (`processo:status_atualizado`,
 * `processo:etapa_avancada`) registrados em `useSocket` — logo o status/etapa
 * se atualizam em ≤5s sem reload (Req 5.9). Cada aba consome sua própria query.
 *
 * Tratamento de erro: enquanto carrega, exibe Spinner; um 404 (processo
 * inexistente ou de outro cidadão — Req 5.10) mostra uma mensagem específica
 * com link de volta a "Meus Processos"; demais erros mostram um Alert genérico.
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
 */

type TabKey = 'informacoes' | 'historico' | 'documentos' | 'comunicacao' | 'prazos';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'informacoes', label: 'Informações' },
  { key: 'historico', label: 'Histórico' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'comunicacao', label: 'Comunicação' },
  { key: 'prazos', label: 'Prazos' },
];

export function ProcessoDetalhePage() {
  const { id = '' } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>('informacoes');

  const { data: processo, isLoading, error } = useQuery({
    queryKey: queryKeys.processo(id),
    queryFn: () => fetchProcessoDetalhe(id),
    enabled: id.length > 0,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Spinner size="lg" label="Carregando processo..." />
      </div>
    );
  }

  if (error || !processo) {
    const is404 = error instanceof AxiosError && error.response?.status === 404;
    return (
      <div className="mx-auto max-w-2xl p-4">
        <Alert
          variant={is404 ? 'warning' : 'danger'}
          title={is404 ? 'Processo não encontrado' : 'Não foi possível carregar o processo'}
        >
          {is404
            ? 'O processo solicitado não existe ou não pertence à sua conta.'
            : 'Ocorreu um erro ao carregar o processo. Tente novamente em alguns instantes.'}
          <div className="mt-3">
            <Link to="/processos">
              <Button variant="secondary" size="sm">
                Voltar para Meus Processos
              </Button>
            </Link>
          </div>
        </Alert>
      </div>
    );
  }

  const encerrado = isStatusTerminal(processo.status);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <Link to="/processos" className="text-sm text-primary hover:underline">
          ← Meus Processos
        </Link>
        <h1 className="text-2xl font-semibold text-text-primary">
          Processo {processo.protocolo}
        </h1>
      </header>

      <div role="tablist" aria-label="Detalhe do processo" className="flex flex-wrap gap-1 border-b border-neutral/50">
        {TABS.map((tab) => {
          const selected = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-touch rounded-t-btn px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                selected
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {activeTab === 'informacoes' && <InformacoesTab processo={processo} />}
        {activeTab === 'historico' && <HistoricoTab processoId={id} />}
        {activeTab === 'documentos' && <DocumentosTab processoId={id} />}
        {activeTab === 'comunicacao' && (
          <ComunicacaoTab processoId={id} encerrado={encerrado} />
        )}
        {activeTab === 'prazos' && <PrazosTab processo={processo} />}
      </div>
    </div>
  );
}

export default ProcessoDetalhePage;
