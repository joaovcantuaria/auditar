import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/useSocket';
import { Alert, Button, Spinner } from '@/components/ui';
import { enviarMensagemPublica, fetchMensagensPublicas } from './api';
import { extractApiError, formatarDataHora, MAX_MENSAGEM } from './helpers';

/**
 * Aba Comunicação do Detalhe Administrativo — canal público Servidor ↔ Cidadão
 * (Task 15.2, Req 13.1, 13.3, 13.7, 13.8).
 *
 * - Lista as mensagens públicas em ordem crescente por
 *   `queryKeys.processoMensagens(id)`, a mesma key invalidada pelo evento de
 *   socket `processo:nova_mensagem` em `useSocket` — o thread atualiza em tempo
 *   real.
 * - Composer: textarea + Enviar. Em sucesso, invalida a query e limpa o
 *   campo; o texto é preservado em caso de falha. Quando a notificação ao
 *   Cidadão não pôde ser entregue (`notificacaoEntregue: false`, Req 13.7),
 *   exibe um aviso — a mensagem foi registrada mesmo assim.
 * - Quando o Processo está encerrado, o composer é desabilitado (o backend
 *   também bloqueia o envio — Req 13.8).
 */
export interface ComunicacaoTabProps {
  processoId: string;
  /** True quando o Processo está encerrado (aprovado/rejeitado/finalizado). */
  encerrado: boolean;
}

export function ComunicacaoTab({ processoId, encerrado }: ComunicacaoTabProps) {
  const queryClient = useQueryClient();
  const [conteudo, setConteudo] = useState('');
  const [avisoNotificacao, setAvisoNotificacao] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.processoMensagens(processoId),
    queryFn: () => fetchMensagensPublicas(processoId),
  });

  const mutation = useMutation({
    mutationFn: (texto: string) => enviarMensagemPublica(processoId, texto),
    onSuccess: (resultado) => {
      setConteudo('');
      setAvisoNotificacao(!resultado.notificacaoEntregue);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.processoMensagens(processoId),
      });
    },
  });

  function handleEnviar() {
    const texto = conteudo.trim();
    if (!texto) return;
    setAvisoNotificacao(false);
    mutation.mutate(texto);
  }

  const mensagens = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <Spinner label="Carregando mensagens..." />
      ) : isError ? (
        <Alert variant="danger" title="Não foi possível carregar as mensagens">
          {extractApiError(error)}
        </Alert>
      ) : mensagens.length === 0 ? (
        <p className="text-sm text-text-secondary">Ainda não há mensagens neste processo.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mensagens.map((m) => (
            <li key={m.id} className="rounded-card border border-neutral/50 bg-white p-3">
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
            <label htmlFor="admin-nova-mensagem" className="text-sm font-medium text-text-primary">
              Nova mensagem ao cidadão
            </label>
            <textarea
              id="admin-nova-mensagem"
              value={conteudo}
              maxLength={MAX_MENSAGEM}
              onChange={(e) => setConteudo(e.target.value)}
              rows={3}
              disabled={mutation.isPending}
              className="w-full rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-bg-alt"
              placeholder="Escreva uma mensagem para o cidadão..."
            />
            {mutation.isError && <Alert variant="danger">{extractApiError(mutation.error)}</Alert>}
            {avisoNotificacao && (
              <Alert variant="warning">
                A mensagem foi registrada, mas a notificação ao cidadão não pôde ser entregue (conta
                inativa ou indisponível).
              </Alert>
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
