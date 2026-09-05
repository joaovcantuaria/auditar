import { useEffect, useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Alert, Button, Modal, Select } from '@/components/ui';
import { extractApiError, MAX_MOTIVO, MAX_OBSERVACAO } from './helpers';
import type {
  ObservacaoCriada,
  ProcessoTramitacaoResumo,
  RegistrarObservacaoInput,
} from './api';

/**
 * Modais das ações de tramitação do Detalhe Administrativo (Task 15.2, Req 11).
 *
 * Cada modal recebe a mutação correspondente (criada em `useProcessoAdmin`) e
 * é responsável apenas pela coleta de entrada e pela exibição de erros via
 * `Alert` — incluindo o 403 com mensagem orientativa custom da rejeição
 * (Req 11.7) e os erros `AUDITORIA_FALHA` (500) / `PROCESSO_ENCERRADO` (400) /
 * `DOCUMENTOS_PENDENTES` (400) devolvidos pelo backend (Req 11.3, 11.9). Ao
 * concluir com sucesso, fecham a si mesmos.
 */

/** Reseta o estado local e a mutação sempre que o modal é (re)aberto. */
function useResetOnOpen(open: boolean, reset: () => void): void {
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

// ---------------------------------------------------------------------------
// Avançar etapa (Req 11.2, 11.3, 11.9)
// ---------------------------------------------------------------------------

export interface AvancarModalProps {
  open: boolean;
  onClose: () => void;
  /** Nome da próxima etapa, ou null quando a ação finaliza (aprova) o processo. */
  proximaEtapaNome: string | null;
  mutation: UseMutationResult<ProcessoTramitacaoResumo, unknown, { observacao?: string }>;
}

export function AvancarEtapaModal({
  open,
  onClose,
  proximaEtapaNome,
  mutation,
}: AvancarModalProps) {
  const [observacao, setObservacao] = useState('');
  useResetOnOpen(open, () => {
    setObservacao('');
    mutation.reset();
  });

  function handleConfirmar() {
    mutation.mutate(
      { observacao: observacao.trim() || undefined },
      { onSuccess: onClose },
    );
  }

  const ehFinalizacao = proximaEtapaNome === null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ehFinalizacao ? 'Finalizar (aprovar) processo' : 'Avançar etapa'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirmar} loading={mutation.isPending}>
            {ehFinalizacao ? 'Aprovar' : 'Avançar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-primary">
          {ehFinalizacao
            ? 'Esta é a última etapa do fluxo — confirmar irá aprovar e encerrar o processo.'
            : `O processo avançará para a etapa: ${proximaEtapaNome}.`}
        </p>
        <label htmlFor="avancar-observacao" className="text-sm font-medium text-text-primary">
          Observação (opcional)
        </label>
        <textarea
          id="avancar-observacao"
          value={observacao}
          maxLength={MAX_OBSERVACAO}
          onChange={(e) => setObservacao(e.target.value)}
          rows={3}
          disabled={mutation.isPending}
          className="w-full rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-bg-alt"
        />
        {mutation.isError && <Alert variant="danger">{extractApiError(mutation.error)}</Alert>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Rejeitar (Req 11.7)
// ---------------------------------------------------------------------------

export interface RejeitarModalProps {
  open: boolean;
  onClose: () => void;
  mutation: UseMutationResult<ProcessoTramitacaoResumo, unknown, { motivo: string }>;
}

export function RejeitarModal({ open, onClose, mutation }: RejeitarModalProps) {
  const [motivo, setMotivo] = useState('');
  useResetOnOpen(open, () => {
    setMotivo('');
    mutation.reset();
  });

  function handleConfirmar() {
    const texto = motivo.trim();
    if (!texto) return;
    mutation.mutate({ motivo: texto }, { onSuccess: onClose });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rejeitar processo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirmar}
            loading={mutation.isPending}
            disabled={motivo.trim().length === 0}
          >
            Rejeitar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label htmlFor="rejeitar-motivo" className="text-sm font-medium text-text-primary">
          Motivo da rejeição
        </label>
        <textarea
          id="rejeitar-motivo"
          value={motivo}
          maxLength={MAX_MOTIVO}
          onChange={(e) => setMotivo(e.target.value)}
          rows={4}
          disabled={mutation.isPending}
          className="w-full rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-bg-alt"
        />
        {/* O backend devolve 403 com mensagem orientativa custom quando falta a
            permissão REJEITAR (Req 11.7) — exibida aqui via extractApiError. */}
        {mutation.isError && <Alert variant="danger">{extractApiError(mutation.error)}</Alert>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Solicitar documentos (Req 11.6)
// ---------------------------------------------------------------------------

export interface SolicitarDocsModalProps {
  open: boolean;
  onClose: () => void;
  mutation: UseMutationResult<ProcessoTramitacaoResumo, unknown, { documentos: string[] }>;
}

export function SolicitarDocumentosModal({ open, onClose, mutation }: SolicitarDocsModalProps) {
  const [documentos, setDocumentos] = useState<string[]>(['']);
  useResetOnOpen(open, () => {
    setDocumentos(['']);
    mutation.reset();
  });

  function atualizar(indice: number, valor: string) {
    setDocumentos((atual) => atual.map((d, i) => (i === indice ? valor : d)));
  }

  function adicionar() {
    setDocumentos((atual) => [...atual, '']);
  }

  function remover(indice: number) {
    setDocumentos((atual) => atual.filter((_, i) => i !== indice));
  }

  const lista = documentos.map((d) => d.trim()).filter((d) => d.length > 0);

  function handleConfirmar() {
    if (lista.length === 0) return;
    mutation.mutate({ documentos: lista }, { onSuccess: onClose });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Solicitar documentos ao cidadão"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmar}
            loading={mutation.isPending}
            disabled={lista.length === 0}
          >
            Solicitar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">
          Liste os documentos que o cidadão deverá enviar. O processo passará para "Aguardando
          documentos".
        </p>
        <ul className="flex flex-col gap-2">
          {documentos.map((doc, indice) => (
            <li key={indice} className="flex items-center gap-2">
              <input
                aria-label={`Documento ${indice + 1}`}
                value={doc}
                maxLength={200}
                onChange={(e) => atualizar(indice, e.target.value)}
                disabled={mutation.isPending}
                placeholder="Ex.: Comprovante de residência"
                className="w-full min-h-touch rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-bg-alt"
              />
              {documentos.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remover(indice)}
                  disabled={mutation.isPending}
                  aria-label={`Remover documento ${indice + 1}`}
                >
                  Remover
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div>
          <Button variant="ghost" size="sm" onClick={adicionar} disabled={mutation.isPending}>
            + Adicionar documento
          </Button>
        </div>
        {mutation.isError && <Alert variant="danger">{extractApiError(mutation.error)}</Alert>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Registrar observação interna/pública (Req 11.4, 11.5)
// ---------------------------------------------------------------------------

export interface ObservacaoModalProps {
  open: boolean;
  onClose: () => void;
  /** Restringe os tipos permitidos às permissões que o servidor possui. */
  tiposPermitidos: Array<'interna' | 'publica'>;
  mutation: UseMutationResult<ObservacaoCriada, unknown, RegistrarObservacaoInput>;
}

export function ObservacaoModal({
  open,
  onClose,
  tiposPermitidos,
  mutation,
}: ObservacaoModalProps) {
  const [tipo, setTipo] = useState<'interna' | 'publica'>(tiposPermitidos[0] ?? 'interna');
  const [conteudo, setConteudo] = useState('');
  useResetOnOpen(open, () => {
    setTipo(tiposPermitidos[0] ?? 'interna');
    setConteudo('');
    mutation.reset();
  });

  function handleConfirmar() {
    const texto = conteudo.trim();
    if (!texto) return;
    mutation.mutate({ tipo, conteudo: texto }, { onSuccess: onClose });
  }

  const opcoes = tiposPermitidos.map((t) => ({
    label: t === 'interna' ? 'Interna (visível apenas a servidores)' : 'Pública (visível ao cidadão)',
    value: t,
  }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar observação"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmar}
            loading={mutation.isPending}
            disabled={conteudo.trim().length === 0}
          >
            Registrar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Tipo de observação"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as 'interna' | 'publica')}
          options={opcoes}
          disabled={mutation.isPending || opcoes.length <= 1}
        />
        <label htmlFor="observacao-conteudo" className="text-sm font-medium text-text-primary">
          Conteúdo (até {MAX_OBSERVACAO} caracteres)
        </label>
        <textarea
          id="observacao-conteudo"
          value={conteudo}
          maxLength={MAX_OBSERVACAO}
          onChange={(e) => setConteudo(e.target.value)}
          rows={4}
          disabled={mutation.isPending}
          className="w-full rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-bg-alt"
        />
        {mutation.isError && <Alert variant="danger">{extractApiError(mutation.error)}</Alert>}
      </div>
    </Modal>
  );
}
