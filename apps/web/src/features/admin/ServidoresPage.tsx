import { useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AxiosError } from 'axios';
import { NivelAcesso, Permissao, type PaginatedResult } from '@auditar/shared';
import {
  Alert,
  Badge,
  Button,
  Input,
  Modal,
  Pagination,
  Select,
  Spinner,
} from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';
import { useAuthStore } from '@/store/authStore';
import {
  MatrizPermissoes,
  PERMISSOES_ORDEM,
  defaultsDoNivel,
} from './components/MatrizPermissoes';

/**
 * Página de Gestão de Servidores do Painel Administrativo (tarefa 17.1).
 *
 * Apenas o Administrador (permissão `GERENCIAR_USUARIOS`) alcança esta página —
 * a rota é protegida no `router` e o backend reforça a permissão em todas as
 * rotas do módulo.
 *
 * Requisitos:
 * - 21.1 Cadastro com campos obrigatórios (nome, CPF, email, nível, Unidade).
 * - 21.2 Unicidade de CPF (erro mapeado ao campo `cpf`).
 * - 21.3/21.4 Senha temporária gerada e ENVIADA POR EMAIL — a API não retorna a
 *   senha no corpo; expõe apenas `senhaEnviada` + `mensagem`. Exibimos a
 *   confirmação de envio (ou o aviso para reenviar quando o email falhar).
 * - 21.5 Edição de campos (CPF imutável — exibido somente leitura).
 * - 21.6/21.7/21.8 Desativação com reatribuição obrigatória dos Processos em
 *   andamento (o backend rejeita listando os protocolos pendentes) e
 *   encerramento das sessões ativas do Servidor.
 * - 21.9 Limite de 3 Administradores ativos (erro mapeado a `nivelAcesso`).
 * - 8.6 Permissões granulares (checkboxes) editáveis por Servidor.
 *
 * Contratos do backend (lidos de `servidores.router.ts` +
 * `servidores.controller.ts` + `servidores.schema.ts` + `servidores.service.ts`,
 * baseURL `/api/v1`):
 * - `GET  /admin/servidores` → `PaginatedResult<ServidorItem>`
 *   query: `page`, `pageSize`, `nivel`, `unidadeId`, `ativo`.
 * - `POST /admin/servidores` body `{ nome, cpf, email, telefone?, nivelAcesso, unidadeId }`
 *   → `{ servidor, senhaEnviada, mensagem }` (HTTP 201).
 * - `GET  /admin/servidores/:id` → `ServidorItem & { permissoes: PermissaoItem[] }`.
 * - `PATCH /admin/servidores/:id` body `{ nome?, email?, telefone?, nivelAcesso?, unidadeId? }`
 *   (schema `.strict()` — NÃO aceita `cpf`).
 * - `POST /admin/servidores/:id/desativar` body `{ reatribuicoes: { processoId, novoServidorId }[] }`
 *   → `{ id, ativo, reatribuidos }`; 400 quando faltam reatribuições.
 * - `PUT  /admin/servidores/:id/permissoes` body `{ permissoes: { permissao, concedida }[] }`
 *   → `{ permissoes }`.
 * - Unidades: `GET /admin/config/unidades` → `{ data: UnidadeItem[] }`.
 */

/** Tamanho de página fixo da listagem de Servidores. */
const PAGE_SIZE = 20;

/** Servidor retornado pela API (nunca inclui `senhaHash`). */
interface ServidorItem {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string | null;
  nivelAcesso: number;
  ativo: boolean;
  senhaTemporaria: boolean;
  unidadeId: string;
  criadoEm: string;
  atualizadoEm: string;
}

/** Permissão granular retornada por `GET /admin/servidores/:id`. */
interface PermissaoItem {
  permissao: Permissao;
  concedida: boolean;
}

/** Servidor detalhado (com permissões granulares). */
interface ServidorDetalhe extends ServidorItem {
  permissoes: PermissaoItem[];
}

