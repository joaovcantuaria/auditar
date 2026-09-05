import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';
import { perfilQueryKey } from './PerfilPage';
import {
  AlterarEmailSection,
  AlterarSenhaSection,
  DoisFatoresSection,
  ExclusaoContaSection,
  HistoricoAcessosSection,
  PreferenciasNotificacaoSection,
} from './configuracoes';

/**
 * Página de Configurações do Cidadão (Req. 7.2–7.7, 6.3, 6.4).
 *
 * Compõe as seções independentes:
 *  - Alterar e-mail (fluxo de confirmação — `POST /cidadao/conta/alterar-email`).
 *  - Alterar senha (`POST /cidadao/conta/alterar-senha`).
 *  - Histórico dos 10 últimos acessos (`GET /cidadao/conta/acessos`).
 *  - Preferências de notificação por evento e canal + horário de silêncio
 *    (`GET`/`PUT /cidadao/conta/notificacoes/preferencias`).
 *  - Autenticação de dois fatores (estado exibido a partir do perfil; ver nota
 *    de bloqueio de backend em `DoisFatoresSection`).
 *  - Exclusão de conta (LGPD) com listagem de processos em andamento e
 *    confirmação explícita (`DELETE /cidadao/conta`).
 *
 * O perfil (`GET /cidadao/conta`) é carregado uma vez aqui para alimentar o
 * e-mail atual (seção de e-mail) e o estado do 2FA. A query compartilha a
 * `perfilQueryKey` com a `PerfilPage` para reaproveitar o cache.
 *
 * _Requirements: 6.3, 6.4, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
 */

interface PerfilCidadao {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  doisFatoresAtivo: boolean;
  doisFatoresCanal: string | null;
}

interface PerfilResponse {
  data: PerfilCidadao;
}

interface SecaoProps {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}

/** Card de seção reutilizável dentro da página de configurações. */
function Secao({ titulo, descricao, children }: SecaoProps) {
  return (
    <section className="rounded-card border border-neutral bg-white p-6">
      <header className="mb-4">
        <h2 className="font-heading text-lg font-semibold text-text-primary">{titulo}</h2>
        {descricao && <p className="mt-1 text-sm text-text-secondary">{descricao}</p>}
      </header>
      {children}
    </section>
  );
}

export function ConfiguracoesPage() {
  const perfilQuery = useQuery<PerfilResponse>({
    queryKey: perfilQueryKey,
    queryFn: async () => {
      const { data } = await axiosInstance.get<PerfilResponse>('/cidadao/conta');
      return data;
    },
  });

  const perfil = perfilQuery.data?.data;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Configurações</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Gerencie sua segurança, notificações e privacidade.
        </p>
      </header>

      <Secao
        titulo="Alterar e-mail"
        descricao="Enviaremos um link de confirmação ao novo endereço; o atual permanece ativo até você confirmar."
      >
        {perfilQuery.isLoading ? (
          <div className="flex justify-center py-4">
            <Spinner label="Carregando..." />
          </div>
        ) : (
          <AlterarEmailSection emailAtual={perfil?.email} />
        )}
      </Secao>

      <Secao titulo="Alterar senha" descricao="Informe a senha atual e escolha uma nova entre 8 e 64 caracteres.">
        <AlterarSenhaSection />
      </Secao>

      <Secao titulo="Histórico de acessos" descricao="Seus 10 acessos mais recentes.">
        <HistoricoAcessosSection />
      </Secao>

      <Secao
        titulo="Preferências de notificação"
        descricao="Escolha os canais para cada tipo de evento e configure um horário de silêncio."
      >
        <PreferenciasNotificacaoSection />
      </Secao>

      <Secao titulo="Autenticação de dois fatores (2FA)" descricao="Camada extra de segurança no login.">
        {perfilQuery.isLoading ? (
          <div className="flex justify-center py-4">
            <Spinner label="Carregando..." />
          </div>
        ) : (
          <DoisFatoresSection ativo={perfil?.doisFatoresAtivo} canal={perfil?.doisFatoresCanal} />
        )}
      </Secao>

      <Secao titulo="Excluir conta" descricao="Solicite a exclusão dos seus dados conforme a LGPD.">
        <ExclusaoContaSection />
      </Secao>
    </div>
  );
}

export default ConfiguracoesPage;
