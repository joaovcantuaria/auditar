import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// Mock do cliente axios: a página usa o import nomeado `axiosInstance` (e o
// interceptor usa o default). Cobrimos ambos com o mesmo objeto mockado.
const getMock = vi.fn();
vi.mock('@/lib/axiosInstance', () => {
  const instance = { get: (...args: unknown[]) => getMock(...args) };
  return { __esModule: true, axiosInstance: instance, default: instance };
});

import { MeusProcessosPage } from '../MeusProcessosPage';

/** Renderiza a página com os providers necessários (Router + React Query). */
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

const PROCESSOS = [
  {
    protocolo: '2024-00001',
    categoria: 'Tributário',
    tipoProcesso: 'Isenção de IPTU',
    abertoEm: '2024-03-10T12:00:00.000Z',
    status: 'em_andamento',
    prazoFinal: '2024-04-10T12:00:00.000Z',
  },
  {
    protocolo: '2024-00002',
    categoria: 'Urbanismo',
    tipoProcesso: 'Alvará de construção',
    abertoEm: '2024-02-01T12:00:00.000Z',
    status: 'aprovado',
    prazoFinal: '2024-03-01T12:00:00.000Z',
  },
];

describe('MeusProcessosPage', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('lista os processos do cidadão com protocolo, tipo e status', async () => {
    getMock.mockResolvedValue({ data: { data: PROCESSOS } });
    renderWithProviders(<MeusProcessosPage />);

    expect(await screen.findByText('2024-00001')).toBeInTheDocument();
    expect(screen.getByText('Isenção de IPTU')).toBeInTheDocument();
    expect(screen.getByText('Em andamento')).toBeInTheDocument();
    expect(screen.getByText('Aprovado')).toBeInTheDocument();
    // Ação primária sempre presente.
    expect(screen.getByRole('button', { name: /Novo Processo/i })).toBeInTheDocument();
  });

  it('exibe o estado vazio com a ação Novo Processo quando não há processos', async () => {
    getMock.mockResolvedValue({ data: { data: [] } });
    renderWithProviders(<MeusProcessosPage />);

    expect(await screen.findByText(/ainda não abriu nenhum processo/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Novo Processo/i }).length).toBeGreaterThan(0);
  });

  it('envia o filtro de status ao backend como query param', async () => {
    getMock.mockResolvedValue({ data: { data: PROCESSOS } });
    const user = userEvent.setup();
    renderWithProviders(<MeusProcessosPage />);

    await screen.findByText('2024-00001');
    await user.selectOptions(screen.getByLabelText(/Status/i), 'aprovado');

    await waitFor(() => {
      expect(getMock).toHaveBeenLastCalledWith('/processos', {
        params: { status: 'aprovado' },
      });
    });
  });

  it('filtra por categoria no cliente sem refazer a requisição', async () => {
    getMock.mockResolvedValue({ data: { data: PROCESSOS } });
    const user = userEvent.setup();
    renderWithProviders(<MeusProcessosPage />);

    await screen.findByText('2024-00001');
    const chamadasAntes = getMock.mock.calls.length;

    await user.selectOptions(screen.getByLabelText(/Categoria/i), 'Urbanismo');

    // Restou apenas o processo de Urbanismo; o de Tributário sumiu.
    await waitFor(() => {
      expect(screen.queryByText('Isenção de IPTU')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Alvará de construção')).toBeInTheDocument();
    // Filtro de categoria é aplicado no cliente: nenhuma nova chamada ao backend.
    expect(getMock.mock.calls.length).toBe(chamadasAntes);
  });

  it('cada linha aponta para o detalhe do processo em /processos/:protocolo', async () => {
    getMock.mockResolvedValue({ data: { data: PROCESSOS } });
    renderWithProviders(<MeusProcessosPage />);

    const link = await screen.findByRole('link', { name: '2024-00001' });
    expect(link).toHaveAttribute('href', '/processos/2024-00001');
  });
});