/** Unidade retornada por `GET /admin/config/unidades`. */
interface UnidadeItem {
  id: string;
  nome: string;
  ativa: boolean;
}

/** Resposta de criação de Servidor. */
interface CriarServidorResponse {
  servidor: ServidorItem;
  senhaEnviada: boolean;
  mensagem: string;
}

/** Formato de erro padronizado da API (`{ error, code, field? }`). */
interface ApiError {
  error: string;
  code: string;
  field?: string;
}

/** Rótulos legíveis por nível de acesso (Req. 21.1). */
const NIVEL_LABEL: Record<number, string> = {
  [NivelAcesso.ADMINISTRADOR]: 'Administrador',
  [NivelAcesso.GESTOR_GERAL]: 'Gestor Geral',
  [NivelAcesso.GESTOR_CATEGORIA]: 'Gestor de Categoria',
  [NivelAcesso.GESTOR_UNIDADE]: 'Gestor de Unidade',
  [NivelAcesso.ANALISTA]: 'Analista',
  [NivelAcesso.INSPETOR]: 'Inspetor',
  [NivelAcesso.VISUALIZADOR]: 'Visualizador',
};

/** Opções do Select de nível de acesso, na ordem dos níveis (1..7). */
const NIVEL_OPTIONS = Object.values(NivelAcesso)
  .filter((v): v is number => typeof v === 'number')
  .sort((a, b) => a - b)
  .map((v) => ({ value: v, label: NIVEL_LABEL[v] }));

/** Extrai a mensagem de erro da API de forma segura, com fallback amigável. */
function extractApiError(err: unknown): string {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as Partial<ApiError>;
    if (typeof data.error === 'string') return data.error;
  }
  if (err instanceof Error) return err.message;
  return 'Não foi possível concluir a solicitação. Tente novamente.';
}

/** Extrai o campo (`field`) associado ao erro da API, quando houver. */
function extractApiField(err: unknown): string | undefined {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as Partial<ApiError>;
    if (typeof data.field === 'string') return data.field;
  }
  return undefined;
}

