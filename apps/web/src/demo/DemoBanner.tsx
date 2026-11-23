import { useState } from 'react';
import { reiniciarDb } from './db';

/**
 * Faixa discreta no rodapé avisando que o site está em modo demonstração,
 * com os logins de teste e um botão para voltar os dados ao estado inicial.
 */
export function DemoBanner() {
  const [aberto, setAberto] = useState(false);

  function reiniciar() {
    if (!window.confirm('Voltar todos os dados da demonstração ao estado inicial?')) return;
    reiniciarDb();
    try {
      window.localStorage.removeItem('auditar-auth');
    } catch {
      // ignora
    }
    window.location.assign('/');
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 9999,
        maxWidth: 'calc(100vw - 32px)',
        fontFamily: 'inherit',
        fontSize: 13,
      }}
    >
      {aberto && (
        <div
          style={{
            marginBottom: 8,
            width: 300,
            maxWidth: '100%',
            background: '#ffffff',
            color: '#1f2937',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            padding: 14,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ display: 'block', marginBottom: 6 }}>Modo demonstração</strong>
          <span style={{ color: '#4b5563' }}>
            Dados fictícios. Nada é enviado nem salvo no servidor.
          </span>
          <ul style={{ margin: '10px 0', paddingLeft: 18 }}>
            <li>
              <b>Cidadão</b> (<a href="/login">/login</a>): 222.222.222-22 · Cidadao@123
            </li>
            <li>
              <b>Analista</b> (<a href="/admin/login">/admin/login</a>): 111.111.111-11 · Analista@123
            </li>
            <li>
              <b>Gestor</b>: 333.333.333-33 · Gestor@123
            </li>
            <li>
              <b>Administrador</b>: 000.000.000-00 · Admin@123
            </li>
          </ul>
          <button
            type="button"
            onClick={reiniciar}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: '#f9fafb',
              cursor: 'pointer',
            }}
          >
            Reiniciar dados da demonstração
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        style={{
          float: 'right',
          padding: '6px 12px',
          borderRadius: 999,
          border: 'none',
          background: '#1e3a8a',
          color: '#ffffff',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}
      >
        Demonstração {aberto ? '×' : 'ⓘ'}
      </button>
    </div>
  );
}
