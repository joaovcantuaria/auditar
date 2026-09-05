import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Permissao } from '@auditar/shared';
import { Alert, Button, Spinner } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { baixarPdfProcesso } from './detalhe/api';
// Modais de atribuição/reatribuição pertencem à tarefa 15.3 — esta página
// apenas os CONSOME (não os define). Importados do caminho esperado dentro da
// própria feature `processos-admin/`.
import { AtribuicaoModal } from './AtribuicaoModal';
import { ReatribuicaoModal } from './ReatribuicaoModal';
import { useProcessoAdmin } from './detalhe/useProcessoAdmin';
import { extractApiError, is404, isStatusTerminal } from './detalhe/helpers';
import { InformacoesTab } from './detalhe/InformacoesTab';
import { HistoricoTab } from './detalhe/HistoricoTab';
import { DocumentosTab } from './detalhe/DocumentosTab';
import { ComunicacaoTab } from './detalhe/ComunicacaoTab';
import { InternoTab } from './detalhe/InternoTab';
import { TrilhaAuditoriaTab } from './detalhe/TrilhaAuditoriaTab';
import { AcoesPendentes } from './detalhe/AcoesPendentes';
import { EdicaoCorretivaModal } from './detalhe/EdicaoCorretivaModal';
import {
  AvancarEtapaModal,
  ObservacaoModal,
  RejeitarModal,
  SolicitarDocumentosModal,
} from './detalhe/ActionModals';

/**
 * Página de Detalhe do Processo no Painel Administrativo (Task 15.2,
 * Req 11 + Req 13).
 *
 * Layout em abas (Informações, Movimentações/Histórico, Documentos,
 * Comunicação pública, Interno) + uma barra de ações de tramitação gated por
 * permissão RBAC (`hasPermission` do `authStore`):
 *  - Avançar etapa (MOVER_ETAPA) — modal com observação opcional (Req 11.2).
 *  - Rejeitar (REJEITAR) — modal com motivo; o backend devolve 403 com uma
 *    mensagem orientativa custom quando falta a permissão, exibida via Alert
 *    (Req 11.7).
 *  - Solicitar documentos (SOLICITAR_DOCUMENTOS) — modal com lista (Req 11.6).
 *  - Registrar observação (OBSERVACAO_INTERNA / OBSERVACAO_PUBLICA) — modal
 *    com tipo + conteúdo ≤2000 (Req 11.4, 11.5).
 *  - Atribuir/Reatribuir (ATRIBUIR) — monta os modais da tarefa 15.3.
 *
 * Toda ação usa uma mutação (via `useProcessoAdmin`) que invalida
 * `queryKeys.processo(id)` no sucesso — a mesma key dos eventos de socket
 * (`processo:status_atualizado`, `processo:etapa_avancada`) em `useSocket`,
 * garantindo atualização em tempo real. Erros do backend (incl.
 * `AUDITORIA_FALHA` 500 e `PROCESSO_ENCERRADO` 400) são exibidos em cada modal.
 *
 * Estados: carregando → Spinner; 404 → Alert + link para /admin/processos.
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9, 13.1, 13.2, 13.5, 13.8_
 */

type TabKey =
  | 'informacoes'
  | 'historico'
  | 'trilha'
  | 'documentos'
  | 'comunicacao'
  | 'interno';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'informacoes', label: 'Informações' },
  { key: 'historico', label: 'Movimentações' },
  { key: 'trilha', label: 'Trilha de Auditoria' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'comunicacao', label: 'Comunicação' },
  { key: 'interno', label: 'Interno' },
];

/** Modal de ação atualmente aberto (ou null). */
type ModalAberto =
  | null
  | 'avancar'
  | 'rejeitar'
  | 'solicitar-docs'
  | 'observacao'
  | 'editar'
  | 'atribuir'
  | 'reatribuir';

