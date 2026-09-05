import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import type { NivelAcesso } from '@auditar/shared';
import { Button, Input, Alert } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';
import { useAuthStore } from '@/store/authStore';

/**
 * Página de login do Servidor (Painel Administrativo).
 *
 * Requisitos:
 * - 8.1  Login por CPF (11 dígitos) + senha (mín. 8).
 * - 8.3  Ao autenticar, persiste o token com as permissões granulares no store.
 * - 8.5  Bloqueio após tentativas: exibe o tempo restante retornado pela API.
 * - 8.8  Erro de credenciais genérico (não revela existência do CPF) — usa a
 *        mensagem do backend verbatim.
 * - 21.3 Primeiro acesso com senha temporária (`senhaTemporaria: true`) exige
 *        troca antes de prosseguir: um formulário inline de troca é exibido e,
 *        após a troca, o servidor é logado e redirecionado para `/admin`.
 *
 * Contratos do backend (lidos de `auth.servidor.*`):
 * - `POST /auth/servidor/login` body `{ cpf, senha }` →
 *   `{ token, servidor: { id, nome, nivelAcesso, senhaTemporaria }, mustChangePassword }`.
 *   Erros: 401 `{ error: 'CPF ou senha inválidos', code: 'AUTH_001' }` (genérico),
 *   423 `{ error, code: 'AUTH_002' (ACCOUNT_LOCKED) }` com minutos no `error`.
 * - `POST /auth/servidor/trocar-senha` body `{ senhaAtual, novaSenha }` → 204.
 *   Requer o header Authorization (adicionado pelo interceptor após persistir o token).
 */

/** Resposta de sucesso do endpoint de login do servidor. */
interface LoginServidorResponse {
  token: string;
  servidor: {
    id: string;
    nome: string;
    nivelAcesso: number;
    senhaTemporaria: boolean;
  };
  mustChangePassword: boolean;
}

/** Formato de erro padronizado da API (`{ error, code, field? }`). */
interface ApiError {
  error: string;
  code: string;
  field?: string;
}

const loginSchema = z.object({
  cpf: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'CPF deve conter exatamente 11 dígitos numéricos'),
  senha: z.string().min(8, 'Senha deve conter no mínimo 8 caracteres'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const trocarSenhaSchema = z
  .object({
    novaSenha: z
      .string()
      .min(8, 'Nova senha deve conter no mínimo 8 caracteres')
      .max(64, 'Nova senha deve conter no máximo 64 caracteres'),
    confirmarSenha: z.string(),
  })
  .refine((data) => data.novaSenha === data.confirmarSenha, {
    message: 'As senhas não coincidem',
    path: ['confirmarSenha'],
  });

type TrocarSenhaFormValues = z.infer<typeof trocarSenhaSchema>;

/** Extrai a mensagem de erro da API de forma segura, com fallback amigável. */
function extractApiError(err: unknown): { message: string; code?: string } {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as Partial<ApiError>;
    if (typeof data.error === 'string') {
      return { message: data.error, code: data.code };
    }
  }
  return { message: 'Não foi possível concluir a solicitação. Tente novamente.' };
}

export function AdminLoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  /** Erro global do formulário de login (genérico/bloqueio). */
  const [loginError, setLoginError] = useState<string | null>(null);
  /**
   * Quando o login retorna `mustChangePassword`, guardamos o contexto para o
   * formulário inline de troca de senha (Req. 21.3).
   */
  const [pendingChange, setPendingChange] = useState<{
    token: string;
    senhaAtual: string;
    servidor: LoginServidorResponse['servidor'];
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { cpf: '', senha: '' },
  });

  const loginMutation = useMutation({
    mutationFn: async (values: LoginFormValues): Promise<LoginServidorResponse> => {
      const { data } = await axiosInstance.post<LoginServidorResponse>(
        '/auth/servidor/login',
        values,
      );
      return data;
    },
    onSuccess: (data, variables) => {
      setLoginError(null);

      if (data.mustChangePassword || data.servidor.senhaTemporaria) {
        // Não completa o login normal: exige troca da senha temporária primeiro.
        setPendingChange({
          token: data.token,
          senhaAtual: variables.senha,
          servidor: data.servidor,
        });
        return;
      }

      completeLogin(data.token, data.servidor);
    },
    onError: (err) => {
      const { message } = extractApiError(err);
      // Mensagem verbatim do backend: genérica (Req. 8.8) ou de bloqueio (Req. 8.5).
      setLoginError(message);
    },
  });

  /** Persiste a sessão no store e navega ao dashboard administrativo. */
  function completeLogin(token: string, servidor: LoginServidorResponse['servidor']) {
    login(token, {
      sub: servidor.id,
      role: 'servidor',
      nome: servidor.nome,
      nivel: servidor.nivelAcesso as NivelAcesso,
    });
    navigate('/admin', { replace: true });
  }

  if (pendingChange) {
    return (
      <ChangeTemporaryPasswordForm
        token={pendingChange.token}
        senhaAtual={pendingChange.senhaAtual}
        onChanged={() => completeLogin(pendingChange.token, pendingChange.servidor)}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="font-heading text-h2 text-text-primary">Painel — Entrar</h1>
        <p className="mt-1 text-sm text-text-secondary">Acesso restrito a servidores.</p>
      </div>

      {loginError && (
        <Alert variant="danger" title="Não foi possível entrar">
          {loginError}
        </Alert>
      )}

      <form
        noValidate
        onSubmit={handleSubmit((values) => loginMutation.mutate(values))}
        className="flex flex-col gap-4"
      >
        <Input
          label="CPF"
          type="text"
          inputMode="numeric"
          autoComplete="username"
          maxLength={11}
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

        <Button type="submit" fullWidth loading={loginMutation.isPending}>
          Entrar
        </Button>
      </form>
    </main>
  );
}

