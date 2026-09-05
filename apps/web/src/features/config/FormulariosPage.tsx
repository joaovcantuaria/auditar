import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Spinner } from '@/components/ui';
import { FormularioEditor } from './FormularioEditor';
import {
  criarFormulario,
  extrairMensagemErro,
  formulariosAdminQueryKeys,
  listarFormularios,
  listarTiposProcesso,
  listarUnidades,
  salvarFormulario,
  type CriarFormularioPayload,
  type SalvarFormularioPayload,
} from '@/features/formularios/formulariosAdmin.api';
import type { FormularioComCampos } from '@/features/formularios/formulario.types';

/**
 * Página de configuração de Formulários Dinâmicos (Painel Administrativo —
 * Task 16.3). Espelha a estrutura do `FluxosPage`: alterna entre um modo LISTA
 * (formulários por Tipo de Processo + Unidade) e um modo EDITOR (criação de um
 * novo formulário ou edição de um existente).
 *
 * O backend não expõe rota de detalhe (`GET /:id`): a listagem já traz cada
 * formulário com seus campos ordenados, então o editor recebe o formulário
 * selecionado diretamente da lista carregada. Ao salvar (POST/PUT) exibe uma
 * confirmação (Req. 16.3/16.4).
 *
 * _Requirements: 16.1, 16.2, 16.3, 16.4_
 */

type ModoEditor =
  | { tipo: 'lista' }
  | { tipo: 'novo' }
  | { tipo: 'editar'; id: string };

export function FormulariosPage() {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<ModoEditor>({ tipo: 'lista' });
  const [feedback, setFeedback] = useState<{ tipo: 'success' | 'danger'; msg: string } | null>(
    null,
  );

  const listaQuery = useQuery({
    queryKey: formulariosAdminQueryKeys.all,
    queryFn: listarFormularios,
  });

  // Catálogos de referência para o seletor de destino (modo criação).
  const tiposQuery = useQuery({
    queryKey: formulariosAdminQueryKeys.tipos,
    queryFn: listarTiposProcesso,
  });
  const unidadesQuery = useQuery({
    queryKey: formulariosAdminQueryKeys.unidades,
    queryFn: listarUnidades,
  });

  const criarMutation = useMutation({
    mutationFn: (payload: CriarFormularioPayload) => criarFormulario(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formulariosAdminQueryKeys.all });
      setFeedback({ tipo: 'success', msg: 'Formulário criado com sucesso.' });
      setModo({ tipo: 'lista' });
    },
  });

  const salvarMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SalvarFormularioPayload }) =>
      salvarFormulario(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formulariosAdminQueryKeys.all });
      setFeedback({ tipo: 'success', msg: 'Formulário salvo com sucesso.' });
      setModo({ tipo: 'lista' });
    },
  });

  const formularios = listaQuery.data ?? [];
  const tipos = tiposQuery.data ?? [];
  const unidades = unidadesQuery.data ?? [];

  const formularioEmEdicao: FormularioComCampos | null = useMemo(() => {
    if (modo.tipo !== 'editar') return null;
    return formularios.find((f) => f.id === modo.id) ?? null;
  }, [modo, formularios]);

  function abrirNovo() {
    setFeedback(null);
    criarMutation.reset();
    salvarMutation.reset();
    setModo({ tipo: 'novo' });
  }

  function abrirEditar(formulario: FormularioComCampos) {
    setFeedback(null);
    criarMutation.reset();
    salvarMutation.reset();
    setModo({ tipo: 'editar', id: formulario.id });
  }

  function cancelarEdicao() {
    criarMutation.reset();
    salvarMutation.reset();
    setModo({ tipo: 'lista' });
  }

  function nomeTipo(id: string): string {
    return tipos.find((t) => t.id === id)?.nome ?? id;
  }
  function nomeUnidade(id: string): string {
    return unidades.find((u) => u.id === id)?.nome ?? id;
  }

  const salvando = criarMutation.isPending || salvarMutation.isPending;

  // --- Modo edição/criação ------------------------------------------------
  if (modo.tipo !== 'lista') {
    const carregandoRefs = tiposQuery.isLoading || unidadesQuery.isLoading;
    const erroSalvar = criarMutation.isError
      ? extrairMensagemErro(criarMutation.error, 'Não foi possível criar o formulário.')
      : salvarMutation.isError
        ? extrairMensagemErro(salvarMutation.error, 'Não foi possível salvar o formulário.')
        : undefined;

    return (
      <section className="flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl font-semibold text-text-primary">
              {modo.tipo === 'editar' ? 'Editar formulário' : 'Novo formulário'}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {modo.tipo === 'editar'
                ? 'Configure os campos do formulário. A ordem é persistida ao salvar.'
                : 'Escolha o tipo de processo e a unidade e monte os campos do formulário.'}
            </p>
          </div>
          <Button variant="ghost" onClick={cancelarEdicao} disabled={salvando}>
            Voltar à lista
          </Button>
        </header>

        {carregandoRefs ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Carregando dados..." />
          </div>
        ) : (
          <FormularioEditor
            formulario={formularioEmEdicao}
            tiposProcesso={tipos}
            unidades={unidades}
            salvando={salvando}
            erroSalvar={erroSalvar}
            onCriar={(payload) => criarMutation.mutate(payload)}
            onSalvar={(payload) =>
              modo.tipo === 'editar' && salvarMutation.mutate({ id: modo.id, payload })
            }
            onCancelar={cancelarEdicao}
          />
        )}
      </section>
    );
  }

  // --- Modo lista ---------------------------------------------------------
  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold text-text-primary">Formulários</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Configure os formulários dinâmicos por tipo de processo e unidade.
          </p>
        </div>
        <Button onClick={abrirNovo}>Novo formulário</Button>
      </header>

      {feedback && (
        <Alert variant={feedback.tipo} title={feedback.tipo === 'success' ? 'Sucesso' : 'Erro'}>
          {feedback.msg}
        </Alert>
      )}

      {listaQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando formulários..." />
        </div>
      ) : listaQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar os formulários">
          Tente novamente em instantes.
        </Alert>
      ) : formularios.length === 0 ? (
        <Alert variant="info" title="Nenhum formulário cadastrado">
          Clique em &ldquo;Novo formulário&rdquo; para começar.
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-card border border-bg-alt">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="bg-bg-alt text-text-secondary">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Tipo de processo</th>
                <th scope="col" className="px-4 py-3 font-medium">Unidade</th>
                <th scope="col" className="px-4 py-3 font-medium">Campos</th>
                <th scope="col" className="px-4 py-3 font-medium">Situação</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {formularios.map((formulario) => (
                <tr key={formulario.id} className="border-t border-bg-alt">
                  <td className="px-4 py-3 text-text-primary">
                    {nomeTipo(formulario.tipoProcessoId)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {nomeUnidade(formulario.unidadeId)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{formulario.campos.length}</td>
                  <td className="px-4 py-3">
                    <Badge color={formulario.ativo ? 'green' : 'neutral'}>
                      {formulario.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => abrirEditar(formulario)}>
                        Editar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default FormulariosPage;
