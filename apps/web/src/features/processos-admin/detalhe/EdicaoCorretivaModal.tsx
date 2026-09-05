import { useEffect, useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Alert, Button, Input, Modal } from '@/components/ui';
import { extractApiError } from './helpers';
import type {
  EdicaoCorretivaInput,
  EdicaoCorretivaResultado,
  RespostaFormularioResumo,
} from './api';

/**
 * Modal de Edição_Corretiva do Processo (Task 28.2, Req 24.4, 24.5).
 *
 * Permite corrigir a `prioridade` (0–10) e/ou os valores das `respostas` do
 * Formulário_Dinâmico já existentes (editáveis por `campoId`). Envia
 * `PATCH /admin/processos/:id` via `edicaoCorretivaMutation` (do
 * `useProcessoAdmin`), que invalida o detalhe E a trilha de auditoria no
 * sucesso — refletindo a alteração na aba Trilha (Req 24.2).
 *
 * A visibilidade/habilitação do gatilho deste modal é controlada pela página
 * conforme a permissão `editar` (`hasPermission(Permissao.EDITAR)`); o backend
 * também exige `editar` e responde 403 caso contrário — a mensagem é exibida
 * aqui via `Alert`. Falha na auditoria ⇒ 500 `SYS_001` (Req 24.7), idem.
 *
 * Só envia campos efetivamente alterados; o botão fica desabilitado quando não
 * há nenhuma mudança (o backend rejeita corpo vazio).
 *
 * _Requirements: 24.4, 24.5, 24.7_
 */
export interface EdicaoCorretivaModalProps {
  open: boolean;
  onClose: () => void;
  /** Prioridade atual do Processo (valor inicial do campo). */
  prioridadeAtual: number;
  /** Respostas atuais do Formulário_Dinâmico, editáveis por `campoId`. */
  respostas: RespostaFormularioResumo[];
  mutation: UseMutationResult<EdicaoCorretivaResultado, unknown, EdicaoCorretivaInput>;
}

export function EdicaoCorretivaModal({
  open,
  onClose,
  prioridadeAtual,
  respostas,
  mutation,
}: EdicaoCorretivaModalProps) {
  const [prioridade, setPrioridade] = useState<string>(String(prioridadeAtual));
  // Mapa campoId -> valor editado (semeado com os valores atuais).
  const [valores, setValores] = useState<Record<string, string>>({});

  // Reseta o estado sempre que o modal é (re)aberto, semeando com os valores atuais.
  useEffect(() => {
    if (open) {
      setPrioridade(String(prioridadeAtual));
      setValores(Object.fromEntries(respostas.map((r) => [r.campoId, r.valor])));
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const prioridadeNum = Number(prioridade);
  const prioridadeValida =
    prioridade.trim() !== '' &&
    Number.isInteger(prioridadeNum) &&
    prioridadeNum >= 0 &&
    prioridadeNum <= 10;
  const prioridadeMudou = prioridadeValida && prioridadeNum !== prioridadeAtual;

  // Respostas efetivamente alteradas em relação ao valor original.
  const respostasAlteradas = respostas
    .filter((r) => (valores[r.campoId] ?? r.valor) !== r.valor)
    .map((r) => ({ campoId: r.campoId, valor: valores[r.campoId] ?? r.valor }));

  const temAlteracao = prioridadeMudou || respostasAlteradas.length > 0;

  function handleConfirmar() {
    if (!temAlteracao) return;
    const input: EdicaoCorretivaInput = {};
    if (prioridadeMudou) input.prioridade = prioridadeNum;
    if (respostasAlteradas.length > 0) input.respostas = respostasAlteradas;
    mutation.mutate(input, { onSuccess: onClose });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edição corretiva"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmar}
            loading={mutation.isPending}
            disabled={!temAlteracao || !prioridadeValida}
          >
            Salvar correção
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          Corrija a prioridade e/ou os valores das respostas do formulário. Cada alteração é
          registrada na trilha de auditoria com os valores anterior e posterior.
        </p>

        <Input
          label="Prioridade (0 a 10)"
          type="number"
          min={0}
          max={10}
          value={prioridade}
          onChange={(e) => setPrioridade(e.target.value)}
          error={
            prioridade.trim() !== '' && !prioridadeValida
              ? 'Informe um número inteiro entre 0 e 10.'
              : undefined
          }
          disabled={mutation.isPending}
        />

        {respostas.length > 0 && (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-text-primary">
              Respostas do formulário
            </legend>
            {respostas.map((r) => (
              <Input
                key={r.campoId}
                label={r.campoId}
                value={valores[r.campoId] ?? r.valor}
                maxLength={5000}
                onChange={(e) =>
                  setValores((atual) => ({ ...atual, [r.campoId]: e.target.value }))
                }
                disabled={mutation.isPending}
              />
            ))}
          </fieldset>
        )}

        {mutation.isSuccess && (
          <Alert variant="success">Correção aplicada com sucesso.</Alert>
        )}
        {mutation.isError && <Alert variant="danger">{extractApiError(mutation.error)}</Alert>}
      </div>
    </Modal>
  );
}

export default EdicaoCorretivaModal;
