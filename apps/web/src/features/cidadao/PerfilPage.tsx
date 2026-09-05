import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { isAxiosError } from 'axios';
import { Alert, Button, Input, Spinner } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Página de Perfil do Cidadão — edição dos dados pessoais (Req. 7.1).
 *
 * Endpoints (baseURL do axios já inclui `/api/v1`):
 *  - `GET  /cidadao/conta`  → `{ data: PerfilCidadao }` para pré-preencher o form.
 *  - `PATCH /cidadao/conta` → salva os campos editáveis e retorna `{ data }`.
 *
 * Campos editáveis aceitos pelo backend (`editarPerfilSchema` em
 * `cidadaos.schema.ts`): `nome`, `telefone`, `logradouro`, `numero`, `cep`,
 * `cidade`, `estado`. O CPF e o e-mail são IMUTÁVEIS por este fluxo — o CPF
 * nunca muda e o e-mail tem fluxo próprio de confirmação em Configurações.
 * Ambos são exibidos apenas como leitura.
 *
 * A validação inline (por campo, `mode: 'onBlur'`) espelha exatamente as regras
 * do backend: nome ≤150, telefone 10–11 dígitos, logradouro ≤200, número ≤20,
 * CEP 8 dígitos, cidade ≤100, estado 2 caracteres (Req. 7.1).
 *
 * _Requirements: 7.1_
 */

// ---------------------------------------------------------------------------
// Tipos da resposta (`{ data: PerfilCidadao }`) — campos EXATOS do backend.
// ---------------------------------------------------------------------------

interface PerfilCidadao {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  logradouro: string;
  numero: string;
  cep: string;
  cidade: string;
  estado: string;
}

interface PerfilResponse {
  data: PerfilCidadao;
}

interface ApiError {
  error?: string;
  code?: string;
  field?: string;
}

// ---------------------------------------------------------------------------
// Schema do formulário — espelha `editarPerfilSchema` do backend (Req. 7.1).
// ---------------------------------------------------------------------------

const APENAS_DIGITOS = /^\d+$/;

const perfilFormSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Nome não pode ser vazio')
    .max(150, 'Nome deve conter no máximo 150 caracteres'),
  telefone: z
    .string()
    .trim()
    .regex(APENAS_DIGITOS, 'Telefone deve conter apenas dígitos')
    .refine((v) => v.length === 10 || v.length === 11, {
      message: 'Telefone deve conter 10 ou 11 dígitos',
    }),
  logradouro: z
    .string()
    .trim()
    .min(1, 'Logradouro não pode ser vazio')
    .max(200, 'Logradouro deve conter no máximo 200 caracteres'),
  numero: z
    .string()
    .trim()
    .min(1, 'Número não pode ser vazio')
    .max(20, 'Número deve conter no máximo 20 caracteres'),
  cep: z
    .string()
    .trim()
    .regex(APENAS_DIGITOS, 'CEP deve conter apenas dígitos')
    .length(8, 'CEP deve conter 8 dígitos'),
  cidade: z
    .string()
    .trim()
    .min(1, 'Cidade não pode ser vazia')
    .max(100, 'Cidade deve conter no máximo 100 caracteres'),
  estado: z
    .string()
    .trim()
    .length(2, 'Estado deve conter 2 caracteres'),
});

type PerfilFormValues = z.infer<typeof perfilFormSchema>;

/** Query key do perfil do cidadão (reutilizada por Perfil e Configurações). */
export const perfilQueryKey = ['cidadao', 'conta'] as const;

/** Extrai a mensagem de erro amigável de uma resposta de erro da API. */
function extrairMensagemErro(err: unknown, fallback: string): string {
  if (isAxiosError<ApiError>(err)) {
    return err.response?.data?.error ?? fallback;
  }
  return fallback;
}

export function PerfilPage() {
  const queryClient = useQueryClient();

  const perfilQuery = useQuery<PerfilResponse>({
    queryKey: perfilQueryKey,
    queryFn: async () => {
      const { data } = await axiosInstance.get<PerfilResponse>('/cidadao/conta');
      return data;
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<PerfilFormValues>({
    resolver: zodResolver(perfilFormSchema),
    mode: 'onBlur',
    defaultValues: {
      nome: '',
      telefone: '',
      logradouro: '',
      numero: '',
      cep: '',
      cidade: '',
      estado: '',
    },
  });

  // Pré-preenche o formulário quando o perfil chega do backend.
  useEffect(() => {
    const perfil = perfilQuery.data?.data;
    if (perfil) {
      reset({
        nome: perfil.nome,
        telefone: perfil.telefone,
        logradouro: perfil.logradouro,
        numero: perfil.numero,
        cep: perfil.cep,
        cidade: perfil.cidade,
        estado: perfil.estado,
      });
    }
  }, [perfilQuery.data, reset]);

  const mutation = useMutation<PerfilResponse, unknown, PerfilFormValues>({
    mutationFn: async (values) => {
      const { data } = await axiosInstance.patch<PerfilResponse>('/cidadao/conta', values);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(perfilQueryKey, data);
      reset({
        nome: data.data.nome,
        telefone: data.data.telefone,
        logradouro: data.data.logradouro,
        numero: data.data.numero,
        cep: data.data.cep,
        cidade: data.data.cidade,
        estado: data.data.estado,
      });
    },
  });

  const perfil = perfilQuery.data?.data;

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Meu Perfil</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Mantenha seus dados pessoais atualizados.
        </p>
      </header>

      {perfilQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando perfil..." />
        </div>
      ) : perfilQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar seu perfil">
          Tente novamente em instantes.
        </Alert>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          {mutation.isSuccess && (
            <Alert variant="success" title="Perfil atualizado">
              Seus dados foram salvos com sucesso.
            </Alert>
          )}
          {mutation.isError && (
            <Alert variant="danger" title="Não foi possível salvar">
              {extrairMensagemErro(mutation.error, 'Verifique os campos e tente novamente.')}
            </Alert>
          )}

          {/* Campos imutáveis, apenas leitura. */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Input label="CPF" value={perfil?.cpf ?? ''} readOnly disabled helperText="O CPF não pode ser alterado" />
            <Input label="E-mail" value={perfil?.email ?? ''} readOnly disabled helperText="Altere o e-mail em Configurações" />
          </div>

          <Input label="Nome completo" required error={errors.nome?.message} {...register('nome')} />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Input
              label="Telefone"
              required
              inputMode="numeric"
              error={errors.telefone?.message}
              helperText="Somente dígitos (DDD + número)"
              {...register('telefone')}
            />
            <Input
              label="CEP"
              required
              inputMode="numeric"
              error={errors.cep?.message}
              helperText="8 dígitos, sem traço"
              {...register('cep')}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_140px]">
            <Input label="Logradouro" required error={errors.logradouro?.message} {...register('logradouro')} />
            <Input label="Número" required error={errors.numero?.message} {...register('numero')} />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_100px]">
            <Input label="Cidade" required error={errors.cidade?.message} {...register('cidade')} />
            <Input
              label="Estado (UF)"
              required
              maxLength={2}
              error={errors.estado?.message}
              {...register('estado')}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={mutation.isPending} disabled={!isDirty}>
              Salvar alterações
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export default PerfilPage;
