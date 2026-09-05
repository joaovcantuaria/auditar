import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Categoria, Unidade } from '@auditar/shared';
import { Permissao } from '@auditar/shared';
import { Alert, Button, Input, Select, Spinner } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { queryKeys } from '@/hooks/useSocket';
import {
  DynamicFormRenderer,
  useFormularioDinamico,
  toRespostas,
  valoresIniciais,
  type FormValues,
  type FormFieldValue,
} from '@/features/formularios';
import {
  listarCategorias,
  listarTiposPorCategoria,
  listarUnidades,
  wizardQueryKeys,
  extrairMensagemErro,
  type TipoProcessoComUnidades,
} from '@/features/cidadao/wizard/wizard.api';
import {
  abrirProcessoAdmin,
  buscarCidadaoPorCpf,
  extrairMensagemErro as extrairMensagemErroAdmin,
  isCidadaoNaoEncontrado,
  type AbrirProcessoResultado,
  type IdentificacaoCidadao,
} from './novo/api';

/**
 * Página de Abertura de Processo pelo Servidor (Task 28.3, Req 23).
 *
 * Fluxo:
 *  1. Busca de Cidadão por CPF (`GET /admin/cidadaos?cpf=`); em 404, exibe
 *     aviso e link para o cadastro de Servidores/Cidadãos (Req 23.2, 23.3).
 *  2. Seleção Categoria → Tipo → Unidade, reutilizando as queries de catálogo
 *     já usadas no wizard do Cidadão (Req 23.4).
 *  3. Renderização do Formulário_Dinâmico via `DynamicFormRenderer` (reuso).
 *  4. Confirmação → `POST /admin/processos` → exibe o Protocolo gerado
 *     (Req 23.5). Em falha, preserva os dados e permite nova tentativa
 *     (Req 23.7).
 *
 * Guard: só acessível com permissão `editar` (ou Administrador, que a possui
 * por padrão). Sem ela, redireciona para a listagem — reforçando o guard já
 * aplicado pela rota. O backend também exige `editar` (Req 23.1).
 *
 * _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7_
 */