interface ChangeTemporaryPasswordFormProps {
  /** Token emitido no login; já persistido? Não — enviamos explicitamente no header. */
  token: string;
  /** Senha atual (temporária) informada no login, exigida pelo endpoint de troca. */
  senhaAtual: string;
  /** Chamado após a troca bem-sucedida para completar o login e redirecionar. */
  onChanged: () => void;
}

/**
 * Formulário inline de troca de senha temporária (Req. 21.3).
 *
 * Posta `{ senhaAtual, novaSenha }` em `/auth/servidor/trocar-senha`. Como o
 * token ainda não está no store (evitamos logar antes da troca), enviamos o
 * `Authorization` explicitamente nesta requisição.
 */
function ChangeTemporaryPasswordForm({
  token,
  senhaAtual,
  onChanged,
}: ChangeTemporaryPasswordFormProps) {
  const [changeError, setChangeError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TrocarSenhaFormValues>({
    resolver: zodResolver(trocarSenhaSchema),
    defaultValues: { novaSenha: '', confirmarSenha: '' },
  });

  const changeMutation = useMutation({
    mutationFn: async (values: TrocarSenhaFormValues): Promise<void> => {
      await axiosInstance.post(
        '/auth/servidor/trocar-senha',
        { senhaAtual, novaSenha: values.novaSenha },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    },
    onSuccess: () => {
      setChangeError(null);
      onChanged();
    },
    onError: (err) => {
      setChangeError(extractApiError(err).message);
    },
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="font-heading text-h2 text-text-primary">Definir nova senha</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Seu acesso usa uma senha temporária. Defina uma nova senha para continuar.
        </p>
      </div>

      {changeError && (
        <Alert variant="danger" title="Não foi possível trocar a senha">
          {changeError}
        </Alert>
      )}

      <form
        noValidate
        onSubmit={handleSubmit((values) => changeMutation.mutate(values))}
        className="flex flex-col gap-4"
      >
        <Input
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          required
          helperText="Entre 8 e 64 caracteres."
          error={errors.novaSenha?.message}
          {...register('novaSenha')}
        />

        <Input
          label="Confirmar nova senha"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirmarSenha?.message}
          {...register('confirmarSenha')}
        />

        <Button type="submit" fullWidth loading={changeMutation.isPending}>
          Salvar e entrar
        </Button>
      </form>
    </main>
  );
}

export default AdminLoginPage;
