import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { isAxiosError } from 'axios';
import { Alert, Button, Input } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Seção "Alterar senha" das Configurações do Cidadão (Req. 7.3, 7.4).
 *
 * Endpoint: `POST /cidadao/conta/alterar-senha` com body
 *   `{ senhaAtual: string, novaSenha: string }`.
 *
 * O backend (`alterarSenhaSchema` + `alterarSenha`) exige a senha atual e aceita
 * a nova senha somente entre 8 e 64 caracteres; se a senha atual estiver
 * incorreta, responde 400 com mensagem genérica sem revelar a senha (Req. 7.4).
 * A confirmação da nova senha é validada apenas no cliente.
 *
 * _Requirements: 7.3, 7.4_
 */

interface ApiError {
  error?: string;
}

interface AlterarSenhaResponse {
  message: string;
}

const alterarSenhaSchema = z
  .object({
    senhaAtual: z.string().min(1, 'Informe sua senha atual'),
    novaSenha: z
      .string()
      .min(8, 'A nova senha deve conter no mínimo 8 caracteres')
      .max(64, 'A nova senha deve conter no máximo 64 caracteres'),
    confirmarSenha: z.string().min(1, 'Confirme a nova senha'),
  })
  .refine((v) => v.novaSenha === v.confirmarSenha, {
    message: 'As senhas não coincidem',
    path: ['confirmarSenha'],
  });

type AlterarSenhaFormValues = z.infer<typeof alterarSenhaSchema>;

function extrairMensagemErro(err: unknown, fallback: string): string {
  if (isAxiosError<ApiError>(err)) {
    return err.response?.data?.error ?? fallback;
  }
  return fallback;
}

export function AlterarSenhaSection() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AlterarSenhaFormValues>({
    resolver: zodResolver(alterarSenhaSchema),
    mode: 'onBlur',
    defaultValues: { senhaAtual: '', novaSenha: '', confirmarSenha: '' },
  });

  const mutation = useMutation<AlterarSenhaResponse, unknown, AlterarSenhaFormValues>({
    mutationFn: async (values) => {
      const { data } = await axiosInstance.post<AlterarSenhaResponse>(
        '/cidadao/conta/alterar-senha',
        { senhaAtual: values.senhaAtual, novaSenha: values.novaSenha },
      );
      return data;
    },
    onSuccess: () => reset({ senhaAtual: '', novaSenha: '', confirmarSenha: '' }),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      noValidate
    >
      {mutation.isSuccess && (
        <Alert variant="success" title="Senha alterada">
          Sua senha foi atualizada com sucesso.
        </Alert>
      )}
      {mutation.isError && (
        <Alert variant="danger" title="Não foi possível alterar a senha">
          {extrairMensagemErro(mutation.error, 'Verifique os dados e tente novamente.')}
        </Alert>
      )}

      <Input
        label="Senha atual"
        type="password"
        required
        autoComplete="current-password"
        error={errors.senhaAtual?.message}
        {...register('senhaAtual')}
      />
      <Input
        label="Nova senha"
        type="password"
        required
        autoComplete="new-password"
        error={errors.novaSenha?.message}
        helperText="Entre 8 e 64 caracteres"
        {...register('novaSenha')}
      />
      <Input
        label="Confirmar nova senha"
        type="password"
        required
        autoComplete="new-password"
        error={errors.confirmarSenha?.message}
        {...register('confirmarSenha')}
      />

      <div className="flex justify-end">
        <Button type="submit" loading={mutation.isPending}>
          Alterar senha
        </Button>
      </div>
    </form>
  );
}

export default AlterarSenhaSection;
