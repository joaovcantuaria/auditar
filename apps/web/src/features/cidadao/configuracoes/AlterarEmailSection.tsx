import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { isAxiosError } from 'axios';
import { Alert, Button, Input } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Seção "Alterar e-mail" das Configurações do Cidadão (Req. 7.2, 7.8).
 *
 * Fluxo de confirmação esperado pelo backend:
 *  - `POST /cidadao/conta/alterar-email` com body `{ novoEmail: string }`.
 *  - Responde 202 com uma mensagem informando que um link de confirmação foi
 *    enviado ao NOVO e-mail (válido por 24h); o e-mail anterior permanece ativo
 *    até a confirmação. A confirmação em si acontece por outra rota acionada
 *    pelo link do e-mail (`POST /cidadao/conta/confirmar-email`), fora desta UI.
 *
 * O schema do backend valida `novoEmail` como e-mail válido, ≤254 caracteres —
 * espelhamos aqui para validação inline.
 *
 * _Requirements: 7.2, 7.8_
 */

interface ApiError {
  error?: string;
  message?: string;
}

interface AlterarEmailResponse {
  message: string;
}

const alterarEmailSchema = z.object({
  novoEmail: z
    .string()
    .trim()
    .email('E-mail inválido')
    .max(254, 'E-mail deve conter no máximo 254 caracteres'),
});

type AlterarEmailFormValues = z.infer<typeof alterarEmailSchema>;

export interface AlterarEmailSectionProps {
  /** E-mail atual, exibido como referência (somente leitura). */
  emailAtual?: string;
}

function extrairMensagemErro(err: unknown, fallback: string): string {
  if (isAxiosError<ApiError>(err)) {
    return err.response?.data?.error ?? fallback;
  }
  return fallback;
}

export function AlterarEmailSection({ emailAtual }: AlterarEmailSectionProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AlterarEmailFormValues>({
    resolver: zodResolver(alterarEmailSchema),
    mode: 'onBlur',
    defaultValues: { novoEmail: '' },
  });

  const mutation = useMutation<AlterarEmailResponse, unknown, AlterarEmailFormValues>({
    mutationFn: async (values) => {
      const { data } = await axiosInstance.post<AlterarEmailResponse>(
        '/cidadao/conta/alterar-email',
        values,
      );
      return data;
    },
    onSuccess: () => reset({ novoEmail: '' }),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      noValidate
    >
      {emailAtual && (
        <p className="text-sm text-text-secondary">
          E-mail atual: <span className="font-medium text-text-primary">{emailAtual}</span>
        </p>
      )}

      {mutation.isSuccess && (
        <Alert variant="success" title="Confirmação enviada">
          {mutation.data.message}
        </Alert>
      )}
      {mutation.isError && (
        <Alert variant="danger" title="Não foi possível solicitar a alteração">
          {extrairMensagemErro(mutation.error, 'Verifique o e-mail informado e tente novamente.')}
        </Alert>
      )}

      <Input
        label="Novo e-mail"
        type="email"
        required
        error={errors.novoEmail?.message}
        helperText="Enviaremos um link de confirmação para o novo endereço (válido por 24h)."
        {...register('novoEmail')}
      />

      <div className="flex justify-end">
        <Button type="submit" loading={mutation.isPending}>
          Enviar confirmação
        </Button>
      </div>
    </form>
  );
}

export default AlterarEmailSection;
