import { useQuery } from '@tanstack/react-query';
import type { Unidade } from '@auditar/shared';
import { Alert, Button, Spinner } from '@/components/ui';
import { listarUnidades, wizardQueryKeys, extrairMensagemErro } from '../wizard.api';
import { OpcaoCard } from './OpcaoCard';

/**
 * Step 3 do wizard — seleção da Unidade atendente (Req. 4.3). Exibe nome,
 * secretaria, endereço, telefone e horário de funcionamento de cada unidade.
 * Unidades inativas são bloqueadas: só as ATIVAS aparecem (Req. 4.13). Quando o
 * tipo declara unidades atendentes, a lista é restrita a elas.
 *
 * Fonte de dados: `GET /admin/config/unidades` → `{ data: Unidade[] }`.
 * Ver LACUNA de catálogo público em `wizard.api.ts`.
 */

interface StepUnidadeProps {
  /** Tipo de processo selecionado (usado como chave de cache). */
  tipoProcessoId: string;
  /** Ids das unidades atendentes do tipo; vazio = sem restrição de atendimento. */
  unidadesAtendentesIds: string[];
  /** Unidade atualmente selecionada (do wizardStore). */
  unidadeId: string | null;
  /** Chamado ao escolher uma unidade (id + nome para a revisão). */
  onSelecionar: (unidadeId: string, nome: string) => void;
}

export function StepUnidade({
  tipoProcessoId,
  unidadesAtendentesIds,
  unidadeId,
  onSelecionar,
}: StepUnidadeProps) {
  const query = useQuery<Unidade[]>({
    queryKey: wizardQueryKeys.unidades(tipoProcessoId),
    queryFn: listarUnidades,
    enabled: Boolean(tipoProcessoId),
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" label="Carregando unidades..." />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="danger" title="Não foi possível carregar as unidades">
        {extrairMensagemErro(query.error, 'Tente novamente em instantes.')}
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </Alert>
    );
  }

  const restricao = new Set(unidadesAtendentesIds);
  const disponiveis = (query.data ?? []).filter(
    (u) => u.ativa && (restricao.size === 0 || restricao.has(u.id)),
  );

  if (disponiveis.length === 0) {
    return (
      <Alert variant="info" title="Nenhuma unidade disponível">
        Não há unidades disponíveis para atender este tipo de processo no momento.
      </Alert>
    );
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm text-text-secondary">
        Selecione a unidade responsável pelo atendimento.
      </legend>
      <div className="grid grid-cols-1 gap-3">
        {disponiveis.map((unidade) => (
          <OpcaoCard
            key={unidade.id}
            name="unidade"
            selected={unidadeId === unidade.id}
            title={unidade.nome}
            description={unidade.secretaria}
            onSelect={() => onSelecionar(unidade.id, unidade.nome)}
          >
            <span className="mt-1 flex flex-col gap-0.5 text-sm text-text-secondary">
              {unidade.endereco && <span>Endereço: {unidade.endereco}</span>}
              {unidade.telefone && <span>Telefone: {unidade.telefone}</span>}
              {unidade.horarioFuncionamento && (
                <span>Horário: {unidade.horarioFuncionamento}</span>
              )}
            </span>
          </OpcaoCard>
        ))}
      </div>
    </fieldset>
  );
}

export default StepUnidade;