export function NovoProcessoAdminPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // --- Guard de permissão (Req 23.1) --------------------------------------
  if (!hasPermission(Permissao.EDITAR)) {
    return <Navigate to="/admin/processos" replace />;
  }

  // --- Etapa 1: busca de Cidadão por CPF ----------------------------------
  const [cpfInput, setCpfInput] = useState('');
  const [buscandoCidadao, setBuscandoCidadao] = useState(false);
  const [cidadao, setCidadao] = useState<IdentificacaoCidadao | null>(null);
  const [erroCidadao, setErroCidadao] = useState<string | null>(null);
  const [cidadaoNaoEncontrado, setCidadaoNaoEncontrado] = useState(false);

  // --- Etapas 2–3: catálogo -----------------------------------------------
  const [categoriaId, setCategoriaId] = useState('');
  const [tipoProcessoId, setTipoProcessoId] = useState('');
  const [unidadeId, setUnidadeId] = useState('');

  // --- Etapa 4: formulário dinâmico ---------------------------------------
  const [values, setValues] = useState<FormValues>({});
  const [formularioValido, setFormularioValido] = useState(false);

  // --- Submissão ----------------------------------------------------------
  const [submetendo, setSubmetendo] = useState(false);
  const [erroSubmissao, setErroSubmissao] = useState<string | null>(null);
  const [resultado, setResultado] = useState<AbrirProcessoResultado | null>(null);

  async function handleBuscarCidadao(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cpf = cpfInput.trim();
    if (!cpf) return;
    setBuscandoCidadao(true);
    setErroCidadao(null);
    setCidadaoNaoEncontrado(false);
    setCidadao(null);
    try {
      const encontrado = await buscarCidadaoPorCpf(cpf);
      setCidadao(encontrado);
    } catch (err) {
      if (isCidadaoNaoEncontrado(err)) {
        setCidadaoNaoEncontrado(true);
      } else {
        setErroCidadao(extrairMensagemErroAdmin(err, 'Não foi possível buscar o cidadão.'));
      }
    } finally {
      setBuscandoCidadao(false);
    }
  }

  // --- Catálogo: Categorias -----------------------------------------------
  const categoriasQuery = useQuery<Categoria[]>({
    queryKey: wizardQueryKeys.categorias,
    queryFn: listarCategorias,
    enabled: Boolean(cidadao),
  });
  const categoriasAtivas = useMemo(
    () => (categoriasQuery.data ?? []).filter((c) => c.ativa),
    [categoriasQuery.data],
  );

  // --- Catálogo: Tipos por categoria --------------------------------------
  const tiposQuery = useQuery<TipoProcessoComUnidades[]>({
    queryKey: wizardQueryKeys.tipos(categoriaId),
    queryFn: () => listarTiposPorCategoria(categoriaId),
    enabled: Boolean(categoriaId),
  });
  const tiposAtivos = useMemo(
    () => (tiposQuery.data ?? []).filter((t) => t.ativo),
    [tiposQuery.data],
  );

  // Unidades atendentes declaradas pelo tipo selecionado (restringe o select).
  const unidadesAtendentesIds = useMemo(() => {
    const tipo = tiposAtivos.find((t) => t.id === tipoProcessoId);
    return tipo ? tipo.unidades.map((u) => u.unidadeId) : [];
  }, [tiposAtivos, tipoProcessoId]);

  // --- Catálogo: Unidades --------------------------------------------------
  const unidadesQuery = useQuery<Unidade[]>({
    queryKey: wizardQueryKeys.unidades(tipoProcessoId),
    queryFn: listarUnidades,
    enabled: Boolean(tipoProcessoId),
  });
  const unidadesDisponiveis = useMemo(() => {
    const restricao = new Set(unidadesAtendentesIds);
    return (unidadesQuery.data ?? []).filter(
      (u) => u.ativa && (restricao.size === 0 || restricao.has(u.id)),
    );
  }, [unidadesQuery.data, unidadesAtendentesIds]);

  // --- Formulário dinâmico -------------------------------------------------
  const { campos, isLoading: carregandoForm, isError: erroForm, refetch: refetchForm } =
    useFormularioDinamico({
      tipoProcessoId: tipoProcessoId || undefined,
      unidadeId: unidadeId || undefined,
    });

  // Semeia os valores iniciais quando o formulário chega e ainda não há respostas.
  const jaSemeado = useMemo(
    () => campos.length > 0 && campos.some((c) => values[c.id] !== undefined),
    [campos, values],
  );
  useEffect(() => {
    if (campos.length > 0 && !jaSemeado) {
      setValues(valoresIniciais(campos));
    }
  }, [campos, jaSemeado]);

  // --- Handlers de seleção em cascata (limpam os dependentes) --------------
  function handleCategoria(id: string) {
    setCategoriaId(id);
    setTipoProcessoId('');
    setUnidadeId('');
    setValues({});
    setFormularioValido(false);
  }

  function handleTipo(id: string) {
    setTipoProcessoId(id);
    setUnidadeId('');
    setValues({});
    setFormularioValido(false);
  }

  function handleUnidade(id: string) {
    setUnidadeId(id);
    setValues({});
    setFormularioValido(false);
  }

  const handleFormChange = (campoId: string, valor: FormFieldValue) =>
    setValues((atual) => ({ ...atual, [campoId]: valor }));

  // O formulário só é considerado válido quando carregado sem erro; sem campos
  // é válido (nada a preencher).
  const formularioPronto = Boolean(tipoProcessoId && unidadeId) && !carregandoForm && !erroForm;
  const podeConfirmar =
    Boolean(cidadao && categoriaId && tipoProcessoId && unidadeId) &&
    formularioPronto &&
    (campos.length === 0 || formularioValido) &&
    !submetendo;

  async function handleConfirmar() {
    if (!cidadao || !tipoProcessoId || !unidadeId) return;
    setSubmetendo(true);
    setErroSubmissao(null);
    try {
      const criado = await abrirProcessoAdmin({
        cidadaoId: cidadao.id,
        tipoProcessoId,
        unidadeId,
        respostas: toRespostas(campos, values),
      });
      // Atualiza a listagem administrativa de processos.
      void queryClient.invalidateQueries({ queryKey: queryKeys.processos() });
      setResultado(criado);
    } catch (err) {
      // Falha: preserva TODO o estado para nova tentativa (Req 23.7).
      setErroSubmissao(
        extrairMensagemErro(err, 'Não foi possível abrir o processo. Tente novamente.'),
      );
    } finally {
      setSubmetendo(false);
    }
  }

  // --- Tela de sucesso (Protocolo — Req 23.5) ------------------------------
  if (resultado) {
    return (
      <section className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
        <Alert variant="success" title="Processo aberto com sucesso!">
          O processo foi aberto em nome de {cidadao?.nome}. O cidadão será notificado com o
          protocolo.
        </Alert>

        <div className="flex flex-col items-center gap-2 rounded-card border border-neutral bg-white p-8 text-center">
          <span className="text-sm text-text-secondary">Protocolo</span>
          <span className="font-heading text-3xl font-semibold text-primary">
            {resultado.protocolo}
          </span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={() => navigate(`/admin/processos/${resultado.processoId}`)}>
            Ver processo
          </Button>
          <Button variant="secondary" onClick={() => navigate('/admin/processos')}>
            Voltar para Processos
          </Button>
        </div>
      </section>
    );
  }

  // --- Página --------------------------------------------------------------
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <Link to="/admin/processos" className="text-sm text-primary hover:underline">
          ← Processos
        </Link>
        <h1 className="font-heading text-h2 text-text-primary">Novo processo</h1>
        <p className="text-sm text-text-secondary">
          Abra um processo em nome de um cidadão.
        </p>
      </header>

      {/* --- Etapa 1: busca de Cidadão por CPF (Req 23.2, 23.3) ------------ */}
      <section
        aria-labelledby="cidadao-heading"
        className="flex flex-col gap-3 rounded-card border border-neutral bg-white p-4"
      >
        <h2 id="cidadao-heading" className="text-base font-semibold text-text-primary">
          1. Cidadão
        </h2>
        <form onSubmit={handleBuscarCidadao} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label="CPF do cidadão"
              placeholder="000.000.000-00"
              inputMode="numeric"
              value={cpfInput}
              onChange={(e) => setCpfInput(e.target.value)}
              disabled={buscandoCidadao}
            />
          </div>
          <Button type="submit" loading={buscandoCidadao} disabled={cpfInput.trim().length === 0}>
            Buscar
          </Button>
        </form>

        {erroCidadao && <Alert variant="danger">{erroCidadao}</Alert>}

        {cidadaoNaoEncontrado && (
          <Alert variant="warning" title="Cidadão não encontrado">
            Nenhum cidadão foi localizado com este CPF. Verifique o número informado ou cadastre
            um novo cidadão antes de abrir o processo.
          </Alert>
        )}

        {cidadao && (
          <div className="rounded-card border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-medium text-text-primary">{cidadao.nome}</p>
            <dl className="mt-1 grid grid-cols-1 gap-1 text-sm text-text-secondary sm:grid-cols-2">
              <div>
                <dt className="inline font-medium">CPF: </dt>
                <dd className="inline">{cidadao.cpfFormatado}</dd>
              </div>
              <div>
                <dt className="inline font-medium">E-mail: </dt>
                <dd className="inline">{cidadao.email}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Telefone: </dt>
                <dd className="inline">{cidadao.telefone}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      {/* --- Etapa 2–3: catálogo (Req 23.4) ------------------------------- */}
      {cidadao && (
        <section
          aria-labelledby="catalogo-heading"
          className="flex flex-col gap-4 rounded-card border border-neutral bg-white p-4"
        >
          <h2 id="catalogo-heading" className="text-base font-semibold text-text-primary">
            2. Categoria, tipo e unidade
          </h2>

          {categoriasQuery.isLoading ? (
            <Spinner label="Carregando categorias..." />
          ) : categoriasQuery.isError ? (
            <Alert variant="danger" title="Não foi possível carregar as categorias">
              {extrairMensagemErro(categoriasQuery.error, 'Tente novamente em instantes.')}
              <div className="mt-2">
                <Button variant="secondary" size="sm" onClick={() => categoriasQuery.refetch()}>
                  Tentar novamente
                </Button>
              </div>
            </Alert>
          ) : categoriasAtivas.length === 0 ? (
            <Alert variant="info">Nenhuma categoria disponível no momento.</Alert>
          ) : (
            <>
              <Select
                label="Categoria"
                placeholder="Selecione a categoria"
                value={categoriaId}
                onChange={(e) => handleCategoria(e.target.value)}
                options={categoriasAtivas.map((c) => ({ label: c.nome, value: c.id }))}
              />

              {categoriaId && (
                <Select
                  label="Tipo de processo"
                  placeholder="Selecione o tipo"
                  value={tipoProcessoId}
                  onChange={(e) => handleTipo(e.target.value)}
                  options={tiposAtivos.map((t) => ({ label: t.nome, value: t.id }))}
                  disabled={tiposQuery.isLoading}
                  helperText={
                    tiposQuery.isLoading
                      ? 'Carregando tipos...'
                      : tiposAtivos.length === 0
                        ? 'Nenhum tipo disponível nesta categoria.'
                        : undefined
                  }
                />
              )}

              {tipoProcessoId && (
                <Select
                  label="Unidade"
                  placeholder="Selecione a unidade"
                  value={unidadeId}
                  onChange={(e) => handleUnidade(e.target.value)}
                  options={unidadesDisponiveis.map((u) => ({
                    label: `${u.nome} — ${u.secretaria}`,
                    value: u.id,
                  }))}
                  disabled={unidadesQuery.isLoading}
                  helperText={
                    unidadesQuery.isLoading
                      ? 'Carregando unidades...'
                      : unidadesDisponiveis.length === 0
                        ? 'Nenhuma unidade disponível para este tipo.'
                        : undefined
                  }
                />
              )}
            </>
          )}
        </section>
      )}

      {/* --- Etapa 4: formulário dinâmico (reuso do renderer) ------------- */}
      {cidadao && tipoProcessoId && unidadeId && (
        <section
          aria-labelledby="formulario-heading"
          className="flex flex-col gap-4 rounded-card border border-neutral bg-white p-4"
        >
          <h2 id="formulario-heading" className="text-base font-semibold text-text-primary">
            3. Formulário
          </h2>

          {carregandoForm ? (
            <Spinner label="Carregando formulário..." />
          ) : erroForm ? (
            <Alert variant="danger" title="Formulário indisponível">
              Não foi possível carregar o formulário deste tipo e unidade.
              <div className="mt-2">
                <Button variant="secondary" size="sm" onClick={refetchForm}>
                  Tentar novamente
                </Button>
              </div>
            </Alert>
          ) : campos.length === 0 ? (
            <Alert variant="info">
              Este tipo de processo não requer o preenchimento de campos adicionais.
            </Alert>
          ) : (
            <DynamicFormRenderer
              campos={campos}
              value={values}
              onChange={handleFormChange}
              onValidityChange={setFormularioValido}
              disabled={submetendo}
            />
          )}
        </section>
      )}

      {/* --- Confirmação (Req 23.5, 23.7) --------------------------------- */}
      {cidadao && (
        <footer className="flex flex-col gap-3 border-t border-neutral pt-4">
          {erroSubmissao && <Alert variant="danger">{erroSubmissao}</Alert>}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => navigate('/admin/processos')}
              disabled={submetendo}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleConfirmar()} loading={submetendo} disabled={!podeConfirmar}>
              Abrir processo
            </Button>
          </div>
        </footer>
      )}
    </section>
  );
}

export default NovoProcessoAdminPage;
