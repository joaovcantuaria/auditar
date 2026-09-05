import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { Categoria } from '@auditar/shared';
import { Alert, Badge, Button, Input, Modal, Spinner } from '@/components/ui';
import {
  configQueryKeys,
  criarCategoria,
  desativarCategoria,
  editarCategoria,
  extrairCampoErro,
  extrairMensagemErro,
  listarCategorias,
  type CategoriaFormPayload,
} from './config.api';
import { ConfirmarDesativacaoModal } from './ConfirmarDesativacaoModal';

/**
 * Página de configuração de Categorias (Painel Administrativo).
 *
 * Lista as Categorias em tabela (nome, secretaria, status), permite criar e
 * editar via modal com formulário validado (react-hook-form + Zod espelhando
 * `criarCategoriaSchema`/`editarCategoriaSchema` do backend) e desativar com
 * confirmação quando houver Processos em andamento impactados.
 *
 * Regras de validação espelhadas (Req. 14.1/14.2):
 *  - nome: obrigatório, ≤100 caracteres;
 *  - descricao: opcional, ≤500; icone/cor/secretaria/gestorId: opcionais.
 * Erros de nome duplicado retornados pelo backend (`field: 'nome'`) são
 * exibidos inline no campo nome (Req. 14.2).
 *
 * _Requirements: 14.1, 14.2, 14.6, 14.7_
 */

// ---------------------------------------------------------------------------
// Schema do formulário — espelha o schema Zod do backend (Req. 14.1).
// ---------------------------------------------------------------------------

const categoriaFormSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Nome é obrigatório')
    .max(100, 'Nome deve conter no máximo 100 caracteres'),
  descricao: z
    .string()
    .trim()
    .max(500, 'Descrição deve conter no máximo 500 caracteres')
    .optional(),
  icone: z.string().trim().max(100).optional(),
  cor: z.string().trim().max(50).optional(),
  secretaria: z.string().trim().max(200).optional(),
});

type CategoriaFormValues = z.infer<typeof categoriaFormSchema>;

const FORM_VAZIO: CategoriaFormValues = {
  nome: '',
  descricao: '',
  icone: '',
  cor: '',
  secretaria: '',
};

/** Remove campos vazios opcionais antes de enviar ao backend. */
function montarPayload(values: CategoriaFormValues): CategoriaFormPayload {
  const limpar = (v?: string): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  return {
    nome: values.nome.trim(),
    descricao: limpar(values.descricao),
    icone: limpar(values.icone),
    cor: limpar(values.cor),
    secretaria: limpar(values.secretaria),
  };
}

