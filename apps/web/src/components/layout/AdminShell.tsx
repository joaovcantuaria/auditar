import { AppShell } from './AppShell';
import { AdminSessionTimeout } from '@/features/auth/AdminSessionTimeout';

/**
 * Shell do Painel Administrativo: reutiliza o `AppShell` padrão e monta o
 * controle de encerramento de sessão por inatividade (Req. 8.7), ativo apenas
 * para sessões de servidor. Serve como `element` das rotas `/admin/*`.
 */
export function AdminShell() {
  return (
    <>
      <AdminSessionTimeout />
      <AppShell />
    </>
  );
}

export default AdminShell;
