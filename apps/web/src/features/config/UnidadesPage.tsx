import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ModoAtribuicao, type Unidade } from '@auditar/shared';
import { Alert, Badge, Button, Input, Modal, Select, Spinner } from '@/components/ui';
import type { SelectOption } from '@/components/ui';
import {
  configQueryKeys,
  criarUnidade,
  desativarUnidade,
  editarUnidade,
  extrairCampoErro,
  extrairMensagemErro,
  listarUnidades,
  type UnidadeFormPayload,
} from './config.api';
import { ConfirmarDesativacaoModal } from './ConfirmarDesativacaoModal';

/**
 * Página de configuração de Unidades (Painel Administrativo).
 *
 * Tabela de Unidades (nome, secretaria, modo de atribuição, status), criação e
 * edição via modal e desativação com confirmação de Processos impactados.
 *
 * Validação espelhada do backend (`criarUnidadeSchema` — Req. 14.5):
 *  - nome: obrigatório, ≤100; secretaria: obrigatória; gestorId: obrigatório;
 *  - endereco: opcional, ≤300; telefone: opcional, 10–11 dígitos numéricos;
 *  - horarioFuncionamento: opcional; modoAtribuicao: opcional (default manual).
 *
 * _Requirements: 14.5, 14.6, 14.7_
 */

const APENAS_DIGITOS = /^\d{10,11}$/;

const unidadeFormSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Nome é obrigatório')
    .max(100, 'Nome deve conter no máximo 100 caracteres'),
  secretaria: z.string().trim().min(1, 'Secretaria é obrigatória'),
  gestorId: z.string().trim().min(1, 'Gestor responsável é obrigatório'),
  endereco: z
    .string()
    .trim()
    .max(300, 'Endereço deve conter no máximo 300 caracteres')
    .optional(),
  telefone: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || APENAS_DIGITOS.test(v), {
      message: 'Telefone deve conter 10 a 11 dígitos numéricos (com DDD)',
    }),
  horarioFuncionamento: z.string().trim().optional(),
  modoAtribuicao: z.nativeEnum(ModoAtribuicao),
});

type UnidadeFormValues = z.infer<typeof unidadeFormSchema>;

const FORM_VAZIO: UnidadeFormValues = {
  nome: '',
  secretaria: '',
  gestorId: '',
  endereco: '',
  telefone: '',
  horarioFuncionamento: '',
  modoAtribuicao: ModoAtribuicao.MANUAL,
};

/** Rótulos amigáveis para cada modo de atribuição. */
const MODO_LABEL: Record<ModoAtribuicao, string> = {
  [ModoAtribuicao.AUTOMATICO]: 'Automático (menor carga)',
  [ModoAtribuicao.MANUAL]: 'Manual',
  [ModoAtribuicao.FILA_GERAL]: 'Fila geral',
};

const MODO_OPTIONS: SelectOption[] = Object.values(ModoAtribuicao).map((modo) => ({
  value: modo,
  label: MODO_LABEL[modo],
}));

function montarPayload(values: UnidadeFormValues): UnidadeFormPayload {
  const limpar = (v?: string): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  return {
    nome: values.nome.trim(),
    secretaria: values.secretaria.trim(),
    gestorId: values.gestorId.trim(),
    endereco: limpar(values.endereco),
    telefone: limpar(values.telefone),
    horarioFuncionamento: limpar(values.horarioFuncionamento),
    modoAtribuicao: values.modoAtribuicao,
  };
}

