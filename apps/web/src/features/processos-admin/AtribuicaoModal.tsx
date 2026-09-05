import { useEffect, useMemo, useState } from 'react';
import { ModoAtribuicao } from '@auditar/shared';
import { Alert, Button, Modal, Select, Spinner } from '@/components/ui';
import type { SelectOption } from '@/components/ui';
import { extractApiError, useAtribuicao } from './useAtribuicao';

/**
 * Modal de ATRIBUIÇÃO de um Processo (tarefa 15.3, Requisito 12).
 *
 * Autossuficiente: recebe apenas o `processoId` e os callbacks de ciclo de
 * vida, para que a página de detalhe do processo (tarefa 15.2, concorrente)
 * apenas o monte por trás de um botão "Atribuir".
 *
 * Fluxo:
 * - Um `Select` de modo: Automático / Manual / Fila geral (Req 12.1).
 * - Modo AUTOMÁTICO: o backend seleciona o Servidor de menor carga (Req 12.2).
 * - Modo MANUAL: busca `GET /admin/processos/:id/atribuir/cargas` e mostra a
 *   lista de Servidores com a contagem de Processos ativos de cada um, para
 *   escolha ANTES de confirmar (Req 12.4). O `servidorId` é obrigatório.
 * - Modo FILA GERAL: deixa o Processo disponível na fila da Unidade (Req 12.5).
 * - Ao confirmar: `POST /admin/processos/:id/atribuir` com `{ modo, servidorId? }`
 *   (Req 12.7). O sucesso invalida as queries afetadas e dispara `onSuccess`.
 *
 * _Requirements: 12.1, 12.2, 12.4, 12.5, 12.7_
 */

export interface AtribuicaoModalProps {
  /** Visibilidade do modal. */
  open: boolean;
  /** Processo alvo da atribuição. */
  processoId: string;
  /** Fecha o modal sem confirmar. */
  onClose: () => void;
  /** Chamado após uma atribuição bem-sucedida (ex.: fechar + toast). */
  onSuccess?: () => void;
}

/** Opções fixas de modo de atribuição (Req 12.1). */
const MODO_OPTIONS: SelectOption[] = [
  { label: 'Automático (menor carga)', value: ModoAtribuicao.AUTOMATICO },
  { label: 'Manual (escolher servidor)', value: ModoAtribuicao.MANUAL },
  { label: 'Fila geral', value: ModoAtribuicao.FILA_GERAL },
];

export function AtribuicaoModal({ open, processoId, onClose, onSuccess }: AtribuicaoModalProps) {
  const [modo, setModo] = useState<ModoAtribuicao>(ModoAtribuicao.AUTOMATICO);
  const [servidorId, setServidorId] = useState<string>('');
  const [servidorTouched, setServidorTouched] = useState(false);

  const isManual = modo === ModoAtribuicao.MANUAL;

  // Só busca as cargas quando o modal está aberto E o modo exige escolher um
  // Servidor (manual). Evita fetch desnecessário nos modos automático/fila.
  const { cargasQuery, atribuirMutation } = useAtribuicao(processoId, {
    enabledCargas: open && isManual,
  });

  // Reseta o estado sempre que o modal (re)abre.
  useEffect(() => {
    if (open) {
      setModo(ModoAtribuicao.AUTOMATICO);
      setServidorId('');
      setServidorTouched(false);
      atribuirMutation.reset();
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

  const servidorError =
    isManual && servidorTouched && !servidorId ? 'Selecione um servidor.' : undefined;

  const semServidores = isManual && cargasQuery.isSuccess && servidorOptions.length === 0;

  const podeConfirmar =
    !atribuirMutation.isPending &&
    (!isManual || (Boolean(servidorId) && !cargasQuery.isLoading && !semServidores));

  function handleModoChange(value: string): void {
    setModo(value as ModoAtribuicao);
    setServidorId('');
    setServidorTouched(false);
  }

  function handleConfirmar(): void {
    if (isManual && !servidorId) {
      setServidorTouched(true);
      return;
    }

    atribuirMutation.mutate(
      isManual ? { modo, servidorId } : { modo },
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
      title="Atribuir processo"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={atribuirMutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirmar} loading={atribuirMutation.isPending} disabled={!podeConfirmar}>
            Confirmar atribuição
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Modo de atribuição"
          value={modo}
          options={MODO_OPTIONS}
          onChange={(e) => handleModoChange(e.target.value)}
          disabled={atribuirMutation.isPending}
        />

        {modo === ModoAtribuicao.AUTOMATICO && (
          <Alert variant="info">
            O processo será atribuído automaticamente ao servidor com a menor carga na unidade.
          </Alert>
        )}

        {modo === ModoAtribuicao.FILA_GERAL && (
          <Alert variant="info">
            O processo ficará disponível na fila geral da unidade, sem servidor responsável.
          </Alert>
        )}

        {isManual && (
          <div className="flex flex-col gap-2">
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
                Nenhum servidor ativo disponível nesta unidade para atribuição manual.
              </Alert>
            ) : (
              <Select
                label="Servidor responsável"
                required
                placeholder="Selecione um servidor"
                value={servidorId}
                options={servidorOptions}
                error={servidorError}
                onChange={(e) => {
                  setServidorId(e.target.value);
                  setServidorTouched(true);
                }}
                helperText="A carga atual de cada servidor é exibida ao lado do nome."
                disabled={atribuirMutation.isPending}
              />
            )}
          </div>
        )}

        {atribuirMutation.isError && (
          <Alert variant="danger" title="Não foi possível atribuir o processo">
            {extractApiError(atribuirMutation.error)}
          </Alert>
        )}
      </div>
    </Modal>
  );
}

export default AtribuicaoModal;
