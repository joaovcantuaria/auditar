import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// Mock do cliente axios (default export) usado pela página.
const postMock = vi.fn();
vi.mock('@/lib/axiosInstance', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => postMock(...args) },
}));

import { RegisterPage } from '../RegisterPage';

/** Renderiza um componente com os providers necessários (Router + React Query). */
function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Preenche o formulário com dados válidos (CPF com dígitos verificadores corretos). */
async function preencherValido(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Nome completo/i), 'Maria Silva');
  await user.type(screen.getByLabelText(/^CPF/i), '52998224725'); // CPF válido
  await user.type(screen.getByLabelText(/E-mail/i), 'maria@exemplo.com');
  await user.type(screen.getByLabelText(/Telefone/i), '11987654321');
  await user.type(screen.getByLabelText(/Logradouro/i), 'Rua das Flores');
  await user.type(screen.getByLabelText(/Número/i), '100');
  await user.type(screen.getByLabelText(/CEP/i), '01001000');
  await user.type(screen.getByLabelText(/Cidade/i), 'São Paulo');
  await user.selectOptions(screen.getByLabelText(/Estado/i), 'SP');
  await user.type(screen.getByLabelText(/Senha/i), 'senha1234');
}

describe('RegisterPage', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('valida o CPF com dígitos verificadores incorretos ao sair do campo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegisterPage />);

    const cpf = screen.getByLabelText(/^CPF/i);
    await user.type(cpf, '12345678900'); // 11 dígitos, mas dígito verificador inválido
    await user.tab(); // blur → validação onBlur

    expect(await screen.findByText(/CPF inválido/i)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('envia os dados ao backend e exibe sucesso quando o formulário é válido', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'abc', mensagem: 'ok' } });
    const user = userEvent.setup();
    renderWithProviders(<RegisterPage />);

    await preencherValido(user);
    await user.click(screen.getByRole('button', { name: /Criar conta/i }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/auth/cidadao/registrar', expect.objectContaining({
        nome: 'Maria Silva',
        cpf: '52998224725',
        email: 'maria@exemplo.com',
        estado: 'SP',
      }));
    });

    expect(await screen.findByText(/Confira seu e-mail/i)).toBeInTheDocument();
  });

  it('mapeia o erro do backend ao campo ofensor (CPF já cadastrado)', async () => {
    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: 'CPF já cadastrado', code: 'CPF_DUPLICADO', field: 'cpf' } },
    });
    const user = userEvent.setup();
    renderWithProviders(<RegisterPage />);

    await preencherValido(user);
    await user.click(screen.getByRole('button', { name: /Criar conta/i }));

    expect(await screen.findByText(/CPF já cadastrado/i)).toBeInTheDocument();
  });
});