export function CategoriasPage() {
  const queryClient = useQueryClient();

  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: 'success' | 'danger'; msg: string } | null>(
    null,
  );

  // Estado da confirmação de desativação (Req. 14.6).
  const [desativando, setDesativando] = useState<Categoria | null>(null);
  const [impactados, setImpactados] = useState(0);
  const [confirmacaoAberta, setConfirmacaoAberta] = useState(false);

  const listaQuery = useQuery({
    queryKey: configQueryKeys.categorias,
    queryFn: listarCategorias,
  });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CategoriaFormValues>({
    resolver: zodResolver(categoriaFormSchema),
    mode: 'onBlur',
    defaultValues: FORM_VAZIO,
  });

  useEffect(() => {
    if (modalAberto) {
      reset(
        editando
          ? {
              nome: editando.nome,
              descricao: editando.descricao ?? '',
              icone: editando.icone ?? '',
              cor: editando.cor ?? '',
              secretaria: editando.secretaria ?? '',
            }
          : FORM_VAZIO,
      );
    }
  }, [modalAberto, editando, reset]);

  const salvarMutation = useMutation({
    mutationFn: (values: CategoriaFormValues) => {
      const payload = montarPayload(values);
      return editando ? editarCategoria(editando.id, payload) : criarCategoria(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: configQueryKeys.categorias });
      setFeedback({
        tipo: 'success',
        msg: editando ? 'Categoria atualizada com sucesso.' : 'Categoria criada com sucesso.',
      });
      fecharModal();
    },
    onError: (err) => {
      // Mapeia erro de campo (ex.: nome duplicado) para o input correspondente.
      const campo = extrairCampoErro(err);
      const mensagem = extrairMensagemErro(err, 'Não foi possível salvar a categoria.');
      if (campo === 'nome') {
        setError('nome', { type: 'server', message: mensagem });
      }
    },
  });

  const desativarMutation = useMutation({
    mutationFn: ({ id, confirmar }: { id: string; confirmar: boolean }) =>
      desativarCategoria(id, confirmar),
    onSuccess: (resultado, variaveis) => {
      if (resultado.precisaConfirmacao) {
        setImpactados(resultado.processosImpactados);
        setConfirmacaoAberta(true);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: configQueryKeys.categorias });
      setFeedback({ tipo: 'success', msg: 'Categoria desativada com sucesso.' });
      if (variaveis.confirmar) {
        setConfirmacaoAberta(false);
        setDesativando(null);
      }
    },
  });

  function abrirCriar() {
    setEditando(null);
    setModalAberto(true);
    salvarMutation.reset();
  }

  function abrirEditar(categoria: Categoria) {
    setEditando(categoria);
    setModalAberto(true);
    salvarMutation.reset();
  }

  function fecharModal() {
    setModalAberto(false);
    setEditando(null);
  }

  function iniciarDesativacao(categoria: Categoria) {
    setFeedback(null);
    setDesativando(categoria);
    desativarMutation.mutate({ id: categoria.id, confirmar: false });
  }

  function confirmarDesativacao() {
    if (desativando) {
      desativarMutation.mutate({ id: desativando.id, confirmar: true });
    }
  }

  function cancelarDesativacao() {
    setConfirmacaoAberta(false);
    setDesativando(null);
    desativarMutation.reset();
  }

  const categorias = listaQuery.data ?? [];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold text-text-primary">Categorias</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Gerencie as categorias de processos disponíveis no sistema.
          </p>
        </div>
        <Button onClick={abrirCriar}>Nova categoria</Button>
      </header>

      {feedback && (
        <Alert variant={feedback.tipo} title={feedback.tipo === 'success' ? 'Sucesso' : 'Erro'}>
          {feedback.msg}
        </Alert>
      )}

      {listaQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando categorias..." />
        </div>
      ) : listaQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar as categorias">
          Tente novamente em instantes.
        </Alert>
      ) : categorias.length === 0 ? (
        <Alert variant="info" title="Nenhuma categoria cadastrada">
          Clique em &ldquo;Nova categoria&rdquo; para começar.
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-card border border-bg-alt">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="bg-bg-alt text-text-secondary">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Nome</th>
                <th scope="col" className="px-4 py-3 font-medium">Secretaria</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {categorias.map((categoria) => (
                <tr key={categoria.id} className="border-t border-bg-alt">
                  <td className="px-4 py-3 text-text-primary">{categoria.nome}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {categoria.secretaria ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={categoria.ativa ? 'green' : 'neutral'}>
                      {categoria.ativa ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => abrirEditar(categoria)}>
                        Editar
                      </Button>
                      {categoria.ativa && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => iniciarDesativacao(categoria)}
                          loading={
                            desativarMutation.isPending &&
                            desativando?.id === categoria.id &&
                            !confirmacaoAberta
                          }
                        >
                          Desativar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de criação/edição */}
      <Modal
        open={modalAberto}
        onClose={fecharModal}
        title={editando ? 'Editar categoria' : 'Nova categoria'}
        footer={
          <>
            <Button variant="secondary" onClick={fecharModal} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="categoria-form"
              loading={salvarMutation.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        <form
          id="categoria-form"
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => salvarMutation.mutate(values))}
          noValidate
        >
          {salvarMutation.isError && !errors.nome && (
            <Alert variant="danger" title="Não foi possível salvar">
              {extrairMensagemErro(salvarMutation.error, 'Verifique os campos e tente novamente.')}
            </Alert>
          )}
          <Input
            label="Nome"
            required
            maxLength={100}
            error={errors.nome?.message}
            {...register('nome')}
          />
          <Input
            label="Descrição"
            maxLength={500}
            error={errors.descricao?.message}
            helperText="Opcional, até 500 caracteres"
            {...register('descricao')}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Ícone" maxLength={100} error={errors.icone?.message} {...register('icone')} />
            <Input label="Cor" maxLength={50} error={errors.cor?.message} {...register('cor')} />
          </div>
          <Input
            label="Secretaria"
            maxLength={200}
            error={errors.secretaria?.message}
            {...register('secretaria')}
          />
        </form>
      </Modal>

      {/* Confirmação de desativação com contagem de impactados (Req. 14.6) */}
      <ConfirmarDesativacaoModal
        open={confirmacaoAberta}
        nomeItem={desativando?.nome ?? ''}
        tipoItem="categoria"
        processosImpactados={impactados}
        loading={desativarMutation.isPending && confirmacaoAberta}
        erro={
          desativarMutation.isError
            ? extrairMensagemErro(desativarMutation.error, 'Erro ao desativar.')
            : undefined
        }
        onConfirmar={confirmarDesativacao}
        onCancelar={cancelarDesativacao}
      />
    </section>
  );
}

export default CategoriasPage;
