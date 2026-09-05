import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import axios, { AxiosError } from 'axios';
import { registerCidadaoSchema, validarCPF } from '@auditar/shared';
import { Alert, Button, Input, Select } from '@/components/ui';
import axiosInstance from '@/lib/axiosInstance';

/**
 * Página de cadastro do Cidadão (Req. 1.1, 1.2).
 *
 * Formulário com todos os campos obrigatórios definidos no contrato do
 * backend (`registerCidadaoSchema` de `@auditar/shared`), validação em tempo
 * real campo a campo (`mode: 'onBlur'`) com Zod + react-hook-form e exibição
 * de erro individual adjacente a cada campo (via prop `error` do `Input`).
 *
 * No submit envia `POST /api/v1/auth/cidadao/registrar` via React Query. Em
 * caso de sucesso exibe um `Alert` com instrução de ativação por e-mail; em
 * caso de erro do backend (`{ error, code, field }`) mapeia a mensagem ao
 * campo ofensor quando `field` é informado.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
 */

/**
 * Schema do formulário: reutiliza o schema compartilhado (fonte de verdade dos
 * campos e regras) e reforça a validação de CPF com o algoritmo da Receita
 * Federal (dígitos verificadores — Req. 1.2), que o schema base não cobre.
 */
const registerFormSchema = registerCidadaoSchema.extend({
  cpf: registerCidadaoSchema.shape.cpf.refine(validarCPF, {
    message: 'CPF inválido',
  }),
});

type RegisterFormValues = z.infer<typeof registerFormSchema>;

/** Estrutura de erro padrão retornada pela API. */
interface ApiError {
  error: string;
  code?: string;
  field?: string;
}

/** Campos do formulário aos quais um erro do backend pode ser atribuído. */
const CAMPOS_FORM: ReadonlyArray<keyof RegisterFormValues> = [
  'nome',
  'cpf',
  'email',
  'telefone',
  'logradouro',
  'numero',
  'cep',
  'cidade',
  'estado',
  'senha',
];

/** Unidades federativas (UFs) para o Select de estado. */
const UFS: ReadonlyArray<string> = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

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

/** Type guard: o `field` retornado corresponde a um campo conhecido do form. */
function isFormField(field: string): field is keyof RegisterFormValues {
  return (CAMPOS_FORM as ReadonlyArray<string>).includes(field);
}

export function RegisterPage() {
  const [sucesso, setSucesso] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    mode: 'onBlur',
    defaultValues: {
      nome: '',
      cpf: '',
      email: '',
      telefone: '',
      logradouro: '',
      numero: '',
      cep: '',
      cidade: '',
      estado: '',
      senha: '',
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: RegisterFormValues) => {
      const { data } = await axiosInstance.post<{ id: string; mensagem: string }>(
        '/auth/cidadao/registrar',
        values,
      );
      return data;
    },
    onSuccess: () => {
      setErroGeral(null);
      setSucesso(true);
    },
    onError: (err: unknown) => {
      const apiError = extractApiError(err);
      if (apiError?.field && isFormField(apiError.field)) {
        // Mapeia a mensagem do backend ao campo ofensor (ex.: CPF/e-mail já cadastrado).
        setError(apiError.field, { type: 'server', message: apiError.error });
        setErroGeral(null);
        return;
      }
      setErroGeral(apiError?.error ?? 'Não foi possível concluir o cadastro. Tente novamente.');
    },
  });

  const onSubmit = handleSubmit((values) => {
    setErroGeral(null);
    mutation.mutate(values);
  });

  const ufOptions = useMemo(() => UFS.map((uf) => ({ label: uf, value: uf })), []);

  if (sucesso) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-4">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Cadastro realizado</h1>
        <Alert variant="success" title="Confira seu e-mail">
          Enviamos um link de ativação para o e-mail informado. Acesse o link para ativar sua conta.
          O link é de uso único e expira em 48 horas.
        </Alert>
        <p className="text-sm text-text-secondary">
          Já ativou sua conta?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Criar conta</h1>
        <p className="text-sm text-text-secondary">
          Preencha seus dados para acessar o Portal do Cidadão.
        </p>
      </header>

      {erroGeral && (
        <Alert variant="danger" title="Não foi possível concluir o cadastro">
          {erroGeral}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Nome completo"
          required
          autoComplete="name"
          error={errors.nome?.message}
          {...register('nome')}
        />

        <Input
          label="CPF"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="Somente números"
          error={errors.cpf?.message}
          {...register('cpf')}
        />

        <Input
          label="E-mail"
          type="email"
          required
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Telefone"
          required
          inputMode="numeric"
          autoComplete="tel"
          placeholder="DDD + número (somente dígitos)"
          error={errors.telefone?.message}
          {...register('telefone')}
        />

        <Input
          label="Logradouro"
          required
          autoComplete="address-line1"
          error={errors.logradouro?.message}
          {...register('logradouro')}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Número"
            required
            autoComplete="address-line2"
            error={errors.numero?.message}
            {...register('numero')}
          />
          <Input
            label="CEP"
            required
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="8 dígitos"
            error={errors.cep?.message}
            {...register('cep')}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Cidade"
            required
            autoComplete="address-level2"
            error={errors.cidade?.message}
            {...register('cidade')}
          />
          <Select
            label="Estado"
            required
            placeholder="UF"
            options={ufOptions}
            error={errors.estado?.message}
            {...register('estado')}
          />
        </div>

        <Input
          label="Senha"
          type="password"
          required
          autoComplete="new-password"
          helperText="Entre 8 e 64 caracteres."
          error={errors.senha?.message}
          {...register('senha')}
        />

        <Button type="submit" fullWidth loading={mutation.isPending} disabled={mutation.isPending}>
          Criar conta
        </Button>
      </form>

      <p className="text-center text-sm text-text-secondary">
        Já tem uma conta?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </main>
  );
}

export default RegisterPage;
