import type { ComponentType, SVGProps } from 'react';
import { Permissao, temPermissao } from '@auditar/shared';
import type { AuthUser } from '@/store/authStore';
import {
  BarChartIcon,
  CheckSquareIcon,
  FileTextIcon,
  GridIcon,
  HomeIcon,
  PlusCircleIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from './icons';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/** Item de navegação renderizado como `NavLink` na Sidebar. */
export interface NavItem {
  /** Rótulo exibido. */
  label: string;
  /** Rota de destino (react-router). */
  to: string;
  /** Ícone do item. */
  icon: IconType;
  /**
   * Marca a rota como correspondência exata (usado na home `/` e `/admin`,
   * que de outra forma casariam com todas as sub-rotas).
   */
  end?: boolean;
  /**
   * Permissão granular exigida para exibir o item. Ausente = sempre visível
   * para o perfil correspondente.
   */
  permissao?: Permissao;
}

/** Itens do Portal do Cidadão. */
export const cidadaoNav: NavItem[] = [
  { label: 'Meus Processos', to: '/processos', icon: FileTextIcon },
  { label: 'Novo Processo', to: '/processos/novo', icon: PlusCircleIcon },
  { label: 'Perfil', to: '/perfil', icon: UserIcon },
  { label: 'Configurações', to: '/configuracoes', icon: SettingsIcon },
];

/**
 * Itens do Painel Administrativo (Servidor). Itens com `permissao` só aparecem
 * quando o servidor possui a permissão granular correspondente.
 */
export const servidorNav: NavItem[] = [
  { label: 'Dashboard', to: '/admin', icon: HomeIcon, end: true },
  { label: 'Processos', to: '/admin/processos', icon: FileTextIcon },
  // Tarefas: visível a qualquer Servidor (todos podem ter tarefas atribuídas —
  // Req. 27.6). A criação é restrita no backend/UI a `GERENCIAR_TAREFAS`/Admin.
  { label: 'Tarefas', to: '/admin/tarefas', icon: CheckSquareIcon },
  {
    label: 'Configurações',
    to: '/admin/config',
    icon: SettingsIcon,
    permissao: Permissao.CONFIGURAR_FLUXOS,
  },
  {
    label: 'Servidores',
    to: '/admin/servidores',
    icon: UsersIcon,
    permissao: Permissao.GERENCIAR_USUARIOS,
  },
  {
    label: 'Relatórios',
    to: '/admin/relatorios',
    icon: BarChartIcon,
    permissao: Permissao.ACESSAR_RELATORIOS,
  },
  {
    label: 'Auditoria',
    to: '/admin/auditoria',
    icon: ShieldIcon,
    permissao: Permissao.ACESSAR_AUDITORIA,
  },
];

// Ícones adicionais reservados para sub-rotas de configuração (usados em
// tarefas posteriores 16.x); exportados para reuso.
export const configIcon = GridIcon;

/**
 * Resolve os itens de navegação visíveis para o usuário atual, aplicando o
 * filtro RBAC. Cidadãos recebem o menu do Portal; servidores recebem o menu do
 * Painel filtrado pela mesma regra do backend — nível de acesso (matriz RBAC)
 * combinado com permissões granulares. Assim o Administrador (nível 1) vê todos
 * os itens mesmo sem permissões granulares atribuídas. Sem usuário, nenhum item.
 */
export function getNavItems(user: AuthUser | null): NavItem[] {
  if (!user) return [];

  if (user.role === 'cidadao') {
    return cidadaoNav;
  }

  return servidorNav.filter(
    (item) => !item.permissao || temPermissao(user.nivel, user.permissions, item.permissao),
  );
}
