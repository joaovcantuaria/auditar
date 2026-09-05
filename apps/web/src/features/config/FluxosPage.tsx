import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calcularPrazoTotalFluxo } from '@auditar/shared';
import { Alert, Badge, Button, Spinner } from '@/components/ui';
import { FluxoEditor } from './FluxoEditor';
import {
  configQueryKeys,
  criarFluxo,
  extrairMensagemErro,
  listarFluxos,
  obterFluxo,
  salvarFluxo,
  type FluxoComEtapas,
  type FluxoDetalhe,
  type FluxoFormPayload,
} from './config.api';

/**
 * Página de configuração de Fluxos (Painel Administrativo — Task 16.2).
 *
 * Lista os Fluxos cadastrados (nome, versão, número de etapas e prazo total
 * estimado) e permite:
 *  - criar um novo Fluxo pelo editor visual (`FluxoEditor`);
 *  - editar um Fluxo existente — o backend cria uma NOVA versão ao salvar
 *    (Req. 15.4), preservando a anterior para os Processos já vinculados.
 *
 * Ao salvar com sucesso, exibe uma confirmação com data/hora retornada pelo
 * backend (Req. 15.8). A auditoria do salvamento é registrada no servidor.
 *
 * _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_
 */

type ModoEditor =
  | { tipo: 'lista' }
  | { tipo: 'novo' }
  | { tipo: 'editar'; id: string };

function formatarDataHora(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return data.toLocaleString('pt-BR');
}

export function FluxosPage() {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<ModoEditor>({ tipo: 'lista' });
  const [feedback, setFeedback] = useState<{ tipo: 'success' | 'danger'; msg: string } | null>(
    null,
  );

  const listaQuery = useQuery({
    queryKey: configQueryKeys.fluxos,
    queryFn: listarFluxos,
  });

  // Detalhe do Fluxo em edição (carregado apenas no modo "editar").
  const detalheQuery = useQuery({
    queryKey: modo.tipo === 'editar' ? configQueryKeys.fluxo(modo.id) : ['fluxo', 'nenhum'],
    queryFn: () => obterFluxo((modo as { id: string }).id),
    enabled: modo.tipo === 'editar',
  });

  const salvarMutation = useMutation({
    mutationFn: (payload: FluxoFormPayload) => {
      if (modo.tipo === 'editar') {
        return salvarFluxo(modo.id, payload);
      }
      return criarFluxo(payload);
    },
    onSuccess: (resposta) => {
      void queryClient.invalidateQueries({ queryKey: configQueryKeys.fluxos });
      const acao = modo.tipo === 'editar' ? 'salvo como nova versão' : 'criado';
      setFeedback({
        tipo: 'success',
        msg: `Fluxo "${resposta.fluxo.nome}" (versão ${resposta.fluxo.versao}) ${acao} em ${formatarDataHora(
          resposta.salvoEm,
        )}. Prazo total: ${resposta.prazoTotalDiasUteis} dias úteis.`,
      });
      setModo({ tipo: 'lista' });
    },
  });

  function abrirNovo() {
    setFeedback(null);
    salvarMutation.reset();
    setModo({ tipo: 'novo' });
  }

  function abrirEditar(fluxo: FluxoComEtapas) {
    setFeedback(null);
    salvarMutation.reset();
    setModo({ tipo: 'editar', id: fluxo.id });
  }

  function cancelarEdicao() {
    salvarMutation.reset();
    setModo({ tipo: 'lista' });
  }

  const fluxos = listaQuery.data ?? [];

  // --- Modo edição/criação ------------------------------------------------
  if (modo.tipo !== 'lista') {
    const carregandoDetalhe = modo.tipo === 'editar' && detalheQuery.isLoading;
    const erroDetalhe = modo.tipo === 'editar' && detalheQuery.isError;
    const fluxoDetalhe: FluxoDetalhe | null =
      modo.tipo === 'editar' ? detalheQuery.data ?? null : null;

    return (
      <section className="flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl font-semibold text-text-primary">
              {modo.tipo === 'editar' ? 'Editar fluxo' : 'Novo fluxo'}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {modo.tipo === 'editar'
                ? 'Salvar cria uma nova versão do fluxo; processos existentes continuam na versão anterior.'
                : 'Monte as etapas do fluxo e defina os prazos.'}
            </p>
          </div>
          <Button variant="ghost" onClick={cancelarEdicao} disabled={salvarMutation.isPending}>
            Voltar à lista
          </Button>
        </header>

        {carregandoDetalhe ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Carregando fluxo..." />
          </div>
        ) : erroDetalhe ? (
          <Alert variant="danger" title="Não foi possível carregar o fluxo">
            Tente novamente em instantes.
          </Alert>
        ) : (
          <FluxoEditor
            fluxo={fluxoDetalhe}
            salvando={salvarMutation.isPending}
            erroSalvar={
              salvarMutation.isError
                ? extrairMensagemErro(salvarMutation.error, 'Não foi possível salvar o fluxo.')
                : undefined
            }
            onSalvar={(payload) => salvarMutation.mutate(payload)}
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
          <h2 className="font-heading text-xl font-semibold text-text-primary">Fluxos</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Configure os fluxos de tramitação e suas etapas.
          </p>
        </div>
        <Button onClick={abrirNovo}>Novo fluxo</Button>
      </header>

      {feedback && (
        <Alert variant={feedback.tipo} title={feedback.tipo === 'success' ? 'Sucesso' : 'Erro'}>
          {feedback.msg}
        </Alert>
      )}

      {listaQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando fluxos..." />
        </div>
      ) : listaQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar os fluxos">
          Tente novamente em instantes.
        </Alert>
      ) : fluxos.length === 0 ? (
        <Alert variant="info" title="Nenhum fluxo cadastrado">
          Clique em &ldquo;Novo fluxo&rdquo; para começar.
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-card border border-bg-alt">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="bg-bg-alt text-text-secondary">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Nome</th>
                <th scope="col" className="px-4 py-3 font-medium">Versão</th>
                <th scope="col" className="px-4 py-3 font-medium">Etapas</th>
                <th scope="col" className="px-4 py-3 font-medium">Prazo total</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {fluxos.map((fluxo) => {
                const prazoTotal = calcularPrazoTotalFluxo(fluxo.etapas);
                return (
                  <tr key={fluxo.id} className="border-t border-bg-alt">
                    <td className="px-4 py-3 text-text-primary">{fluxo.nome}</td>
                    <td className="px-4 py-3">
                      <Badge color="blue">v{fluxo.versao}</Badge>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{fluxo.etapas.length}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {prazoTotal} {prazoTotal === 1 ? 'dia útil' : 'dias úteis'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => abrirEditar(fluxo)}>
                          Editar
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default FluxosPage;
