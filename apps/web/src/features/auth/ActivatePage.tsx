import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import axios, { AxiosError } from 'axios';
import { Alert, Button, Input, Spinner } from '@/components/ui';
import axiosInstance from '@/lib/axiosInstance';

/**
 * Página de ativação de conta do Cidadão (Req. 1.3, 1.4, 1.6, 1.7, 1.8).
 *
 * O link enviado por e-mail aponta para `/ativar/:token` (ver backend
 * `auth.cidadao.email.ts` → `montarLinkAtivacao`), portanto o token é lido do
 * parâmetro de rota. Como fallback defensivo, também aceitamos `?token=`.
 *
 * Ao montar, chama `POST /api/v1/auth/cidadao/ativar` com `{ token }`. Em caso
 * de sucesso, exibe confirmação e redireciona para `/login` após um breve
 * intervalo (ou imediatamente via botão). Em caso de token inválido/expirado
 * (`code: TOKEN_EXPIRED`), oferece o reenvio do link via
 * `POST /api/v1/auth/cidadao/reenviar-ativacao` com `{ email }`.
 *
 * _Requirements: 1.3, 1.4, 1.6, 1.7, 1.8_
 */

/** Estrutura de erro padrão retornada pela API. */
interface ApiError {
  error: string;
  code?: string;
  field?: string;
}

/** Segundos de espera antes do redirecionamento automático ao login. */
const REDIRECT_DELAY_SECONDS = 4;

/** Schema do formulário de reenvio do link de ativação. */
const reenviarSchema = z.object({
  email: z.string().email('Formato de e-mail inválido').max(254, 'E-mail muito longo'),
});

type ReenviarFormValues = z.infer<typeof reenviarSchema>;

/** Extrai o corpo de erro da API a partir de uma exceção do axios. */
function extractApiError(err: unknown): ApiError | null {
  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<ApiError>;
    if (axiosErr.response?.data && typeof axiosErr.response.data === 'object') {
      return axiosErr.response.data;
    }
  }
  return null;
}

export function ActivatePage() {
  const params = useParams<{ token?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Token via parâmetro de rota (formato do e-mail) com fallback para query string.
  const token = params.token ?? searchParams.get('token') ?? '';

  // Garante que a ativação seja disparada uma única vez, mesmo sob StrictMode.
  const disparadoRef = useRef(false);
  const [reenviado, setReenviado] = useState(false);

  const ativarMutation = useMutation({
    mutationFn: async (activationToken: string) => {
      const { data } = await axiosInstance.post<{ id: string; mensagem: string }>(
        '/auth/cidadao/ativar',
        { token: activationToken },
      );
      return data;
    },
  });

  const reenviarForm = useForm<ReenviarFormValues>({
    resolver: zodResolver(reenviarSchema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  const reenviarMutation = useMutation({
    mutationFn: async (values: ReenviarFormValues) => {
      const { data } = await axiosInstance.post<{ mensagem: string }>(
        '/auth/cidadao/reenviar-ativacao',
        values,
      );
      return data;
    },
    onSuccess: () => setReenviado(true),
  });

  const { mutate: ativar } = ativarMutation;

  // Dispara a ativação ao montar, quando há token.
  useEffect(() => {
    if (disparadoRef.current) return;
    if (!token) return;
    disparadoRef.current = true;
    ativar(token);
  }, [token, ativar]);

  // Redireciona para o login após o sucesso.
  useEffect(() => {
    if (!ativarMutation.isSuccess) return;
    const timer = window.setTimeout(() => {
      navigate('/login', { replace: true });
    }, REDIRECT_DELAY_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [ativarMutation.isSuccess, navigate]);

  const onReenviar = reenviarForm.handleSubmit((values) => {
    reenviarMutation.mutate(values);
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-4">
      <h1 className="font-heading text-2xl font-semibold text-text-primary">Ativação de conta</h1>

      {/* Token ausente na URL. */}
      {!token && (
        <Alert variant="danger" title="Link inválido">
          Não encontramos um token de ativação na URL. Verifique se copiou o link completo enviado
          por e-mail.
        </Alert>
      )}

      {/* Ativação em andamento. */}
      {token && ativarMutation.isPending && (
        <div className="flex items-center gap-3 text-text-secondary">
          <Spinner size="md" />
          <span>Ativando sua conta...</span>
        </div>
      )}

      {/* Sucesso. */}
      {ativarMutation.isSuccess && (
        <>
          <Alert variant="success" title="Conta ativada">
            Sua conta foi ativada com sucesso. Você será redirecionado para a tela de login em
            instantes.
          </Alert>
          <Button onClick={() => navigate('/login', { replace: true })} fullWidth>
            Ir para login
          </Button>
        </>
      )}

      {/* Erro (token inválido/expirado) → oferecer reenvio. */}
      {ativarMutation.isError && (
        <>
          <Alert variant="danger" title="Link inválido ou expirado">
            {extractApiError(ativarMutation.error)?.error ??
              'Não foi possível ativar sua conta. O link pode ter expirado.'}
          </Alert>

          {reenviado ? (
            <Alert variant="info" title="Reenvio solicitado">
              Se houver uma conta pendente para este e-mail, um novo link de ativação foi enviado.
            </Alert>
          ) : (
            <form onSubmit={onReenviar} noValidate className="flex flex-col gap-4">
              <p className="text-sm text-text-secondary">
                Informe seu e-mail para receber um novo link de ativação.
              </p>
              <Input
                label="E-mail"
                type="email"
                required
                autoComplete="email"
                error={reenviarForm.formState.errors.email?.message}
                {...reenviarForm.register('email')}
              />
              <Button
                type="submit"
                fullWidth
                loading={reenviarMutation.isPending}
                disabled={reenviarMutation.isPending}
              >
                Reenviar ativação
              </Button>
            </form>
          )}
        </>
      )}

      <p className="text-center text-sm text-text-secondary">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Voltar para o login
        </Link>
      </p>
    </main>
  );
}

export default ActivatePage;
