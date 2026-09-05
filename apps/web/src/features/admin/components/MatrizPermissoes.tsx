import { useEffect, useRef } from 'react';
import { NivelAcesso, Permissao } from '@auditar/shared';
import { Checkbox } from '@/components/ui';

/**
 * Matriz de Permissões Granulares (tarefa 26.1 — Req. 21.10, 21.11, 21.12, 21.13).
 *
 * Componente controlado que exibe as 14 permissões do enum `Permissao` como
 * toggles independentes com rótulos legíveis em pt-BR (Req. 21.11).
 *
 * Comportamento (Req. 21.12): ao trocar o nível de acesso, aplica o conjunto
 * DEFAULT de permissões daquele nível (pré-marca os padrões). Ajustes manuais
 * feitos depois da troca são preservados — o default só é reaplicado quando o
 * nível realmente muda, nunca a cada render.
 *
 * O conjunto de permissões marcado é enviado tal e qual para o backend via
 * `PUT /admin/servidores/:id/permissoes` (Req. 21.13), garantindo round-trip
 * exato do subconjunto selecionado.
 *
 * A edição só é permitida a quem possui `gerenciar_usuarios` ou nível
 * Administrador (Req. 21.10); o consumidor controla isso via `disabled`.
 */

/** Ordem estável das 14 permissões, espelhando a matriz RBAC do design. */
export const PERMISSOES_ORDEM: Permissao[] = [
  Permissao.VISUALIZAR,
  Permissao.EDITAR,
  Permissao.MOVER_ETAPA,
  Permissao.REJEITAR,
  Permissao.SOLICITAR_DOCUMENTOS,
  Permissao.OBSERVACAO_PUBLICA,
  Permissao.OBSERVACAO_INTERNA,
  Permissao.ACESSAR_RELATORIOS,
  Permissao.GERENCIAR_USUARIOS,
  Permissao.CONFIGURAR_FLUXOS,
  Permissao.ACESSAR_AUDITORIA,
  Permissao.ATRIBUIR,
  Permissao.APROVAR,
  Permissao.GERENCIAR_TAREFAS,
];

/** Rótulos legíveis em pt-BR para cada uma das 14 permissões (Req. 21.11). */
export const PERMISSOES_LABEL: Record<Permissao, string> = {
  [Permissao.VISUALIZAR]: 'Visualizar processos',
  [Permissao.EDITAR]: 'Editar processos',
  [Permissao.MOVER_ETAPA]: 'Avançar etapa',
  [Permissao.REJEITAR]: 'Rejeitar',
  [Permissao.SOLICITAR_DOCUMENTOS]: 'Solicitar documentos',
  [Permissao.OBSERVACAO_PUBLICA]: 'Registrar observação pública',
  [Permissao.OBSERVACAO_INTERNA]: 'Registrar observação interna',
  [Permissao.ACESSAR_RELATORIOS]: 'Acessar relatórios',
  [Permissao.GERENCIAR_USUARIOS]: 'Gerenciar usuários',
  [Permissao.CONFIGURAR_FLUXOS]: 'Configurar fluxos',
  [Permissao.ACESSAR_AUDITORIA]: 'Acessar auditoria',
  [Permissao.ATRIBUIR]: 'Atribuir / reatribuir',
  [Permissao.APROVAR]: 'Aprovar',
  [Permissao.GERENCIAR_TAREFAS]: 'Gerenciar tarefas',
};

/**
 * Conjunto DEFAULT de permissões concedidas por nível de acesso, derivado da
 * matriz "RBAC — Matrix de Permissões por Nível" do design.md.
 *
 * Apenas as ações marcadas com ✓ (concessão direta pelo nível) integram o
 * default. As marcadas com G* (dependem de configuração granular do
 * Administrador — Req. 8.6) NÃO entram no default e ficam a critério do
 * Administrador ativá-las manualmente.
 */
