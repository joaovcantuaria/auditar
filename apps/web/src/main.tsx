import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { router } from '@/router';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
const rootEl = root;

/** Modo demonstração: o site funciona sem API, com dados fictícios. */
const MODO_DEMONSTRACAO = import.meta.env.VITE_DEMO_MODE === 'true';

async function iniciar(): Promise<void> {
  let banner: React.ReactNode = null;
  if (MODO_DEMONSTRACAO) {
    // Import dinâmico: o simulador só é baixado quando o modo está ligado.
    const [{ instalarModoDemonstracao }, { DemoBanner }] = await Promise.all([
      import('./demo'),
      import('./demo/DemoBanner'),
    ]);
    instalarModoDemonstracao();
    banner = <DemoBanner />;
  }

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
      {banner}
    </React.StrictMode>,
  );
}

void iniciar();
