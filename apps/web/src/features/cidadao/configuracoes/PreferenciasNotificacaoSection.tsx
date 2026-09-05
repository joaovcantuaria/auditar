import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { CanalNotificacao, TipoEvento } from '@auditar/shared';
import { Alert, Button, Checkbox, Input, Spinner } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Seção "Preferências de notificação" das Configurações do Cidadão
 * (Req. 6.3, 6.4).
 *
 * Endpoints:
 *  - `GET /cidadao/conta/notificacoes/preferencias` →
 *      `{ data: { preferencias: { tipoEvento, canais }[], inicioSilencio, fimSilencio } }`
 *  - `PUT /cidadao/conta/notificacoes/preferencias` com body
 *      `{ preferencias: { tipoEvento, canais }[], inicioSilencio?, fimSilencio? }`
 *
 * O backend salva uma linha por `tipoEvento` com a lista de `canais` escolhidos
 * e replica a janela de silêncio (`inicioSilencio`/`fimSilencio`, formato
 * `HH:MM`) em todas as linhas. Persistência confirmada em ≤5s (Req. 6.3).
 *
 * Para cada tipo de evento (enum `TipoEvento`) mostramos checkboxes por canal
 * (enum `CanalNotificacao`: email/sms/painel/push) e, ao final, os campos de
 * horário de silêncio. Os canais devem ter ao menos 1 por evento salvo — o
 * backend exige `min(1)`; portanto, eventos sem canal são omitidos do payload
 * (cairão no fallback de painel do NotificaçãoWorker — Req. 6.7).
 *
 * _Requirements: 6.3, 6.4_
 */

// ---------------------------------------------------------------------------
// Tipos da resposta / payload — campos EXATOS do backend.
// ---------------------------------------------------------------------------

interface PreferenciaResumo {
  tipoEvento: string;
  canais: string[];
}

interface PreferenciasCidadao {
  preferencias: PreferenciaResumo[];
  inicioSilencio: string | null;
  fimSilencio: string | null;
}

interface PreferenciasResponse {
  data: PreferenciasCidadao;
}

interface ApiError {
  error?: string;
}

/** Query key das preferências de notificação. */
export const preferenciasQueryKey = ['cidadao', 'conta', 'preferencias'] as const;

/** Rótulos amigáveis por tipo de evento (Req. 6.1). */
const EVENTO_LABEL: Record<TipoEvento, string> = {
  [TipoEvento.CRIACAO_PROCESSO]: 'Criação de processo',
  [TipoEvento.MOVIMENTACAO_ETAPA]: 'Movimentação de etapa',
  [TipoEvento.SOLICITACAO_DOCUMENTOS]: 'Solicitação de documentos',
  [TipoEvento.APROVACAO]: 'Aprovação',
  [TipoEvento.REJEICAO]: 'Rejeição',
  [TipoEvento.NOVA_MENSAGEM]: 'Nova mensagem',
  [TipoEvento.VENCIMENTO_PRAZO]: 'Vencimento de prazo',
  [TipoEvento.ATRIBUICAO]: 'Atribuição',
};

/** Rótulos amigáveis por canal. */
const CANAL_LABEL: Record<CanalNotificacao, string> = {
  [CanalNotificacao.EMAIL]: 'E-mail',
  [CanalNotificacao.SMS]: 'SMS',
  [CanalNotificacao.PAINEL]: 'Painel',
  [CanalNotificacao.PUSH]: 'Push',
};

const TODOS_EVENTOS = Object.values(TipoEvento);
const TODOS_CANAIS = Object.values(CanalNotificacao);

/** Formato `HH:MM` (00:00..23:59) — espelha o schema do backend. */
const HORARIO_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Estado local: mapa evento → conjunto de canais selecionados. */
type CanaisPorEvento = Record<string, Set<string>>;

/** Constrói o estado inicial a partir das preferências carregadas. */
function construirEstado(preferencias: PreferenciaResumo[]): CanaisPorEvento {
  const mapa: CanaisPorEvento = {};
  for (const evento of TODOS_EVENTOS) {
    mapa[evento] = new Set<string>();
  }
  for (const pref of preferencias) {
    mapa[pref.tipoEvento] = new Set(pref.canais);
  }
  return mapa;
}

function extrairMensagemErro(err: unknown, fallback: string): string {
  if (isAxiosError<ApiError>(err)) {
    return err.response?.data?.error ?? fallback;
  }
  return fallback;
}

