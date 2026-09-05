import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Alert, Badge, Button, Checkbox, Input, Modal, Select, Spinner } from '@/components/ui';
import type { SelectOption } from '@/components/ui';
import {
  configQueryKeys,
  criarTipo,
  desativarTipo,
  editarTipo,
  extrairCampoErro,
  extrairMensagemErro,
  listarCategorias,
  listarFluxos,
  listarTipos,
  listarUnidades,
  type TipoFormPayload,
  type TipoProcessoComUnidades,
} from './config.api';
import { ConfirmarDesativacaoModal } from './ConfirmarDesativacaoModal';

/**
 * Página de configuração de Tipos de Processo (Painel Administrativo).
 *
 * Lista os Tipos (opcionalmente filtrados por Categoria), permite criar/editar
 * via modal e desativar com confirmação de Processos impactados. O formulário
 * inclui a seleção da Categoria, o prazo total, a seleção múltipla de Unidades
 * atendentes (obrigatória) e a referência opcional a um Fluxo.
 *
 * Validação espelhada do backend (`criarTipoSchema` — Req. 14.3):
 *  - nome: obrigatório, ≤100; categoriaId: obrigatório;
 *  - prazoTotalDiasUteis: inteiro 1–365;
 *  - unidadesIds: ao menos uma Unidade atendente; fluxoId: opcional.
 * Nome duplicado dentro da mesma Categoria (`field: 'nome'`) é exibido inline
 * no campo nome (Req. 14.4).
 *
 * _Requirements: 14.3, 14.4, 14.6, 14.7_
 */

const tipoFormSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'O nome do tipo de processo é obrigatório')
    .max(100, 'O nome deve ter no máximo 100 caracteres'),
  categoriaId: z.string().uuid('Selecione uma categoria'),
  prazoTotalDiasUteis: z
    .number({ invalid_type_error: 'O prazo total deve ser um número inteiro' })
    .int('O prazo total deve ser um número inteiro')
    .min(1, 'O prazo total deve ser no mínimo 1 dia útil')
    .max(365, 'O prazo total deve ser no máximo 365 dias úteis'),
  unidadesIds: z.array(z.string().uuid()).min(1, 'Informe ao menos uma Unidade atendente'),
  // O Select emite '' quando "Sem fluxo" é escolhido; normaliza para undefined
  // antes de validar como UUID opcional.
  fluxoId: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().uuid('Fluxo inválido').optional(),
  ),
});

type TipoFormValues = z.infer<typeof tipoFormSchema>;

const FORM_VAZIO: TipoFormValues = {
  nome: '',
  categoriaId: '',
  prazoTotalDiasUteis: 1,
  unidadesIds: [],
  fluxoId: undefined,
};

function montarPayload(values: TipoFormValues): TipoFormPayload {
  return {
    nome: values.nome.trim(),
    categoriaId: values.categoriaId,
    prazoTotalDiasUteis: values.prazoTotalDiasUteis,
    unidadesIds: values.unidadesIds,
    fluxoId: values.fluxoId || undefined,
  };
}