export function ProcessoDetalheAdminPage() {
  const { id = '' } = useParams<{ id: string }>();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [activeTab, setActiveTab] = useState<TabKey>('informacoes');
  const [modal, setModal] = useState<ModalAberto>(null);
  // Estado do download do PDF (Task 28.2, Req 26.2/26.5).
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);

  const {
    detalheQuery,
    trilhaQuery,
    avancarMutation,
    rejeitarMutation,
    solicitarDocsMutation,
    observacaoMutation,
    edicaoCorretivaMutation,
  } = useProcessoAdmin(id);

  const processo = detalheQuery.data;

  // Tipos de observação permitidos conforme as permissões do servidor (Req 11.4/11.5).
  const tiposObservacao = useMemo<Array<'interna' | 'publica'>>(() => {
    const tipos: Array<'interna' | 'publica'> = [];
    if (hasPermission(Permissao.OBSERVACAO_INTERNA)) tipos.push('interna');
    if (hasPermission(Permissao.OBSERVACAO_PUBLICA)) tipos.push('publica');
    return tipos;
  }, [hasPermission]);

  if (detalheQuery.isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Spinner size="lg" label="Carregando processo..." />
      </div>
    );
  }

  if (detalheQuery.isError || !processo) {
    const notFound = is404(detalheQuery.error);
    return (
      <div className="mx-auto max-w-2xl p-4">
        <Alert
          variant={notFound ? 'warning' : 'danger'}
          title={notFound ? 'Processo não encontrado' : 'Não foi possível carregar o processo'}
        >
          {notFound
            ? 'O processo solicitado não existe.'
            : extractApiError(detalheQuery.error)}
          <div className="mt-3">
            <Link to="/admin/processos">
              <Button variant="secondary" size="sm">
                Voltar para Processos
              </Button>
            </Link>
          </div>
        </Alert>
      </div>
    );
  }

  const encerrado = isStatusTerminal(processo.status);

  // Botões da barra de ações, cada um condicionado a uma permissão (Req 11).
  const podeAvancar = hasPermission(Permissao.MOVER_ETAPA);
  const podeRejeitar = hasPermission(Permissao.REJEITAR);
  const podeSolicitarDocs = hasPermission(Permissao.SOLICITAR_DOCUMENTOS);
  const podeObservar = tiposObservacao.length > 0;
  const podeAtribuir = hasPermission(Permissao.ATRIBUIR);
  // Edição corretiva (Req 24.4) e anexação de documentos (Req 24.6) exigem `editar`.
  const podeEditar = hasPermission(Permissao.EDITAR);
  // Geração de PDF (Req 26.6) exige `visualizar`.
  const podeGerarPdf = hasPermission(Permissao.VISUALIZAR);

  /** Baixa o PDF consolidado do Processo (Req 26.2), tratando falha (Req 26.5). */
  async function handleGerarPdf(): Promise<void> {
    setGerandoPdf(true);
    setErroPdf(null);
    try {
      await baixarPdfProcesso(id, processo.protocolo);
    } catch {
      setErroPdf('Não foi possível gerar o PDF do processo. Tente novamente.');
    } finally {
      setGerandoPdf(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <Link to="/admin/processos" className="text-sm text-primary hover:underline">
          ← Processos
        </Link>
        <h1 className="font-heading text-h2 text-text-primary">
          Processo {processo.protocolo}
        </h1>
      </header>

      {/* --- Barra de ações de tramitação (gated por permissão) ----------- */}
      {(podeAvancar ||
        podeRejeitar ||
        podeSolicitarDocs ||
        podeObservar ||
        podeAtribuir ||
        podeEditar ||
        podeGerarPdf) && (
        <div
          className="flex flex-wrap gap-2 rounded-card border border-neutral bg-white p-3"
          aria-label="Ações do processo"
        >
          {podeAvancar && (
            <Button onClick={() => setModal('avancar')} disabled={encerrado}>
              {processo.proximaEtapa ? 'Avançar etapa' : 'Finalizar (aprovar)'}
            </Button>
          )}
          {podeRejeitar && (
            <Button variant="danger" onClick={() => setModal('rejeitar')} disabled={encerrado}>
              Rejeitar
            </Button>
          )}
          {podeSolicitarDocs && (
            <Button variant="secondary" onClick={() => setModal('solicitar-docs')} disabled={encerrado}>
              Solicitar documentos
            </Button>
          )}
          {podeObservar && (
            <Button variant="secondary" onClick={() => setModal('observacao')}>
              Registrar observação
            </Button>
          )}
          {podeEditar && (
            <Button variant="secondary" onClick={() => setModal('editar')}>
              Edição corretiva
            </Button>
          )}
          {podeGerarPdf && (
            <Button
              variant="secondary"
              onClick={() => void handleGerarPdf()}
              loading={gerandoPdf}
            >
              Gerar PDF
            </Button>
          )}
          {podeAtribuir && (
            <>
              <Button variant="secondary" onClick={() => setModal('atribuir')}>
                Atribuir
              </Button>
              <Button variant="secondary" onClick={() => setModal('reatribuir')}>
                Reatribuir
              </Button>
            </>
          )}
        </div>
      )}

      {erroPdf && <Alert variant="danger">{erroPdf}</Alert>}

      {encerrado && (
        <Alert variant="info">
          Este processo está encerrado. Ações de tramitação e envio de mensagens estão
          desabilitados.
        </Alert>
      )}

      {/* --- Ações pendentes (Task 28.1, Req 24.3) ------------------------ */}
      <AcoesPendentes acoesPendentes={processo.acoesPendentes} />

      {/* --- Abas --------------------------------------------------------- */}
      <div
        role="tablist"
        aria-label="Detalhe do processo"
        className="flex flex-wrap gap-1 border-b border-neutral/50"
      >
        {TABS.map((tab) => {
          const selected = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`admin-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`admin-panel-${tab.key}`}
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
        id={`admin-panel-${activeTab}`}
        aria-labelledby={`admin-tab-${activeTab}`}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {activeTab === 'informacoes' && <InformacoesTab processo={processo} />}
        {activeTab === 'historico' && <HistoricoTab movimentacoes={processo.movimentacoes} />}
        {activeTab === 'trilha' && (
          <TrilhaAuditoriaTab
            itens={trilhaQuery.data ?? []}
            isLoading={trilhaQuery.isLoading}
            isError={trilhaQuery.isError}
            erro={trilhaQuery.error}
          />
        )}
        {activeTab === 'documentos' && (
          <DocumentosTab
            processoId={id}
            documentosSolicitadosPendentes={
              processo.acoesPendentes.documentosSolicitadosPendentes
            }
            podeAnexar={podeEditar}
          />
        )}
        {activeTab === 'comunicacao' && <ComunicacaoTab processoId={id} encerrado={encerrado} />}
        {activeTab === 'interno' && <InternoTab processoId={id} encerrado={encerrado} />}
      </div>

      {/* --- Modais de ação ----------------------------------------------- */}
      <AvancarEtapaModal
        open={modal === 'avancar'}
        onClose={() => setModal(null)}
        proximaEtapaNome={processo.proximaEtapa?.nome ?? null}
        mutation={avancarMutation}
      />
      <RejeitarModal
        open={modal === 'rejeitar'}
        onClose={() => setModal(null)}
        mutation={rejeitarMutation}
      />
      <SolicitarDocumentosModal
        open={modal === 'solicitar-docs'}
        onClose={() => setModal(null)}
        mutation={solicitarDocsMutation}
      />
      {podeObservar && (
        <ObservacaoModal
          open={modal === 'observacao'}
          onClose={() => setModal(null)}
          tiposPermitidos={tiposObservacao}
          mutation={observacaoMutation}
        />
      )}
      {podeEditar && (
        <EdicaoCorretivaModal
          open={modal === 'editar'}
          onClose={() => setModal(null)}
          prioridadeAtual={processo.prioridade}
          respostas={processo.respostas}
          mutation={edicaoCorretivaMutation}
        />
      )}
      {/* Modais da tarefa 15.3 — consumidos aqui por trás dos botões. */}
      <AtribuicaoModal
        open={modal === 'atribuir'}
        processoId={id}
        onClose={() => setModal(null)}
      />
      <ReatribuicaoModal
        open={modal === 'reatribuir'}
        processoId={id}
        onClose={() => setModal(null)}
      />
    </section>
  );
}

export default ProcessoDetalheAdminPage;
