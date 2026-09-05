import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Alert, Button, Checkbox, Input, Modal, Select, Spinner } from '@/components/ui';
import { queryKeys } from '@/hooks/useSocket';
import {
  criarTarefa,
  listarServidoresAtivos,
  type CriarTarefaPayload,
} from './tarefas.api';

/**
 * Modal de criação de Tarefa (Task 29.1, Req. 27.1, 27.2, 27.3, 27.5, 27.12).
 *
 * Campos:
 *  - Título (obrigatório, ≤150).
 *  - Descrição (opcional, ≤2000).
 *  - Prazo — data + hora via `<input type="datetime-local">`; deve ser futuro.
 *  - Prioridade (opcional: baixa/média/alta → 0/1/2).
 *  - Vínculo opcional a Processo (id do Processo, opcional).
 *  - Destinatários: "Todos os servidores" (checkbox → `todos: true`) OU seleção
 *    de servidores específicos (multi-seleção carregada de `GET /admin/servidores`).
 *
 * Validação (client-side, defesa em profundidade — o backend revalida):
 *  - Prazo obrigatório e futuro (senão bloqueia; o backend devolve `TAR_002`).
 *  - Ao menos um destinatário OU "todos" marcado (senão bloqueia; `TAR_003`).
 *
 * Ao concluir, envia `POST /admin/tarefas` e invalida as queries de tarefas.
 */

export interface CriarTarefaModalProps {
  /** Fecha o modal sem criar. */
  onClose: () => void;
  /** Chamado após a criação bem-sucedida. */
  onSuccess: () => void;
}

/** Formato de erro padronizado da API (`{ error, code, field? }`). */
interface ApiError {
  error: string;
  code: string;
  field?: string;
}

function extrairMensagemErro(err: unknown): string {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as Partial<ApiError>;
    if (typeof data.error === 'string') return data.error;
  }
  if (err instanceof Error) return err.message;
  return 'Não foi possível criar a tarefa. Tente novamente.';
}

const PRIORIDADE_OPTIONS = [
  { value: '', label: 'Sem prioridade' },
  { value: '0', label: 'Baixa' },
  { value: '1', label: 'Média' },
  { value: '2', label: 'Alta' },
];

export function CriarTarefaModal({ onClose, onSuccess }: CriarTarefaModalProps) {
  const queryClient = useQueryClient();

  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [prazo, setPrazo] = useState(''); // valor do datetime-local (local time)
  const [prioridade, setPrioridade] = useState('');
  const [processoId, setProcessoId] = useState('');
  const [todos, setTodos] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const servidoresQuery = useQuery({
    queryKey: ['tarefas', 'servidores-ativos'],
    queryFn: listarServidoresAtivos,
    staleTime: 5 * 60 * 1000,
  });

  const servidores = useMemo(() => servidoresQuery.data ?? [], [servidoresQuery.data]);

  const mutation = useMutation({
    mutationFn: (payload: CriarTarefaPayload) => criarTarefa(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tarefas() });
      onSuccess();
    },
    onError: (err) => setErroGeral(extrairMensagemErro(err)),
  });

  function alternarServidor(id: string): void {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Valida os campos e retorna os erros por campo (vazio = válido). */
  function validar(): Record<string, string> {
    const e: Record<string, string> = {};

    const tituloTrim = titulo.trim();
    if (!tituloTrim) e.titulo = 'Título é obrigatório';
    else if (tituloTrim.length > 150) e.titulo = 'Título deve ter no máximo 150 caracteres';

    if (descricao.length > 2000) e.descricao = 'Descrição deve ter no máximo 2000 caracteres';

    if (!prazo) {
      e.prazo = 'Prazo (data e hora) é obrigatório';
    } else {
      const data = new Date(prazo);
      if (Number.isNaN(data.getTime())) e.prazo = 'Prazo inválido';
      else if (data.getTime() <= Date.now())
        e.prazo = 'O prazo deve ser uma data e horário futuros';
    }

    if (!todos && selecionados.size === 0) {
      e.destinatarios = 'Selecione ao menos um destinatário ou marque "Todos os servidores"';
    }

    return e;
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    setErroGeral(null);
    const e = validar();
    setErros(e);
    if (Object.keys(e).length > 0) return;

    const payload: CriarTarefaPayload = {
      titulo: titulo.trim(),
      // O input datetime-local devolve horário local; ISO normaliza para UTC.
      prazo: new Date(prazo).toISOString(),
    };
    if (descricao.trim()) payload.descricao = descricao.trim();
    if (prioridade !== '') payload.prioridade = Number(prioridade);
    if (processoId.trim()) payload.processoId = processoId.trim();
    if (todos) payload.todos = true;
    else payload.destinatarios = [...selecionados];

    mutation.mutate(payload);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nova Tarefa"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="form-criar-tarefa" loading={mutation.isPending}>
            Criar tarefa
          </Button>
        </>
      }
    >
      <form id="form-criar-tarefa" className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {erroGeral && (
          <Alert variant="danger" title="Não foi possível criar">
            {erroGeral}
          </Alert>
        )}

        <Input
          label="Título"
          required
          maxLength={150}
          value={titulo}
          error={erros.titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="tarefa-descricao" className="text-sm font-medium text-text-primary">
            Descrição
          </label>
          <textarea
            id="tarefa-descricao"
            rows={3}
            maxLength={2000}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="w-full rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {erros.descricao && (
            <p role="alert" className="text-sm text-danger">
              {erros.descricao}
            </p>
          )}
        </div>

        <Input
          label="Prazo (data e hora)"
          type="datetime-local"
          required
          value={prazo}
          error={erros.prazo}
          onChange={(e) => setPrazo(e.target.value)}
        />

        <Select
          label="Prioridade"
          options={PRIORIDADE_OPTIONS}
          value={prioridade}
          onChange={(e) => setPrioridade(e.target.value)}
        />

        <Input
          label="Vincular a um processo (opcional)"
          placeholder="ID do processo"
          helperText="Informe o identificador do processo para vincular esta tarefa."
          value={processoId}
          onChange={(e) => setProcessoId(e.target.value)}
        />

        {/* Destinatários (Req. 27.3, 27.4) */}
        <fieldset className="flex flex-col gap-3 rounded-card border border-neutral/30 p-3">
          <legend className="px-1 text-sm font-medium text-text-primary">Destinatários</legend>

          <Checkbox
            label="Todos os servidores"
            checked={todos}
            onChange={(e) => setTodos(e.target.checked)}
            helperText="Cria uma atribuição para cada servidor ativo no momento da criação."
          />

          {!todos && (
            <div className="flex flex-col gap-2">
              {servidoresQuery.isLoading ? (
                <div className="flex items-center gap-2 text-text-secondary">
                  <Spinner size="sm" /> Carregando servidores…
                </div>
              ) : servidoresQuery.isError ? (
                <Alert variant="danger">
                  Não foi possível carregar os servidores. Tente novamente.
                </Alert>
              ) : servidores.length === 0 ? (
                <Alert variant="info">Nenhum servidor ativo disponível.</Alert>
              ) : (
                <div
                  className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-btn border border-neutral/30 p-2"
                  role="group"
                  aria-label="Selecione os servidores destinatários"
                >
                  {servidores.map((s) => (
                    <Checkbox
                      key={s.id}
                      label={s.nome}
                      checked={selecionados.has(s.id)}
                      onChange={() => alternarServidor(s.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {erros.destinatarios && (
            <p role="alert" className="text-sm text-danger">
              {erros.destinatarios}
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

export default CriarTarefaModal;
