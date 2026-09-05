import { Alert, Button, Modal } from '@/components/ui';

/**
 * Modal de confirmação de desativação (soft delete) de um item de configuração.
 *
 * Exibido quando o backend sinaliza que existem Processos em andamento
 * vinculados ao item (resposta 409 com `processosImpactados`). O usuário deve
 * confirmar explicitamente antes que a desativação seja persistida (Req. 14.6).
 * A desativação NÃO altera Processos existentes — apenas impede novos (Req. 14.7).
 */

export interface ConfirmarDesativacaoModalProps {
  /** Se o modal está visível. */
  open: boolean;
  /** Nome do item que será desativado (exibido no corpo). */
  nomeItem: string;
  /** Rótulo do tipo de item, ex.: "categoria", "unidade", "tipo de processo". */
  tipoItem: string;
  /** Quantidade de Processos em andamento impactados. */
  processosImpactados: number;
  /** Indica que a confirmação está em andamento (mutação pendente). */
  loading?: boolean;
  /** Mensagem de erro da tentativa de confirmação, se houver. */
  erro?: string;
  /** Chamado ao confirmar a desativação. */
  onConfirmar: () => void;
  /** Chamado ao cancelar / fechar. */
  onCancelar: () => void;
}

export function ConfirmarDesativacaoModal({
  open,
  nomeItem,
  tipoItem,
  processosImpactados,
  loading = false,
  erro,
  onConfirmar,
  onCancelar,
}: ConfirmarDesativacaoModalProps) {
  return (
    <Modal
      open={open}
      onClose={onCancelar}
      title="Confirmar desativação"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancelar} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirmar} loading={loading}>
            Desativar mesmo assim
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert variant="warning" title="Processos em andamento">
          Existe(m){' '}
          <strong>
            {processosImpactados} processo{processosImpactados === 1 ? '' : 's'}
          </strong>{' '}
          em andamento vinculado{processosImpactados === 1 ? '' : 's'} a esta {tipoItem}.
        </Alert>
        <p className="text-sm text-text-primary">
          Ao desativar <strong>{nomeItem}</strong>, os processos já existentes não serão
          alterados, mas não será mais possível criar novos processos utilizando esta{' '}
          {tipoItem}. Deseja continuar?
        </p>
        {erro && (
          <Alert variant="danger" title="Não foi possível desativar">
            {erro}
          </Alert>
        )}
      </div>
    </Modal>
  );
}

export default ConfirmarDesativacaoModal;