export function PreferenciasNotificacaoSection() {
  const queryClient = useQueryClient();

  const query = useQuery<PreferenciasResponse>({
    queryKey: preferenciasQueryKey,
    queryFn: async () => {
      const { data } = await axiosInstance.get<PreferenciasResponse>(
        '/cidadao/conta/notificacoes/preferencias',
      );
      return data;
    },
  });

  const [canaisPorEvento, setCanaisPorEvento] = useState<CanaisPorEvento>(() =>
    construirEstado([]),
  );
  const [inicioSilencio, setInicioSilencio] = useState<string>('');
  const [fimSilencio, setFimSilencio] = useState<string>('');
  const [erroHorario, setErroHorario] = useState<string | null>(null);

  // Sincroniza o estado local quando as preferências chegam do backend.
  useEffect(() => {
    const dados = query.data?.data;
    if (dados) {
      setCanaisPorEvento(construirEstado(dados.preferencias));
      setInicioSilencio(dados.inicioSilencio ?? '');
      setFimSilencio(dados.fimSilencio ?? '');
    }
  }, [query.data]);

  const mutation = useMutation<PreferenciasResponse, unknown, void>({
    mutationFn: async () => {
      const preferencias = TODOS_EVENTOS.map((tipoEvento) => ({
        tipoEvento,
        canais: Array.from(canaisPorEvento[tipoEvento] ?? []),
      })).filter((p) => p.canais.length > 0);

      const body: {
        preferencias: { tipoEvento: string; canais: string[] }[];
        inicioSilencio?: string;
        fimSilencio?: string;
      } = { preferencias };
      if (inicioSilencio) body.inicioSilencio = inicioSilencio;
      if (fimSilencio) body.fimSilencio = fimSilencio;

      const { data } = await axiosInstance.put<PreferenciasResponse>(
        '/cidadao/conta/notificacoes/preferencias',
        body,
      );
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(preferenciasQueryKey, data);
    },
  });

  const totalSelecionados = useMemo(
    () =>
      TODOS_EVENTOS.reduce((soma, evento) => soma + (canaisPorEvento[evento]?.size ?? 0), 0),
    [canaisPorEvento],
  );

  function alternarCanal(evento: string, canal: string): void {
    setCanaisPorEvento((atual) => {
      const proximo: CanaisPorEvento = { ...atual };
      const selecionados = new Set(atual[evento] ?? []);
      if (selecionados.has(canal)) {
        selecionados.delete(canal);
      } else {
        selecionados.add(canal);
      }
      proximo[evento] = selecionados;
      return proximo;
    });
  }

  function handleSalvar(): void {
    // Valida a janela de silêncio no cliente (Req. 6.4): ambos ou nenhum.
    if ((inicioSilencio && !fimSilencio) || (!inicioSilencio && fimSilencio)) {
      setErroHorario('Informe início e fim do horário de silêncio, ou deixe ambos vazios.');
      return;
    }
    if (inicioSilencio && !HORARIO_HHMM.test(inicioSilencio)) {
      setErroHorario('Horário de início inválido (use HH:MM).');
      return;
    }
    if (fimSilencio && !HORARIO_HHMM.test(fimSilencio)) {
      setErroHorario('Horário de fim inválido (use HH:MM).');
      return;
    }
    setErroHorario(null);
    mutation.mutate();
  }

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner label="Carregando preferências..." />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="danger" title="Não foi possível carregar as preferências">
        Tente novamente em instantes.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {mutation.isSuccess && (
        <Alert variant="success" title="Preferências salvas">
          Suas preferências de notificação foram atualizadas.
        </Alert>
      )}
      {mutation.isError && (
        <Alert variant="danger" title="Não foi possível salvar as preferências">
          {extrairMensagemErro(mutation.error, 'Tente novamente em instantes.')}
        </Alert>
      )}

      <p className="text-sm text-text-secondary">
        Escolha por quais canais deseja ser avisado em cada tipo de evento. Eventos sem canal
        selecionado serão entregues apenas no painel do sistema.
      </p>

      <div className="overflow-x-auto rounded-card border border-neutral">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Canais de notificação por tipo de evento</caption>
          <thead className="bg-bg-alt text-text-secondary">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Evento
              </th>
              {TODOS_CANAIS.map((canal) => (
                <th key={canal} scope="col" className="px-4 py-3 text-center font-medium">
                  {CANAL_LABEL[canal]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TODOS_EVENTOS.map((evento) => (
              <tr key={evento} className="border-t border-neutral">
                <th scope="row" className="px-4 py-3 text-left font-normal text-text-primary">
                  {EVENTO_LABEL[evento]}
                </th>
                {TODOS_CANAIS.map((canal) => {
                  const marcado = canaisPorEvento[evento]?.has(canal) ?? false;
                  return (
                    <td key={canal} className="px-4 py-3 text-center">
                      <div className="flex justify-center">
                        <Checkbox
                          label=""
                          aria-label={`${CANAL_LABEL[canal]} para ${EVENTO_LABEL[evento]}`}
                          checked={marcado}
                          onChange={() => alternarCanal(evento, canal)}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-text-primary">Horário de silêncio</legend>
        <p className="text-sm text-text-secondary">
          Notificações geradas nesse período são retidas e entregues após o término.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-md">
          <Input
            label="Início"
            type="time"
            value={inicioSilencio}
            onChange={(event) => setInicioSilencio(event.target.value)}
          />
          <Input
            label="Fim"
            type="time"
            value={fimSilencio}
            onChange={(event) => setFimSilencio(event.target.value)}
          />
        </div>
        {erroHorario && (
          <p role="alert" className="text-sm text-danger">
            {erroHorario}
          </p>
        )}
      </fieldset>

      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">
          {totalSelecionados} canal(is) selecionado(s)
        </span>
        <Button onClick={handleSalvar} loading={mutation.isPending}>
          Salvar preferências
        </Button>
      </div>
    </div>
  );
}

export default PreferenciasNotificacaoSection;
