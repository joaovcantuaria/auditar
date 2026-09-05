import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { queryKeys } from '@/hooks/useSocket';
import { Alert, Button, Spinner } from '@/components/ui';
import { enviarMensagem, fetchProcessoMensagens } from './api';
import { formatarDataHora } from './helpers';

/**
 * Aba Comunicação do Detalhe do Processo — canal público Cidadão ↔ Servidor
 * (Req 5.5, 5.6, 5.7, 5.9).
 *
 * - Lista as mensagens em ordem crescente usando `queryKeys.processoMensagens`,
 *   de modo que o evento de socket `processo:nova_mensagem` (que invalida essa
 *   mesma key em `useSocket`) atualize o thread em tempo real.
 * - Composer: textarea + botão Enviar. Em sucesso, invalida a query de
 *   mensagens. O texto é preservado em caso de falha (Req 5.7).
 * - Quando o Processo está encerrado, o composer é desabilitado com uma nota
 *   (o backend também bloqueia o envio — Req 13.8).
 */
export interface ComunicacaoTabProps {
  processoId: string;
  /** True quando o Processo está encerrado (aprovado/rejeitado/finalizado). */
  encerrado: boolean;
}

const MAX_CONTEUDO = 4000;

export function ComunicacaoTab({ processoId, encerrado }: ComunicacaoTabProps) {
  const queryClient = useQueryClient();
  const [conteudo, setConteudo] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.processoMensagens(processoId),
    queryFn: () => fetchProcessoMensagens(processoId),
  });

  const mutation = useMutation({
    mutationFn: (texto: string) => enviarMensagem(processoId, texto),
    onSuccess: () => {
      setConteudo('');
      void queryClient.invalidateQueries({
        queryKey: queryKeys.processoMensagens(processoId),
      });
    },
  });

  function handleEnviar() {
    const texto = conteudo.trim();
    if (!texto) return;
    mutation.mutate(texto);
  }

  const erroEnvio =
    mutation.error instanceof AxiosError
      ? ((mutation.error.response?.data as { error?: string } | undefined)?.error ??
        'Não foi possível enviar a mensagem. Tente novamente.')
      : mutation.error
        ? 'Não foi possível enviar a mensagem. Tente novamente.'
        : null;

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <Spinner label="Carregando mensagens..." />
      ) : isError ? (
        <Alert variant="danger" title="Não foi possível carregar as mensagens">
          Tente novamente em alguns instantes.
        </Alert>
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-text-secondary">Ainda não há mensagens neste processo.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {(data ?? []).map((m) => (
            <li key={m.id} className="rounded-card border border-neutral/50 p-3">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-text-primary">{m.remetente}</span>
                <span className="text-xs text-text-secondary">
                  {formatarDataHora(m.enviadaEm)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-text-primary">{m.conteudo}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {encerrado ? (
          <Alert variant="info">
            Este processo está encerrado. O envio de novas mensagens está desabilitado.
          </Alert>
        ) : (
          <>
            <label htmlFor="nova-mensagem" className="text-sm font-medium text-text-primary">
              Nova mensagem
            </label>
            <textarea
              id="nova-mensagem"
              value={conteudo}
              maxLength={MAX_CONTEUDO}
              onChange={(e) => setConteudo(e.target.value)}
              rows={3}
              disabled={mutation.isPending}
              className="w-full rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-bg-alt"
              placeholder="Escreva sua mensagem para a unidade responsável..."
            />
            {erroEnvio && (
              <Alert variant="danger">{erroEnvio}</Alert>
            )}
            <div className="flex justify-end">
              <Button
                onClick={handleEnviar}
                loading={mutation.isPending}
                disabled={conteudo.trim().length === 0}
              >
                Enviar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ComunicacaoTab;