export function UnidadesPage() {
  const queryClient = useQueryClient();

  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Unidade | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: 'success' | 'danger'; msg: string } | null>(
    null,
  );

  const [desativando, setDesativando] = useState<Unidade | null>(null);
  const [impactados, setImpactados] = useState(0);
  const [confirmacaoAberta, setConfirmacaoAberta] = useState(false);

  const listaQuery = useQuery({
    queryKey: configQueryKeys.unidades,
    queryFn: listarUnidades,
  });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UnidadeFormValues>({
    resolver: zodResolver(unidadeFormSchema),
    mode: 'onBlur',
    defaultValues: FORM_VAZIO,
  });

  useEffect(() => {
    if (modalAberto) {
      reset(
        editando
          ? {
              nome: editando.nome,
              secretaria: editando.secretaria,
              gestorId: editando.gestorId ?? '',
              endereco: editando.endereco ?? '',
              telefone: editando.telefone ?? '',
              horarioFuncionamento: editando.horarioFuncionamento ?? '',
              modoAtribuicao:
                (editando.modoAtribuicao as ModoAtribuicao) ?? ModoAtribuicao.MANUAL,
            }
          : FORM_VAZIO,
      );
    }
  }, [modalAberto, editando, reset]);

  const salvarMutation = useMutation({
    mutationFn: (values: UnidadeFormValues) => {
      const payload = montarPayload(values);
      return editando ? editarUnidade(editando.id, payload) : criarUnidade(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: configQueryKeys.unidades });
      setFeedback({
        tipo: 'success',
        msg: editando ? 'Unidade atualizada com sucesso.' : 'Unidade criada com sucesso.',
      });
      fecharModal();
    },
    onError: (err) => {
      const campo = extrairCampoErro(err);
      const mensagem = extrairMensagemErro(err, 'Não foi possível salvar a unidade.');
      if (
        campo === 'nome' ||
        campo === 'secretaria' ||
        campo === 'gestorId' ||
        campo === 'telefone' ||
        campo === 'endereco'
      ) {
        setError(campo, { type: 'server', message: mensagem });
      }
    },
  });

  const desativarMutation = useMutation({
    mutationFn: ({ id, confirmar }: { id: string; confirmar: boolean }) =>
      desativarUnidade(id, confirmar),
    onSuccess: (resultado, variaveis) => {
      if (resultado.precisaConfirmacao) {
        setImpactados(resultado.processosImpactados);
        setConfirmacaoAberta(true);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: configQueryKeys.unidades });
      setFeedback({ tipo: 'success', msg: 'Unidade desativada com sucesso.' });
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

  function abrirEditar(unidade: Unidade) {
    setEditando(unidade);
    setModalAberto(true);
    salvarMutation.reset();
  }

  function fecharModal() {
    setModalAberto(false);
    setEditando(null);
  }

  function iniciarDesativacao(unidade: Unidade) {
    setFeedback(null);
    setDesativando(unidade);
    desativarMutation.mutate({ id: unidade.id, confirmar: false });
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

  const unidades = listaQuery.data ?? [];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold text-text-primary">Unidades</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Cadastre as unidades atendentes e o modo de atribuição de processos.
          </p>
        </div>
        <Button onClick={abrirCriar}>Nova unidade</Button>
      </header>

      {feedback && (
        <Alert variant={feedback.tipo} title={feedback.tipo === 'success' ? 'Sucesso' : 'Erro'}>
          {feedback.msg}
        </Alert>
      )}

      {listaQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando unidades..." />
        </div>
      ) : listaQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar as unidades">
          Tente novamente em instantes.
        </Alert>
      ) : unidades.length === 0 ? (
        <Alert variant="info" title="Nenhuma unidade cadastrada">
          Clique em &ldquo;Nova unidade&rdquo; para começar.
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-card border border-bg-alt">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-bg-alt text-text-secondary">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Nome</th>
                <th scope="col" className="px-4 py-3 font-medium">Secretaria</th>
                <th scope="col" className="px-4 py-3 font-medium">Atribuição</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {unidades.map((unidade) => (
                <tr key={unidade.id} className="border-t border-bg-alt">
                  <td className="px-4 py-3 text-text-primary">{unidade.nome}</td>
                  <td className="px-4 py-3 text-text-secondary">{unidade.secretaria}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {MODO_LABEL[unidade.modoAtribuicao as ModoAtribuicao] ??
                      unidade.modoAtribuicao}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={unidade.ativa ? 'green' : 'neutral'}>
                      {unidade.ativa ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => abrirEditar(unidade)}>
                        Editar
                      </Button>
                      {unidade.ativa && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => iniciarDesativacao(unidade)}
                          loading={
                            desativarMutation.isPending &&
                            desativando?.id === unidade.id &&
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
        title={editando ? 'Editar unidade' : 'Nova unidade'}
        footer={
          <>
            <Button variant="secondary" onClick={fecharModal} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" form="unidade-form" loading={salvarMutation.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <form
          id="unidade-form"
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
            <Input
              label="Secretaria"
              required
              error={errors.secretaria?.message}
              {...register('secretaria')}
            />
            <Input
              label="Gestor responsável"
              required
              error={errors.gestorId?.message}
              helperText="Identificador do servidor gestor"
              {...register('gestorId')}
            />
          </div>
          <Input
            label="Endereço"
            maxLength={300}
            error={errors.endereco?.message}
            helperText="Opcional, até 300 caracteres"
            {...register('endereco')}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Telefone"
              inputMode="numeric"
              error={errors.telefone?.message}
              helperText="Opcional, 10 a 11 dígitos (com DDD)"
              {...register('telefone')}
            />
            <Input
              label="Horário de funcionamento"
              error={errors.horarioFuncionamento?.message}
              helperText="Opcional"
              {...register('horarioFuncionamento')}
            />
          </div>
          <Select
            label="Modo de atribuição"
            options={MODO_OPTIONS}
            error={errors.modoAtribuicao?.message}
            {...register('modoAtribuicao')}
          />
        </form>
      </Modal>

      {/* Confirmação de desativação (Req. 14.6) */}
      <ConfirmarDesativacaoModal
        open={confirmacaoAberta}
        nomeItem={desativando?.nome ?? ''}
        tipoItem="unidade"
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

export default UnidadesPage;
