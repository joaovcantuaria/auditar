import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { ErrorCodes } from '@auditar/shared';
import { Alert, Button, Checkbox, Input } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';
import { useAuthStore } from '@/store/authStore';

/**
 * Página de login do Cidadão (Portal do Cidadão).
 *
 * Fluxo (Req. 2.1–2.9):
 *  - Formulário CPF + senha + "Manter conectado" (react-hook-form + Zod).
 *  - Submissão via `POST /api/v1/auth/cidadao/login` (React Query `useMutation`).
 *  - Sucesso sem 2FA → grava sessão (`authStore.login`) e navega para `/processos`.
 *  - Sucesso com 2FA (`requires2fa: true`) → renderiza a etapa de código, que
 *    envia o código por `POST /api/v1/auth/cidadao/2fa/enviar` e conclui a
 *    autenticação via `POST /api/v1/auth/cidadao/2fa/verificar`.
 *
 * Erros (mensagens vindas do backend, sem revelar qual campo falhou — Req. 2.2):
 *  - `AUTH_001` (credenciais) → Alert com a mensagem genérica; CPF preservado.
 *  - `AUTH_003` (conta não ativada) → orientação + link de reenvio de ativação.
 *  - `AUTH_002` (bloqueio, HTTP 429) → mensagem do backend já traz os minutos
 *    restantes ("Tente novamente em X minuto(s).").
 *
 * O CPF é enviado ao backend apenas com dígitos (regex `^\d{11}$`); a senha tem
 * 8–128 caracteres, alinhada ao `loginCidadaoSchema` da API.
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_
 */

// --- Schema do formulário ---------------------------------------------------

/** Schema alinhado ao `loginCidadaoSchema` do backend (11 dígitos + 8–128). */
const loginSchema = z.object({
  cpf: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => /^\d{11}$/.test(value), {
      message: 'CPF deve conter 11 dígitos',
    }),
  senha: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(128, 'Senha deve ter no máximo 128 caracteres'),
  manterConectado: z.boolean(),
});

/** Entrada bruta do formulário (antes da transformação do CPF). */
type LoginFormInput = {
  cpf: string;
  senha: string;
  manterConectado: boolean;
};

/** Saída validada (CPF já normalizado para 11 dígitos). */
type LoginFormOutput = z.output<typeof loginSchema>;

// --- Tipos das respostas do backend ----------------------------------------

interface CidadaoResumo {
  id: string;
  nome: string;
}

interface LoginRequires2fa {
  requires2fa: true;
  cidadaoId: string;
}

interface LoginConcluido {
  token: string;
  cidadao: CidadaoResumo;
}

type LoginResponse = LoginRequires2fa | LoginConcluido;

interface Verificar2faResponse {
  token: string;
  cidadao: CidadaoResumo;
}

/** Estrutura padrão de erro da API (`{ error, code, field }`). */
interface ApiErrorBody {
  error: string;
  code: string;
  field?: string;
}

/** Type guard para a resposta de 2FA pendente. */
function isRequires2fa(data: LoginResponse): data is LoginRequires2fa {
  return 'requires2fa' in data && data.requires2fa === true;
}

/** Extrai a mensagem/código de erro da API a partir de um AxiosError. */
function parseApiError(error: unknown): ApiErrorBody {
  if (error instanceof AxiosError) {
    const body = error.response?.data as Partial<ApiErrorBody> | undefined;
    if (body?.error) {
      return { error: body.error, code: body.code ?? '', field: body.field };
    }
  }
  return {
    error: 'Não foi possível entrar. Tente novamente em instantes.',
    code: ErrorCodes.SERVICO_INDISPONIVEL,
  };
}

/** Rota inicial do Portal do Cidadão após autenticação. */
const CITIZEN_HOME = '/processos';

// --- Componente principal ---------------------------------------------------

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);

  /** Erro atual do login (mensagem + código, para orientar a UI). */
  const [loginError, setLoginError] = useState<ApiErrorBody | null>(null);
  /** Estado do desafio 2FA quando o backend responde `requires2fa`. */
  const [twoFactor, setTwoFactor] = useState<{ cidadaoId: string; manterConectado: boolean } | null>(
    null,
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormInput, unknown, LoginFormOutput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { cpf: '', senha: '', manterConectado: false },
  });

  /** Conclui a sessão: grava no authStore e navega ao painel do cidadão. */
  function concluirLogin(token: string, cidadao: CidadaoResumo): void {
    login(token, { sub: cidadao.id, role: 'cidadao', nome: cidadao.nome });
    navigate(CITIZEN_HOME, { replace: true });
  }

  const loginMutation = useMutation({
    mutationFn: async (values: LoginFormOutput): Promise<LoginResponse> => {
      const { data } = await axiosInstance.post<LoginResponse>('/auth/cidadao/login', {
        cpf: values.cpf,
        senha: values.senha,
        manterConectado: values.manterConectado,
      });
      return data;
    },
    onSuccess: (data, variables) => {
      setLoginError(null);
      if (isRequires2fa(data)) {
        // Etapa 2FA: dispara o envio do código e mostra o campo de verificação.
        setTwoFactor({ cidadaoId: data.cidadaoId, manterConectado: variables.manterConectado });
        return;
      }
      concluirLogin(data.token, data.cidadao);
    },
    onError: (error: unknown) => {
      setLoginError(parseApiError(error));
    },
  });

  const onSubmit = handleSubmit((values) => {
    setLoginError(null);
    loginMutation.mutate(values);
  });

  // Etapa de verificação 2FA (segundo passo).
  if (twoFactor) {
    return (
      <TwoFactorStep
        cidadaoId={twoFactor.cidadaoId}
        manterConectado={twoFactor.manterConectado}
        onVerified={concluirLogin}
        onCancel={() => {
          setTwoFactor(null);
          setLoginError(null);
        }}
      />
    );
  }

  const contaNaoAtivada = loginError?.code === ErrorCodes.ACCOUNT_NOT_ACTIVATED;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
      <header className="text-center">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Entrar</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Acesse sua conta para acompanhar seus processos.
        </p>
      </header>

      {loginError && (
        <Alert variant={contaNaoAtivada ? 'warning' : 'danger'} title={contaNaoAtivada ? 'Conta não ativada' : undefined}>
          <p>{loginError.error}</p>
          {contaNaoAtivada && (
            <p className="mt-2">
              <Link to="/ativar" className="font-medium underline">
                Reenviar e-mail de ativação
              </Link>
            </p>
          )}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="CPF"
          type="text"
          inputMode="numeric"
          autoComplete="username"
          placeholder="Somente números"
          required
          error={errors.cpf?.message}
          {...register('cpf')}
        />

        <Input
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          error={errors.senha?.message}
          {...register('senha')}
        />

        <Checkbox label="Manter conectado" {...register('manterConectado')} />

        <Button type="submit" fullWidth loading={loginMutation.isPending}>
          Entrar
        </Button>
      </form>

      <div className="flex flex-col items-center gap-2 text-sm">
        <Link to="/recuperar-senha" className="text-primary underline">
          Esqueci minha senha
        </Link>
        <p className="text-text-secondary">
          Não tem conta?{' '}
          <Link to="/registrar" className="text-primary underline">
            Criar conta
          </Link>
        </p>
      </div>
    </main>
  );
}

