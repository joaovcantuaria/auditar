import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Alert, Button, Modal, Spinner } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';
import { useAuthStore } from '@/store/authStore';

/**
 * Seção "Exclusão de conta (LGPD)" das Configurações do Cidadão
 * (Req. 7.6, 7.7).
 *
 * Endpoint: `DELETE /cidadao/conta` (o axios usa baseURL `/api/v1`).
 *  - Sem `?confirmar=true`, quando há processos em andamento, o backend responde
 *    409 com `{ requerConfirmacao: true, processos: { protocolo, tipoProcesso }[] }`
 *    e NÃO registra nada — usamos essa resposta para exibir os impactos (Req. 7.7).
 *  - Com `?confirmar=true` (ou quando não há processos em andamento), responde
 *    202 com `{ message, agendadoPara, processos }` e registra a solicitação
 *    para processamento em até 15 dias úteis (Req. 7.6).
 *
 * Fluxo da UI:
 *  1. O cidadão clica em "Excluir minha conta" → abre o `Modal` de confirmação.
 *  2. Ao confirmar, fazemos uma sondagem (`confirmar=false`):
 *       - 409 → exibimos a lista de processos em andamento e pedimos confirmação
 *         explícita; um segundo clique chama `confirmar=true` (Req. 7.7).
 *       - 202 → não havia processos em andamento; a solicitação já foi registrada.
 *  3. Em caso de sucesso (202), encerramos a sessão (`logout`) e redirecionamos
 *     para `/login`.
 *
 * _Requirements: 7.6, 7.7_
 */

interface ProcessoEmAndamento {
  protocolo: string;
  tipoProcesso: string;
}

interface ExclusaoConflito {
  requerConfirmacao: true;
  processos: ProcessoEmAndamento[];
  error?: string;
}

interface ExclusaoSucesso {
  message: string;
  agendadoPara?: string;
  processos: ProcessoEmAndamento[];
}

/** Chama o endpoint de exclusão; devolve o resultado ou o conflito 409. */
async function solicitarExclusao(
  confirmar: boolean,
): Promise<{ tipo: 'sucesso'; dados: ExclusaoSucesso } | { tipo: 'conflito'; dados: ExclusaoConflito }> {
  try {
    const { data } = await axiosInstance.delete<ExclusaoSucesso>('/cidadao/conta', {
      params: confirmar ? { confirmar: 'true' } : undefined,
    });
    return { tipo: 'sucesso', dados: data };
  } catch (err) {
    if (isAxiosError<ExclusaoConflito>(err) && err.response?.status === 409) {
      return { tipo: 'conflito', dados: err.response.data };
    }
    throw err;
  }
}

/** Formata uma data ISO em `dd/mm/aaaa`; string vazia se inválida. */
function formatarData(iso?: string): string {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleDateString('pt-BR');
}

export function ExclusaoContaSection() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);

  const [modalAberto, setModalAberto] = useState(false);
  // Lista de processos em andamento devolvida pela sondagem (Req. 7.7).
  const [processos, setProcessos] = useState<ProcessoEmAndamento[] | null>(null);
  const [confirmadoExplicitamente, setConfirmadoExplicitamente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (confirmar: boolean) => solicitarExclusao(confirmar),
    onSuccess: (resultado, confirmarUsado) => {
      if (resultado.tipo === 'conflito') {
        // Há processos em andamento: exibe a lista e exige confirmação explícita.
        setProcessos(resultado.dados.processos);
        setConfirmadoExplicitamente(false);
        return;
      }
      // Sucesso (202): a solicitação foi registrada.
      // Se a sondagem inicial (confirmar=false) já registrou, ou o cidadão
      // confirmou (confirmar=true), encerramos a sessão e redirecionamos.
      void confirmarUsado;
      logout();
      navigate('/login', { replace: true });
    },
    onError: () => {
      setErro('Não foi possível processar a solicitação de exclusão. Tente novamente.');
    },
  });

  function abrirModal(): void {
    setProcessos(null);
    setConfirmadoExplicitamente(false);
    setErro(null);
    setModalAberto(true);
  }

  function fecharModal(): void {
    if (mutation.isPending) return;
    setModalAberto(false);
  }

  function iniciarExclusao(): void {
    setErro(null);
    // Primeira etapa: sondagem sem confirmar (não registra se houver processos).
    mutation.mutate(false);
  }

  function confirmarComProcessos(): void {
    setErro(null);
    setConfirmadoExplicitamente(true);
    mutation.mutate(true);
  }

  const temProcessos = processos !== null && processos.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="warning" title="Esta ação é irreversível">
        Ao solicitar a exclusão, seus dados pessoais serão anonimizados conforme a LGPD. A
        solicitação é processada em até 15 dias úteis.
      </Alert>

      <div>
        <Button variant="danger" onClick={abrirModal}>
          Excluir minha conta
        </Button>
      </div>

      <Modal
        open={modalAberto}
        onClose={fecharModal}
        title="Excluir conta"
        footer={
          <>
            <Button variant="ghost" onClick={fecharModal} disabled={mutation.isPending}>
              Cancelar
            </Button>
            {temProcessos ? (
              <Button
                variant="danger"
                onClick={confirmarComProcessos}
                loading={mutation.isPending && confirmadoExplicitamente}
              >
                Confirmar exclusão mesmo assim
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={iniciarExclusao}
                loading={mutation.isPending && !confirmadoExplicitamente}
              >
                Confirmar exclusão
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-primary">
            Você está prestes a solicitar a exclusão da sua conta. Após o processamento, não será
            possível recuperar seus dados.
          </p>

          {mutation.isPending && processos === null && (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Spinner size="sm" /> Verificando processos em andamento...
            </div>
          )}

          {temProcessos && (
            <div className="flex flex-col gap-2">
              <Alert variant="warning" title="Você possui processos em andamento">
                A exclusão afetará os processos abaixo. Confirme explicitamente para prosseguir.
              </Alert>
              <ul className="max-h-48 overflow-y-auto rounded-card border border-neutral divide-y divide-neutral">
                {processos?.map((p) => (
                  <li key={p.protocolo} className="flex justify-between gap-4 px-4 py-2 text-sm">
                    <span className="font-medium text-text-primary">{p.protocolo}</span>
                    <span className="text-text-secondary">{p.tipoProcesso}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mutation.data?.tipo === 'sucesso' && (
            <Alert variant="success" title="Solicitação registrada">
              {mutation.data.dados.message}
              {mutation.data.dados.agendadoPara && (
                <> Prazo-limite de processamento: {formatarData(mutation.data.dados.agendadoPara)}.</>
              )}
            </Alert>
          )}

          {erro && (
            <Alert variant="danger" title="Erro">
              {erro}
            </Alert>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default ExclusaoContaSection;