/** Formata um CPF de 11 dígitos como `000.000.000-00` para exibição. */
function formatarCpf(cpf: string): string {
  if (!/^\d{11}$/.test(cpf)) return cpf;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

// ---------------------------------------------------------------------------
// Schemas de formulário (react-hook-form + zod) — espelham os schemas Zod da API
// ---------------------------------------------------------------------------

const cpfRegex = /^\d{11}$/;
const telefoneRegex = /^\d{10,11}$/;

const criarSchema = z.object({
  nome: z.string().trim().min(1, 'Nome completo é obrigatório').max(150, 'Máximo 150 caracteres'),
  cpf: z.string().trim().regex(cpfRegex, 'CPF deve conter 11 dígitos numéricos'),
  email: z.string().trim().max(254, 'Máximo 254 caracteres').email('Email institucional inválido'),
  telefone: z
    .string()
    .trim()
    .regex(telefoneRegex, 'Telefone deve conter 10 a 11 dígitos (com DDD)')
    .optional()
    .or(z.literal('')),
  nivelAcesso: z.coerce
    .number({ invalid_type_error: 'Selecione um nível de acesso' })
    .int()
    .min(1, 'Selecione um nível de acesso')
    .max(7, 'Nível de acesso inválido'),
  unidadeId: z.string().trim().min(1, 'Unidade de lotação é obrigatória'),
});

type CriarFormValues = z.infer<typeof criarSchema>;

const editarSchema = z.object({
  nome: z.string().trim().min(1, 'Nome completo é obrigatório').max(150, 'Máximo 150 caracteres'),
  email: z.string().trim().max(254, 'Máximo 254 caracteres').email('Email institucional inválido'),
  telefone: z
    .string()
    .trim()
    .regex(telefoneRegex, 'Telefone deve conter 10 a 11 dígitos (com DDD)')
    .optional()
    .or(z.literal('')),
  nivelAcesso: z.coerce.number().int().min(1).max(7),
  unidadeId: z.string().trim().min(1, 'Unidade de lotação é obrigatória'),
});

type EditarFormValues = z.infer<typeof editarSchema>;

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export function ServidoresPage() {
  const queryClient = useQueryClient();

  // Edição da matriz de permissões só é permitida a quem tem
  // `gerenciar_usuarios` ou é Administrador (Req. 21.10).
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const podeGerenciarPermissoes =
    hasPermission(Permissao.GERENCIAR_USUARIOS) ||
    user?.nivel === NivelAcesso.ADMINISTRADOR;

  const [page, setPage] = useState(1);
  const [filtroNivel, setFiltroNivel] = useState<string>('');
  const [filtroAtivo, setFiltroAtivo] = useState<string>('');

  const [criarAberto, setCriarAberto] = useState(false);
  const [editarAlvo, setEditarAlvo] = useState<ServidorItem | null>(null);
  const [desativarAlvo, setDesativarAlvo] = useState<ServidorItem | null>(null);
  const [permissoesAlvo, setPermissoesAlvo] = useState<ServidorItem | null>(null);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'warning'; texto: string } | null>(
    null,
  );

  // Unidades para os Selects de lotação.
  const unidadesQuery = useQuery({
    queryKey: ['unidades', 'ativas'],
    queryFn: async () => {
      const { data } = await axiosInstance.get<{ data: UnidadeItem[] }>('/admin/config/unidades', {
        params: { ativa: true },
      });
      return data.data;
    },
  });

  const unidadeOptions = useMemo(
    () => (unidadesQuery.data ?? []).map((u) => ({ value: u.id, label: u.nome })),
    [unidadesQuery.data],
  );

  const unidadeNomePorId = useMemo(() => {
    const map = new Map<string, string>();
    (unidadesQuery.data ?? []).forEach((u) => map.set(u.id, u.nome));
    return map;
  }, [unidadesQuery.data]);

  // Lista paginada de Servidores.
  const listaQuery = useQuery({
    queryKey: ['servidores', { page, filtroNivel, filtroAtivo }],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, pageSize: PAGE_SIZE };
      if (filtroNivel) params.nivel = Number(filtroNivel);
      if (filtroAtivo) params.ativo = filtroAtivo;
      const { data } = await axiosInstance.get<PaginatedResult<ServidorItem>>('/admin/servidores', {
        params,
      });
      return data;
    },
    placeholderData: keepPreviousData,
  });

  const servidores = listaQuery.data?.data ?? [];
  const totalPages = listaQuery.data?.meta.totalPages ?? 1;

  const invalidarLista = () => {
    void queryClient.invalidateQueries({ queryKey: ['servidores'] });
  };

  return (
    <section aria-labelledby="servidores-titulo" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 id="servidores-titulo" className="font-heading text-h2 text-text-primary">
            Servidores
          </h1>
          <p className="text-sm text-text-secondary">
            Cadastre, edite, desative e gerencie as permissões dos servidores.
          </p>
        </div>
        <Button onClick={() => setCriarAberto(true)}>Novo Servidor</Button>
      </header>

      {feedback && (
        <Alert variant={feedback.variant} onClick={() => setFeedback(null)}>
          {feedback.texto}
        </Alert>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-56">
          <Select
            label="Nível de acesso"
            value={filtroNivel}
            onChange={(e) => {
              setFiltroNivel(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {NIVEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select
            label="Situação"
            value={filtroAtivo}
            onChange={(e) => {
              setFiltroAtivo(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </Select>
        </div>
      </div>

      {/* Estados de carregamento / erro / vazio */}
      {listaQuery.isLoading ? (
        <div className="flex items-center gap-2 text-text-secondary">
          <Spinner size="sm" /> Carregando servidores…
        </div>
      ) : listaQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar os servidores">
          {extractApiError(listaQuery.error)}
        </Alert>
      ) : servidores.length === 0 ? (
        <Alert variant="info">Nenhum servidor encontrado para os filtros selecionados.</Alert>
      ) : (
        <div className="overflow-x-auto rounded-card border border-bg-alt">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Lista de servidores cadastrados</caption>
            <thead>
              <tr className="bg-bg-alt text-left text-text-secondary">
                <th scope="col" className="px-4 py-3 font-medium">
                  Nome
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  CPF
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Email
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Nível de acesso
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Unidade
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Situação
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {servidores.map((s) => (
                <tr key={s.id} className="border-t border-bg-alt">
                  <td className="px-4 py-3 text-text-primary">{s.nome}</td>
                  <td className="px-4 py-3 text-text-primary">{formatarCpf(s.cpf)}</td>
                  <td className="px-4 py-3 text-text-primary">{s.email}</td>
                  <td className="px-4 py-3 text-text-primary">
                    {NIVEL_LABEL[s.nivelAcesso] ?? `Nível ${s.nivelAcesso}`}
                  </td>
                  <td className="px-4 py-3 text-text-primary">
                    {unidadeNomePorId.get(s.unidadeId) ?? s.unidadeId}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={s.ativo ? 'green' : 'neutral'}>
                      {s.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditarAlvo(s)}>
                        Editar
                      </Button>
                      {podeGerenciarPermissoes && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPermissoesAlvo(s)}
                        >
                          Permissões
                        </Button>
                      )}
                      {s.ativo && (
                        <Button size="sm" variant="danger" onClick={() => setDesativarAlvo(s)}>
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

      {totalPages > 1 && (
        <div className="flex justify-end">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* Modais */}
      {criarAberto && (
        <CriarServidorModal
          unidadeOptions={unidadeOptions}
          unidadesLoading={unidadesQuery.isLoading}
          podeEditarPermissoes={podeGerenciarPermissoes}
          onClose={() => setCriarAberto(false)}
          onSuccess={(resp) => {
            setCriarAberto(false);
            invalidarLista();
            setFeedback({
              variant: resp.senhaEnviada ? 'success' : 'warning',
              texto: resp.mensagem,
            });
          }}
        />
      )}

      {editarAlvo && (
        <EditarServidorModal
          servidor={editarAlvo}
          unidadeOptions={unidadeOptions}
          onClose={() => setEditarAlvo(null)}
          onSuccess={() => {
            setEditarAlvo(null);
            invalidarLista();
            setFeedback({ variant: 'success', texto: 'Servidor atualizado com sucesso.' });
          }}
        />
      )}

      {desativarAlvo && (
        <DesativarServidorModal
          servidor={desativarAlvo}
          onClose={() => setDesativarAlvo(null)}
          onSuccess={(reatribuidos) => {
            setDesativarAlvo(null);
            invalidarLista();
            setFeedback({
              variant: 'success',
              texto: `Servidor desativado e sessões encerradas.${
                reatribuidos > 0 ? ` ${reatribuidos} processo(s) reatribuído(s).` : ''
              }`,
            });
          }}
        />
      )}

      {permissoesAlvo && (
        <PermissoesModal
          servidor={permissoesAlvo}
          podeEditar={podeGerenciarPermissoes}
          onClose={() => setPermissoesAlvo(null)}
          onSuccess={() => {
            setPermissoesAlvo(null);
            setFeedback({ variant: 'success', texto: 'Permissões atualizadas com sucesso.' });
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Modal: Criar Servidor (Req. 21.1, 21.2, 21.3, 21.4, 21.9)
// ---------------------------------------------------------------------------

interface CriarModalProps {
  unidadeOptions: Array<{ value: string; label: string }>;
  unidadesLoading: boolean;
  /** Se o usuário logado pode editar a matriz de permissões (Req. 21.10). */
  podeEditarPermissoes: boolean;
  onClose: () => void;
  onSuccess: (resp: CriarServidorResponse) => void;
}

/**
 * Serializa um conjunto de permissões concedidas para o corpo esperado por
 * `PUT /admin/servidores/:id/permissoes`: cada uma das 14 permissões acompanha
 * seu estado (`concedida`), refletindo exatamente o subconjunto marcado.
 */
function serializarPermissoes(concedidas: Set<Permissao>): PermissaoItem[] {
  return PERMISSOES_ORDEM.map((permissao) => ({
    permissao,
    concedida: concedidas.has(permissao),
  }));
}

function CriarServidorModal({
  unidadeOptions,
  unidadesLoading,
  podeEditarPermissoes,
  onClose,
  onSuccess,
}: CriarModalProps) {
  const nivelInicial = NivelAcesso.ANALISTA;

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<CriarFormValues>({
    resolver: zodResolver(criarSchema),
    defaultValues: {
      nome: '',
      cpf: '',
      email: '',
      telefone: '',
      nivelAcesso: nivelInicial,
      unidadeId: '',
    },
  });

  const [erroGeral, setErroGeral] = useState<string | null>(null);
  // Conjunto de permissões concedidas — inicia com os defaults do nível inicial;
  // o MatrizPermissoes reaplica os defaults sempre que o nível muda (Req. 21.12).
  const [permissoes, setPermissoes] = useState<Set<Permissao>>(() =>
    defaultsDoNivel(nivelInicial),
  );

  // Nível atual selecionado no formulário (coagido para número).
  const nivelAtual = (Number(watch('nivelAcesso')) || nivelInicial) as NivelAcesso;

  const mutation = useMutation({
    mutationFn: async (values: CriarFormValues) => {
      const payload = {
        nome: values.nome,
        cpf: values.cpf,
        email: values.email,
        nivelAcesso: values.nivelAcesso,
        unidadeId: values.unidadeId,
        ...(values.telefone ? { telefone: values.telefone } : {}),
      };
      const { data } = await axiosInstance.post<CriarServidorResponse>(
        '/admin/servidores',
        payload,
      );
      // Persiste as permissões granulares marcadas para o servidor recém-criado
      // (Req. 21.13) — apenas quem pode editar envia a matriz.
      if (podeEditarPermissoes) {
        await axiosInstance.put(`/admin/servidores/${data.servidor.id}/permissoes`, {
          permissoes: serializarPermissoes(permissoes),
        });
      }
      return data;
    },
    onSuccess,
    onError: (err) => {
      const field = extractApiField(err);
      const mensagem = extractApiError(err);
      if (field && (field === 'cpf' || field === 'email' || field === 'nivelAcesso')) {
        setError(field as keyof CriarFormValues, { message: mensagem });
      } else {
        setErroGeral(mensagem);
      }
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo Servidor"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="form-criar-servidor"
            loading={mutation.isPending}
          >
            Cadastrar
          </Button>
        </>
      }
    >
      <form
        id="form-criar-servidor"
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) => {
          setErroGeral(null);
          mutation.mutate(values);
        })}
        noValidate
      >
        {erroGeral && (
          <Alert variant="danger" title="Não foi possível cadastrar">
            {erroGeral}
          </Alert>
        )}

        <Input label="Nome completo" required error={errors.nome?.message} {...register('nome')} />
        <Input
          label="CPF"
          required
          inputMode="numeric"
          maxLength={11}
          placeholder="Somente números (11 dígitos)"
          error={errors.cpf?.message}
          {...register('cpf')}
        />
        <Input
          label="Email institucional"
          type="email"
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Telefone"
          inputMode="numeric"
          maxLength={11}
          helperText="Opcional — apenas números com DDD"
          error={errors.telefone?.message}
          {...register('telefone')}
        />
        <Select
          label="Nível de acesso"
          required
          error={errors.nivelAcesso?.message}
          options={NIVEL_OPTIONS}
          {...register('nivelAcesso')}
        />
        <Select
          label="Unidade de lotação"
          required
          placeholder={unidadesLoading ? 'Carregando unidades…' : 'Selecione uma unidade'}
          error={errors.unidadeId?.message}
          options={unidadeOptions}
          disabled={unidadesLoading}
          {...register('unidadeId')}
        />

        {podeEditarPermissoes && (
          <MatrizPermissoes
            valor={permissoes}
            onChange={setPermissoes}
            nivelAcesso={nivelAtual}
          />
        )}

        <p className="text-sm text-text-secondary">
          Uma senha temporária será gerada e enviada ao email institucional. O servidor deverá
          trocá-la no primeiro acesso.
        </p>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal: Editar Servidor (Req. 21.5 — CPF imutável)
// ---------------------------------------------------------------------------

interface EditarModalProps {
  servidor: ServidorItem;
  unidadeOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
  onSuccess: () => void;
}

function EditarServidorModal({ servidor, unidadeOptions, onClose, onSuccess }: EditarModalProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditarFormValues>({
    resolver: zodResolver(editarSchema),
    defaultValues: {
      nome: servidor.nome,
      email: servidor.email,
      telefone: servidor.telefone ?? '',
      nivelAcesso: servidor.nivelAcesso,
      unidadeId: servidor.unidadeId,
    },
  });

  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (values: EditarFormValues) => {
      const payload = {
        nome: values.nome,
        email: values.email,
        nivelAcesso: values.nivelAcesso,
        unidadeId: values.unidadeId,
        ...(values.telefone ? { telefone: values.telefone } : {}),
      };
      const { data } = await axiosInstance.patch<ServidorItem>(
        `/admin/servidores/${servidor.id}`,
        payload,
      );
      return data;
    },
    onSuccess,
    onError: (err) => {
      const field = extractApiField(err);
      const mensagem = extractApiError(err);
      if (field && (field === 'email' || field === 'nivelAcesso')) {
        setError(field as keyof EditarFormValues, { message: mensagem });
      } else {
        setErroGeral(mensagem);
      }
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Editar Servidor"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="form-editar-servidor" loading={mutation.isPending}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <form
        id="form-editar-servidor"
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) => {
          setErroGeral(null);
          mutation.mutate(values);
        })}
        noValidate
      >
        {erroGeral && (
          <Alert variant="danger" title="Não foi possível salvar">
            {erroGeral}
          </Alert>
        )}

        <Input
          label="CPF"
          value={formatarCpf(servidor.cpf)}
          readOnly
          disabled
          helperText="O CPF não pode ser alterado após o cadastro."
        />
        <Input label="Nome completo" required error={errors.nome?.message} {...register('nome')} />
        <Input
          label="Email institucional"
          type="email"
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Telefone"
          inputMode="numeric"
          maxLength={11}
          helperText="Opcional — apenas números com DDD"
          error={errors.telefone?.message}
          {...register('telefone')}
        />
        <Select
          label="Nível de acesso"
          required
          error={errors.nivelAcesso?.message}
          options={NIVEL_OPTIONS}
          {...register('nivelAcesso')}
        />
        <Select
          label="Unidade de lotação"
          required
          placeholder="Selecione uma unidade"
          error={errors.unidadeId?.message}
          options={unidadeOptions}
          {...register('unidadeId')}
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal: Desativar Servidor (Req. 21.6, 21.7, 21.8)
// ---------------------------------------------------------------------------

interface DesativarModalProps {
  servidor: ServidorItem;
  onClose: () => void;
  onSuccess: (reatribuidos: number) => void;
}

function DesativarServidorModal({ servidor, onClose, onSuccess }: DesativarModalProps) {
  const [erro, setErro] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      // O backend lista os Processos em andamento pendentes de reatribuição e
      // rejeita a desativação (400) enquanto houver algum descoberto. Enviamos
      // uma lista vazia; se houver pendências, a mensagem retornada orienta o
      // Administrador a reatribuí-los primeiro.
      const { data } = await axiosInstance.post<{
        id: string;
        ativo: boolean;
        reatribuidos: number;
      }>(`/admin/servidores/${servidor.id}/desativar`, { reatribuicoes: [] });
      return data;
    },
    onSuccess: (data) => onSuccess(data.reatribuidos),
    onError: (err) => setErro(extractApiError(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Desativar Servidor"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Confirmar desativação
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {erro && (
          <Alert variant="danger" title="Não foi possível desativar">
            {erro}
          </Alert>
        )}
        <p className="text-sm text-text-primary">
          Deseja desativar <strong>{servidor.nome}</strong>? A conta será mantida para preservar o
          histórico, mas o servidor não poderá mais acessar o sistema e suas sessões ativas serão
          encerradas.
        </p>
        <p className="text-sm text-text-secondary">
          Se houver processos em andamento atribuídos a este servidor, a desativação será bloqueada
          até que eles sejam reatribuídos.
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal: Permissões granulares (Req. 8.6)
// ---------------------------------------------------------------------------

interface PermissoesModalProps {
  servidor: ServidorItem;
  /** Se o usuário logado pode editar a matriz (Req. 21.10). */
  podeEditar: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function PermissoesModal({ servidor, podeEditar, onClose, onSuccess }: PermissoesModalProps) {
  const [selecionadas, setSelecionadas] = useState<Set<Permissao> | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Carrega o detalhe do Servidor (inclui as permissões granulares atuais).
  const detalheQuery = useQuery({
    queryKey: ['servidor', servidor.id],
    queryFn: async () => {
      const { data } = await axiosInstance.get<ServidorDetalhe>(`/admin/servidores/${servidor.id}`);
      return data;
    },
  });

  // Inicializa o conjunto de permissões concedidas a partir do detalhe.
  const concedidasIniciais = useMemo(() => {
    const set = new Set<Permissao>();
    (detalheQuery.data?.permissoes ?? [])
      .filter((p) => p.concedida)
      .forEach((p) => set.add(p.permissao));
    return set;
  }, [detalheQuery.data]);

  const estado = selecionadas ?? concedidasIniciais;

  const mutation = useMutation({
    mutationFn: async () => {
      // Substitui o conjunto: enviamos cada uma das 14 permissões com o seu
      // estado atual (concedida true/false), refletindo exatamente as marcações
      // (Req. 21.13 — round-trip exato).
      const { data } = await axiosInstance.put<{ permissoes: PermissaoItem[] }>(
        `/admin/servidores/${servidor.id}/permissoes`,
        { permissoes: serializarPermissoes(estado) },
      );
      return data;
    },
    onSuccess,
    onError: (err) => setErro(extractApiError(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Permissões — ${servidor.nome}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            {podeEditar ? 'Cancelar' : 'Fechar'}
          </Button>
          {podeEditar && (
            <Button
              loading={mutation.isPending}
              disabled={detalheQuery.isLoading || detalheQuery.isError}
              onClick={() => {
                setErro(null);
                mutation.mutate();
              }}
            >
              Salvar permissões
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {erro && (
          <Alert variant="danger" title="Não foi possível salvar">
            {erro}
          </Alert>
        )}

        <p className="text-sm text-text-secondary">
          Conceda permissões granulares a este servidor. O conjunto marcado substitui
          as permissões atuais.
        </p>

        {detalheQuery.isLoading ? (
          <div className="flex items-center gap-2 text-text-secondary">
            <Spinner size="sm" /> Carregando permissões…
          </div>
        ) : detalheQuery.isError ? (
          <Alert variant="danger">{extractApiError(detalheQuery.error)}</Alert>
        ) : (
          <MatrizPermissoes
            valor={estado}
            onChange={setSelecionadas}
            nivelAcesso={servidor.nivelAcesso as NivelAcesso}
            disabled={!podeEditar}
          />
        )}
      </div>
    </Modal>
  );
}

export default ServidoresPage;