export const DEFAULTS_POR_NIVEL: Record<NivelAcesso, Permissao[]> = {
  // Administrador (1): todas as 14 permissões.
  [NivelAcesso.ADMINISTRADOR]: [...PERMISSOES_ORDEM],
  // Gestor Geral (2): visualizar + relatórios (gerenciar_tarefas é G*).
  [NivelAcesso.GESTOR_GERAL]: [Permissao.VISUALIZAR, Permissao.ACESSAR_RELATORIOS],
  // Gestor de Categoria (3): visualizar, obs. interna, relatórios, configurar fluxos.
  [NivelAcesso.GESTOR_CATEGORIA]: [
    Permissao.VISUALIZAR,
    Permissao.OBSERVACAO_INTERNA,
    Permissao.ACESSAR_RELATORIOS,
    Permissao.CONFIGURAR_FLUXOS,
  ],
  // Gestor de Unidade (4): operação completa da unidade.
  [NivelAcesso.GESTOR_UNIDADE]: [
    Permissao.VISUALIZAR,
    Permissao.EDITAR,
    Permissao.MOVER_ETAPA,
    Permissao.REJEITAR,
    Permissao.SOLICITAR_DOCUMENTOS,
    Permissao.OBSERVACAO_PUBLICA,
    Permissao.OBSERVACAO_INTERNA,
    Permissao.ACESSAR_RELATORIOS,
    Permissao.ATRIBUIR,
    Permissao.APROVAR,
    Permissao.GERENCIAR_TAREFAS,
  ],
  // Analista (5): tramitação básica (rejeitar/aprovar são G*).
  [NivelAcesso.ANALISTA]: [
    Permissao.VISUALIZAR,
    Permissao.EDITAR,
    Permissao.MOVER_ETAPA,
    Permissao.SOLICITAR_DOCUMENTOS,
    Permissao.OBSERVACAO_PUBLICA,
    Permissao.OBSERVACAO_INTERNA,
  ],
  // Inspetor (6): visualizar + observações.
  [NivelAcesso.INSPETOR]: [
    Permissao.VISUALIZAR,
    Permissao.OBSERVACAO_PUBLICA,
    Permissao.OBSERVACAO_INTERNA,
  ],
  // Visualizador (7): somente leitura.
  [NivelAcesso.VISUALIZADOR]: [Permissao.VISUALIZAR],
};

/**
 * Retorna o conjunto default de permissões (como `Set`) do nível informado.
 * Exportado para reuso/teste.
 */
export function defaultsDoNivel(nivel: NivelAcesso): Set<Permissao> {
  return new Set(DEFAULTS_POR_NIVEL[nivel] ?? []);
}

export interface MatrizPermissoesProps {
  /** Conjunto atual de permissões concedidas (componente controlado). */
  valor: Set<Permissao>;
  /** Chamado sempre que o conjunto de permissões concedidas muda. */
  onChange: (permissoes: Set<Permissao>) => void;
  /** Nível de acesso atualmente selecionado no formulário. */
  nivelAcesso: NivelAcesso;
  /**
   * Desabilita toda a matriz quando o usuário logado não pode editar
   * (sem `gerenciar_usuarios` e não Administrador — Req. 21.10).
   */
  disabled?: boolean;
}

/**
 * Matriz controlada de 14 toggles de permissão.
 *
 * A responsividade ao nível é implementada aqui: quando `nivelAcesso` muda em
 * relação ao render anterior, aplicamos o default do novo nível via `onChange`.
 * Como só reagimos à MUDANÇA (comparando com o valor anterior guardado em ref),
 * ajustes manuais posteriores não são sobrescritos a cada render (Req. 21.12).
 */
export function MatrizPermissoes({
  valor,
  onChange,
  nivelAcesso,
  disabled = false,
}: MatrizPermissoesProps) {
  const nivelAnteriorRef = useRef<NivelAcesso | null>(null);

  useEffect(() => {
    // Na primeira montagem apenas registramos o nível, sem sobrescrever o
    // `valor` recebido (que pode conter as permissões já persistidas do
    // servidor em edição).
    if (nivelAnteriorRef.current === null) {
      nivelAnteriorRef.current = nivelAcesso;
      return;
    }
    if (nivelAnteriorRef.current !== nivelAcesso) {
      nivelAnteriorRef.current = nivelAcesso;
      if (!disabled) {
        onChange(defaultsDoNivel(nivelAcesso));
      }
    }
  }, [nivelAcesso, disabled, onChange]);

  const toggle = (permissao: Permissao, checked: boolean) => {
    const proximo = new Set(valor);
    if (checked) proximo.add(permissao);
    else proximo.delete(permissao);
    onChange(proximo);
  };

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="text-sm font-medium text-text-primary">
        Permissões granulares
      </legend>
      <p className="text-sm text-text-secondary">
        Ao trocar o nível de acesso, aplicamos o conjunto padrão do nível. Você pode
        ajustar cada permissão individualmente — os ajustes manuais são preservados.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PERMISSOES_ORDEM.map((permissao) => (
          <Checkbox
            key={permissao}
            label={PERMISSOES_LABEL[permissao]}
            checked={valor.has(permissao)}
            disabled={disabled}
            onChange={(e) => toggle(permissao, e.target.checked)}
          />
        ))}
      </div>
    </fieldset>
  );
}

export default MatrizPermissoes;