// --- Etapa de verificação 2FA -----------------------------------------------

/** Schema do código 2FA: exatamente 6 dígitos (alinhado ao `verificar2faSchema`). */
const twoFactorSchema = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código deve ter 6 dígitos'),
});

type TwoFactorFormValues = z.infer<typeof twoFactorSchema>;

interface TwoFactorStepProps {
  cidadaoId: string;
  manterConectado: boolean;
  /** Chamado com o token + cidadão após verificação bem-sucedida. */
  onVerified: (token: string, cidadao: CidadaoResumo) => void;
  /** Volta ao formulário de credenciais. */
  onCancel: () => void;
}

/**
 * Segundo passo do login quando a conta tem 2FA ativo (Req. 2.5, 2.6).
 *
 * Ao montar, solicita o envio do código (`/auth/cidadao/2fa/enviar`) e exibe o
 * destino mascarado devolvido pela API. A verificação chama
 * `/auth/cidadao/2fa/verificar`; falhas aqui NÃO contam para o bloqueio por
 * senha (garantido no backend) e apenas exibem a mensagem retornada.
 */
function TwoFactorStep({ cidadaoId, manterConectado, onVerified, onCancel }: TwoFactorStepProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TwoFactorFormValues>({
    resolver: zodResolver(twoFactorSchema),
    defaultValues: { codigo: '' },
  });

  const enviarMutation = useMutation({
    mutationFn: async (): Promise<{ destino?: string }> => {
      const { data } = await axiosInstance.post<{ mensagem: string; canal: string; destino: string }>(
        '/auth/cidadao/2fa/enviar',
        { cidadaoId },
      );
      return data;
    },
    onSuccess: (data) => {
      setErro(null);
      setFeedback(
        data.destino
          ? `Enviamos um código de verificação para ${data.destino}.`
          : 'Enviamos um código de verificação.',
      );
    },
    onError: (error: unknown) => {
      setErro(parseApiError(error).error);
    },
  });

  const verificarMutation = useMutation({
    mutationFn: async (values: TwoFactorFormValues): Promise<Verificar2faResponse> => {
      const { data } = await axiosInstance.post<Verificar2faResponse>('/auth/cidadao/2fa/verificar', {
        cidadaoId,
        codigo: values.codigo,
        manterConectado,
      });
      return data;
    },
    onSuccess: (data) => {
      setErro(null);
      onVerified(data.token, data.cidadao);
    },
    onError: (error: unknown) => {
      setErro(parseApiError(error).error);
    },
  });

  // Solicita o código automaticamente ao entrar na etapa 2FA (uma única vez).
  const enviarRef = useRef(enviarMutation.mutate);
  enviarRef.current = enviarMutation.mutate;
  useEffect(() => {
    enviarRef.current();
    // Dispara apenas na montagem: o reenvio manual usa o botão "Enviar código".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = handleSubmit((values) => {
    setErro(null);
    verificarMutation.mutate(values);
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
      <header className="text-center">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Verificação em duas etapas</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Informe o código de 6 dígitos para concluir o acesso. O código expira em 10 minutos.
        </p>
      </header>

      {feedback && <Alert variant="info">{feedback}</Alert>}
      {erro && <Alert variant="danger">{erro}</Alert>}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Código de verificação"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          required
          error={errors.codigo?.message}
          {...register('codigo')}
        />

        <Button type="submit" fullWidth loading={verificarMutation.isPending}>
          Verificar
        </Button>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-primary underline disabled:text-neutral"
            onClick={() => enviarMutation.mutate()}
            disabled={enviarMutation.isPending}
          >
            {enviarMutation.isPending ? 'Enviando…' : 'Reenviar código'}
          </button>
          <button type="button" className="text-text-secondary underline" onClick={onCancel}>
            Voltar
          </button>
        </div>
      </form>
    </main>
  );
}

export default LoginPage;