export function TiposProcessoPage() {
  const queryClient = useQueryClient();

  const [filtroCategoria, setFiltroCategoria] = useState<string>('');
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<TipoProcessoComUnidades | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: 'success' | 'danger'; msg: string } | null>(
    null,
  );

  const [desativando, setDesativando] = useState<TipoProcessoComUnidades | null>(null);
  const [impactados, setImpactados] = useState(0);
  const [confirmacaoAberta, setConfirmacaoAberta] = useState(false);

  // Dados de apoio: categorias, unidades e fluxos para os selects/checkboxes.
  const categoriasQuery = useQuery({
    queryKey: configQueryKeys.categorias,
    queryFn: listarCategorias,
  });
  const unidadesQuery = useQuery({
    queryKey: configQueryKeys.unidades,
    queryFn: listarUnidades,
  });
  const fluxosQuery = useQuery({
    queryKey: configQueryKeys.fluxos,
    queryFn: listarFluxos,
  });

  const tiposQuery = useQuery({
    queryKey: configQueryKeys.tipos(filtroCategoria || undefined),
    queryFn: () => listarTipos(filtroCategoria || undefined),
  });

  const categorias = categoriasQuery.data ?? [];
  const unidades = unidadesQuery.data ?? [];
  const fluxos = fluxosQuery.data ?? [];

  /** Mapa id → nome de categoria para exibir na tabela. */
  const nomeCategoriaPorId = useMemo(
    () => new Map(categorias.map((c) => [c.id, c.nome])),
    [categorias],
  );

  const categoriaOptions: SelectOption[] = useMemo(
    () => categorias.filter((c) => c.ativa).map((c) => ({ value: c.id, label: c.nome })),
    [categorias],
  );
  const filtroOptions: SelectOption[] = useMemo(
    () => categorias.map((c) => ({ value: c.id, label: c.nome })),
    [categorias],
  );
  const fluxoOptions: SelectOption[] = useMemo(
    () => fluxos.map((f) => ({ value: f.id, label: `${f.nome} (v${f.versao})` })),
    [fluxos],
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TipoFormValues>({
    resolver: zodResolver(tipoFormSchema),
    mode: 'onBlur',
    defaultValues: FORM_VAZIO,
  });

  useEffect(() => {
    if (modalAberto) {
      reset(
        editando
          ? {
              nome: editando.nome,
              categoriaId: editando.categoriaId,
              prazoTotalDiasUteis: editando.prazoTotalDiasUteis,
              unidadesIds: editando.unidades.map((u) => u.unidadeId),
              fluxoId: editando.fluxoId ?? undefined,
            }
          : { ...FORM_VAZIO, categoriaId: filtroCategoria || '' },
      );
    }
  }, [modalAberto, editando, filtroCategoria, reset]);

  const salvarMutation = useMutation({
    mutationFn: (values: TipoFormValues) => {
      const payload = montarPayload(values);
      return editando ? editarTipo(editando.id, payload) : criarTipo(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'tipos-processo'] });
      setFeedback({
        tipo: 'success',
        msg: editando ? 'Tipo de processo atualizado.' : 'Tipo de processo criado.',
      });
      fecharModal();
    },
    onError: (err) => {
      const campo = extrairCampoErro(err);
      const mensagem = extrairMensagemErro(err, 'Não foi possível salvar o tipo de processo.');
      if (
        campo === 'nome' ||
        campo === 'prazoTotalDiasUteis' ||
        campo === 'unidadesIds' ||
        campo === 'categoriaId'
      ) {
        setError(campo, { type: 'server', message: mensagem });
      }
    },
  });

  const desativarMutation = useMutation({
    mutationFn: ({ id, confirmar }: { id: string; confirmar: boolean }) =>
      desativarTipo(id, confirmar),
    onSuccess: (resultado, variaveis) => {
      if (resultado.precisaConfirmacao) {
        setImpactados(resultado.processosImpactados);
        setConfirmacaoAberta(true);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'tipos-processo'] });
      setFeedback({ tipo: 'success', msg: 'Tipo de processo desativado.' });
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

  function abrirEditar(tipo: TipoProcessoComUnidades) {
    setEditando(tipo);
    setModalAberto(true);
    salvarMutation.reset();
  }

  function fecharModal() {
    setModalAberto(false);
    setEditando(null);
  }

  function iniciarDesativacao(tipo: TipoProcessoComUnidades) {
    setFeedback(null);
    setDesativando(tipo);
    desativarMutation.mutate({ id: tipo.id, confirmar: false });
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

  const tipos = tiposQuery.data ?? [];
  const semCategorias = !categoriasQuery.isLoading && categoriaOptions.length === 0;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold text-text-primary">
            Tipos de processo
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Configure os tipos de processo, prazos e unidades atendentes.
          </p>
        </div>
        <Button onClick={abrirCriar} disabled={semCategorias}>
          Novo tipo
        </Button>
      </header>

      {semCategorias && (
        <Alert variant="warning" title="Nenhuma categoria ativa">
          Cadastre ao menos uma categoria ativa antes de criar tipos de processo.
        </Alert>
      )}

      {feedback && (
        <Alert variant={feedback.tipo} title={feedback.tipo === 'success' ? 'Sucesso' : 'Erro'}>
          {feedback.msg}
        </Alert>
      )}

      {/* Filtro por categoria */}
      <div className="max-w-xs">
        <Select
          label="Filtrar por categoria"
          placeholder="Todas as categorias"
          options={filtroOptions}
          value={filtroCategoria}
          onChange={(e) => setFiltroCategoria(e.target.value)}
        />
      </div>

      {tiposQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando tipos de processo..." />
        </div>
      ) : tiposQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar os tipos de processo">
          Tente novamente em instantes.
        </Alert>
      ) : tipos.length === 0 ? (
        <Alert variant="info" title="Nenhum tipo de processo cadastrado">
          Clique em &ldquo;Novo tipo&rdquo; para começar.
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-card border border-bg-alt">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-bg-alt text-text-secondary">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Nome</th>
                <th scope="col" className="px-4 py-3 font-medium">Categoria</th>
                <th scope="col" className="px-4 py-3 font-medium">Prazo (dias úteis)</th>
                <th scope="col" className="px-4 py-3 font-medium">Unidades</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {tipos.map((tipo) => (
                <tr key={tipo.id} className="border-t border-bg-alt">
                  <td className="px-4 py-3 text-text-primary">{tipo.nome}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {nomeCategoriaPorId.get(tipo.categoriaId) ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{tipo.prazoTotalDiasUteis}</td>
                  <td className="px-4 py-3 text-text-secondary">{tipo.unidades.length}</td>
                  <td className="px-4 py-3">
                    <Badge color={tipo.ativo ? 'green' : 'neutral'}>
                      {tipo.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => abrirEditar(tipo)}>
                        Editar
                      </Button>
                      {tipo.ativo && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => iniciarDesativacao(tipo)}
                          loading={
                            desativarMutation.isPending &&
                            desativando?.id === tipo.id &&
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
        title={editando ? 'Editar tipo de processo' : 'Novo tipo de processo'}
        footer={
          <>
            <Button variant="secondary" onClick={fecharModal} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" form="tipo-form" loading={salvarMutation.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <form
          id="tipo-form"
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => salvarMutation.mutate(values))}
          noValidate
        >
          {salvarMutation.isError && Object.keys(errors).length === 0 && (
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Categoria"
              required
              placeholder="Selecione a categoria"
              options={categoriaOptions}
              error={errors.categoriaId?.message}
              {...register('categoriaId')}
            />
            <Input
              label="Prazo total (dias úteis)"
              required
              type="number"
              min={1}
              max={365}
              error={errors.prazoTotalDiasUteis?.message}
              {...register('prazoTotalDiasUteis', { valueAsNumber: true })}
            />
          </div>

          {/* Seleção múltipla de Unidades atendentes (obrigatória) */}
          <Controller
            control={control}
            name="unidadesIds"
            render={({ field }) => (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-text-primary">
                  Unidades atendentes
                  <span className="ml-0.5 text-danger" aria-hidden="true">
                    *
                  </span>
                </legend>
                {unidadesQuery.isLoading ? (
                  <Spinner size="sm" label="Carregando unidades..." />
                ) : unidades.length === 0 ? (
                  <p className="text-sm text-text-secondary">
                    Nenhuma unidade cadastrada. Cadastre unidades primeiro.
                  </p>
                ) : (
                  <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-btn border border-neutral p-3 sm:grid-cols-2">
                    {unidades.map((unidade) => {
                      const marcada = field.value.includes(unidade.id);
                      return (
                        <Checkbox
                          key={unidade.id}
                          label={unidade.nome}
                          checked={marcada}
                          onChange={(e) => {
                            const proximo = e.target.checked
                              ? [...field.value, unidade.id]
                              : field.value.filter((id) => id !== unidade.id);
                            field.onChange(proximo);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
                {errors.unidadesIds && (
                  <p role="alert" className="text-sm text-danger">
                    {errors.unidadesIds.message}
                  </p>
                )}
              </fieldset>
            )}
          />

          <Select
            label="Fluxo associado"
            placeholder="Sem fluxo"
            options={fluxoOptions}
            error={errors.fluxoId?.message}
            helperText="Opcional — define as etapas do processo"
            {...register('fluxoId')}
          />
        </form>
      </Modal>

      {/* Confirmação de desativação (Req. 14.6) */}
      <ConfirmarDesativacaoModal
        open={confirmacaoAberta}
        nomeItem={desativando?.nome ?? ''}
        tipoItem="tipo de processo"
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

export default TiposProcessoPage;
