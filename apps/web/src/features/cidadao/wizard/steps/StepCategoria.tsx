import { useQuery } from '@tanstack/react-query';
import type { Categoria } from '@auditar/shared';
import { Alert, Button, Spinner } from '@/components/ui';
import { listarCategorias, wizardQueryKeys, extrairMensagemErro } from '../wizard.api';
import { OpcaoCard } from './OpcaoCard';

/**
 * Step 1 do wizard — seleção de Categoria ativa (Req. 4.1).
 *
 * Lista apenas categorias ativas; exibe mensagem quando nenhuma está
 * disponível. Ver a LACUNA de catálogo público documentada em `wizard.api.ts`:
 * a origem dos dados é a rota administrativa `/admin/config/categorias`.
 */

interface StepCategoriaProps {
  /** Categoria atualmente selecionada (do wizardStore). */
  categoriaId: string | null;
  /** Chamado ao escolher a categoria (id + nome para a revisão). */
  onSelecionar: (categoriaId: string, nome: string) => void;
}

export function StepCategoria({ categoriaId, onSelecionar }: StepCategoriaProps) {
  const query = useQuery<Categoria[]>({
    queryKey: wizardQueryKeys.categorias,
    queryFn: listarCategorias,
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" label="Carregando categorias..." />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="danger" title="Não foi possível carregar as categorias">
        {extrairMensagemErro(query.error, 'Tente novamente em instantes.')}
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </Alert>
    );
  }

  const ativas = (query.data ?? []).filter((c) => c.ativa);

  if (ativas.length === 0) {
    return (
      <Alert variant="info" title="Nenhuma categoria disponível">
        Não há categorias disponíveis para abertura de novos processos no momento.
      </Alert>
    );
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm text-text-secondary">
        Selecione a categoria do processo que deseja abrir.
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ativas.map((categoria) => (
          <OpcaoCard
            key={categoria.id}
            name="categoria"
            selected={categoriaId === categoria.id}
            title={categoria.nome}
            description={categoria.descricao ?? undefined}
            onSelect={() => onSelecionar(categoria.id, categoria.nome)}
          />
        ))}
      </div>
    </fieldset>
  );
}

export default StepCategoria;
