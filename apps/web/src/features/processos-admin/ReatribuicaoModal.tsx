import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Select, Spinner } from '@/components/ui';
import type { SelectOption } from '@/components/ui';
import {
  JUSTIFICATIVA_MAX_CHARS,
  JUSTIFICATIVA_MIN_CHARS,
  extractApiError,
  useAtribuicao,
  validarJustificativa,
} from './useAtribuicao';

/**
 * Modal de REATRIBUIÇÃO de um Processo (tarefa 15.3, Requisito 12).
 *
 * Autossuficiente: recebe apenas o `processoId` e os callbacks de ciclo de
 * vida, para que a página de detalhe do processo (tarefa 15.2, concorrente)
 * apenas o monte por trás de um botão "Reatribuir".
 *
 * Fluxo:
 * - `Select` de Servidor de destino, populado por
 *   `GET /admin/processos/:id/atribuir/cargas` (mostra a carga de cada
 *   Servidor — Req 12.4).
 * - `textarea` de justificativa com contagem de caracteres ao vivo; a
 *   confirmação fica bloqueada enquanto o tamanho estiver fora de 20–500
 *   caracteres (Req 12.9), validado no cliente ANTES do envio.
 * - Ao confirmar: `POST /admin/processos/:id/reatribuir` com
 *   `{ servidorDestinoId, justificativa }` (Req 12.8, 12.10). Erros de
 *   validação do backend também são exibidos. O sucesso invalida as queries
 *   afetadas e dispara `onSuccess`.
 *
 * _Requirements: 12.4, 12.8, 12.9_
 */

export interface ReatribuicaoModalProps {
  /** Visibilidade do modal. */
  open: boolean;
  /** Processo alvo da reatribuição. */
  processoId: string;
  /** Fecha o modal sem confirmar. */
  onClose: () => void;
  /** Chamado após uma reatribuição bem-sucedida (ex.: fechar + toast). */
  onSuccess?: () => void;
}

export function ReatribuicaoModal({ open, processoId, onClose, onSuccess }: ReatribuicaoModalProps) {
  const [servidorDestinoId, setServidorDestinoId] = useState<string>('');
  const [servidorTouched, setServidorTouched] = useState(false);
  const [justificativa, setJustificativa] = useState<string>('');
  const [justificativaTouched, setJustificativaTouched] = useState(false);

  const { cargasQuery, reatribuirMutation } = useAtribuicao(processoId, {
    enabledCargas: open,
  });

  // Reseta o estado sempre que o modal (re)abre.
  useEffect(() => {
    if (open) {
      setServidorDestinoId('');
      setServidorTouched(false);
      setJustificativa('');
      setJustificativaTouched(false);
      reatribuirMutation.reset();
    }
    // Intencional: só reagimos à (re)abertura do modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const servidorOptions = useMemo<SelectOption[]>(
    () =>
      (cargasQuery.data ?? []).map((c) => ({
        label: `${c.nome} — ${c.processosAtivos} processo(s) ativo(s)`,
        value: c.servidorId,
      })),
    [cargasQuery.data],
  );

  const tamanhoJustificativa = justificativa.trim().length;
  const justificativaErro = validarJustificativa(justificativa);

  const servidorError =
    servidorTouched && !servidorDestinoId ? 'Selecione o servidor de destino.' : undefined;

  const semServidores = cargasQuery.isSuccess && servidorOptions.length === 0;

  const podeConfirmar =
    !reatribuirMutation.isPending &&
    Boolean(servidorDestinoId) &&
    justificativaErro === null &&
    !cargasQuery.isLoading &&
    !semServidores;

  function handleConfirmar(): void {
    // Revalida no cliente ANTES de enviar (Req 12.9).
    if (!servidorDestinoId) {
      setServidorTouched(true);
      return;
    }
    if (validarJustificativa(justificativa) !== null) {
      setJustificativaTouched(true);
      return;
    }

    reatribuirMutation.mutate(
      { servidorDestinoId, justificativa: justificativa.trim() },
      {
        onSuccess: () => {
          onSuccess?.();
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reatribuir processo"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={reatribuirMutation.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmar}
            loading={reatribuirMutation.isPending}
            disabled={!podeConfirmar}
          >
            Confirmar reatribuição
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {cargasQuery.isLoading ? (
          <div className="flex items-center gap-2 text-text-secondary">
            <Spinner size="sm" />
            <span>Carregando servidores da unidade...</span>
          </div>
        ) : cargasQuery.isError ? (
          <Alert variant="danger" title="Não foi possível carregar os servidores">
            {extractApiError(cargasQuery.error)}
          </Alert>
        ) : semServidores ? (
          <Alert variant="warning">
            Nenhum servidor ativo disponível nesta unidade para reatribuição.
          </Alert>
        ) : (
          <Select
            label="Servidor de destino"
            required
            placeholder="Selecione um servidor"
            value={servidorDestinoId}
            options={servidorOptions}
            error={servidorError}
            onChange={(e) => {
              setServidorDestinoId(e.target.value);
              setServidorTouched(true);
            }}
            helperText="A carga atual de cada servidor é exibida ao lado do nome."
            disabled={reatribuirMutation.isPending}
          />
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="reatribuicao-justificativa" className="text-sm font-medium text-text-primary">
            Justificativa
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id="reatribuicao-justificativa"
            value={justificativa}
            maxLength={JUSTIFICATIVA_MAX_CHARS}
            rows={4}
            aria-required
            aria-invalid={justificativaTouched && justificativaErro ? true : undefined}
            aria-describedby="reatribuicao-justificativa-contador reatribuicao-justificativa-erro"
            disabled={reatribuirMutation.isPending}
            onChange={(e) => setJustificativa(e.target.value)}
            onBlur={() => setJustificativaTouched(true)}
            className={
              'w-full rounded-btn border bg-white px-3 py-2 text-base text-text-primary ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
              'disabled:cursor-not-allowed disabled:bg-bg-alt disabled:text-text-secondary ' +
              (justificativaTouched && justificativaErro ? 'border-danger' : 'border-neutral')
            }
          />
          <div className="flex items-center justify-between">
            {justificativaTouched && justificativaErro ? (
              <p id="reatribuicao-justificativa-erro" role="alert" className="text-sm text-danger">
                {justificativaErro}
              </p>
            ) : (
              <p className="text-sm text-text-secondary">
                Informe o motivo da reatribuição.
              </p>
            )}
            <span
              id="reatribuicao-justificativa-contador"
              className="text-sm text-text-secondary tabular-nums"
              aria-live="polite"
            >
              {tamanhoJustificativa}/{JUSTIFICATIVA_MAX_CHARS}
              {tamanhoJustificativa < JUSTIFICATIVA_MIN_CHARS
                ? ` (mín. ${JUSTIFICATIVA_MIN_CHARS})`
                : ''}
            </span>
          </div>
        </div>

        {reatribuirMutation.isError && (
          <Alert variant="danger" title="Não foi possível reatribuir o processo">
            {extractApiError(reatribuirMutation.error)}
          </Alert>
        )}
      </div>
    </Modal>
  );
}

export default ReatribuicaoModal;
