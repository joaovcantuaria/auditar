import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Spinner } from '@/components/ui';
import {
  listarTiposPorCategoria,
  wizardQueryKeys,
  extrairMensagemErro,
  type TipoProcessoComUnidades,
} from '../wizard.api';
import { OpcaoCard } from './OpcaoCard';

/**
 * Step 2 do wizard — seleção do Tipo de Processo filtrado pela categoria
 * escolhida (Req. 4.2). Tipos inativos são bloqueados: só os ATIVOS aparecem
 * como selecionáveis (Req. 4.12).
 *
 * Fonte de dados: `GET /admin/config/tipos-processo?categoriaId=` (array cru).
 * Ver LACUNA de catálogo público em `wizard.api.ts`.
 */

interface StepTipoProps {
  /** Categoria selecionada no step 1 (obrigatória para buscar os tipos). */
  categoriaId: string;
  /** Tipo atualmente selecionado (do wizardStore). */
  tipoProcessoId: string | null;
  /** Chamado ao escolher um tipo (id + nome + unidades atendentes). */
  onSelecionar: (tipoProcessoId: string, nome: string, unidadeIds: string[]) => void;
}

export function StepTipo({ categoriaId, tipoProcessoId, onSelecionar }: StepTipoProps) {
  const query = useQuery<TipoProcessoComUnidades[]>({
    queryKey: wizardQueryKeys.tipos(categoriaId),
    queryFn: () => listarTiposPorCategoria(categoriaId),
    enabled: Boolean(categoriaId),
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" label="Carregando tipos de processo..." />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="danger" title="Não foi possível carregar os tipos de processo">
        {extrairMensagemErro(query.error, 'Tente novamente em instantes.')}
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </Alert>
    );
  }

  const ativos = (query.data ?? []).filter((t) => t.ativo);

  if (ativos.length === 0) {
    return (
      <Alert variant="info" title="Nenhum tipo de processo disponível">
        Não há tipos de processo disponíveis nesta categoria no momento.
      </Alert>
    );
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm text-text-secondary">
        Selecione o tipo de processo desejado.
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ativos.map((tipo) => (
          <OpcaoCard
            key={tipo.id}
            name="tipo-processo"
            selected={tipoProcessoId === tipo.id}
            title={tipo.nome}
            description={`Prazo: ${tipo.prazoTotalDiasUteis} dia(s) útil(eis)`}
            onSelect={() =>
              onSelecionar(tipo.id, tipo.nome, tipo.unidades.map((u) => u.unidadeId))
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

export default StepTipo;
