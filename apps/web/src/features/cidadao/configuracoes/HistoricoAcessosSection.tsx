import { useQuery } from '@tanstack/react-query';
import { Alert, Spinner } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Seção "Histórico de acessos" das Configurações do Cidadão (Req. 7.5).
 *
 * Endpoint: `GET /cidadao/conta/acessos` → `{ data: AcessoResumo[] }`, já
 * limitado aos 10 últimos acessos em ordem cronológica decrescente pelo
 * backend. Cada item traz os campos EXATOS `{ data, hora, ip }`, onde `data`
 * está em `AAAA-MM-DD` e `hora` em `HH:MM:SS` (UTC).
 *
 * _Requirements: 7.5_
 */

interface AcessoResumo {
  data: string;
  hora: string;
  ip: string;
}

interface AcessosResponse {
  data: AcessoResumo[];
}

/** Query key do histórico de acessos. */
export const acessosQueryKey = ['cidadao', 'conta', 'acessos'] as const;

/** Formata `AAAA-MM-DD` em `dd/mm/aaaa`; devolve o original se inesperado. */
function formatarData(iso: string): string {
  const partes = iso.split('-');
  if (partes.length !== 3) return iso;
  const [ano, mes, dia] = partes;
  return `${dia}/${mes}/${ano}`;
}

export function HistoricoAcessosSection() {
  const query = useQuery<AcessosResponse>({
    queryKey: acessosQueryKey,
    queryFn: async () => {
      const { data } = await axiosInstance.get<AcessosResponse>('/cidadao/conta/acessos');
      return data;
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner label="Carregando acessos..." />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="danger" title="Não foi possível carregar o histórico de acessos">
        Tente novamente em instantes.
      </Alert>
    );
  }

  const acessos = query.data?.data ?? [];

  if (acessos.length === 0) {
    return <p className="text-sm text-text-secondary">Nenhum acesso registrado ainda.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-card border border-neutral">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Últimos 10 acessos à sua conta</caption>
        <thead className="bg-bg-alt text-text-secondary">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Data
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Hora (UTC)
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Endereço IP
            </th>
          </tr>
        </thead>
        <tbody>
          {acessos.map((acesso, index) => (
            <tr key={`${acesso.data}-${acesso.hora}-${index}`} className="border-t border-neutral">
              <td className="px-4 py-3 text-text-primary">{formatarData(acesso.data)}</td>
              <td className="px-4 py-3 text-text-primary">{acesso.hora}</td>
              <td className="px-4 py-3 text-text-primary">{acesso.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default HistoricoAcessosSection;
