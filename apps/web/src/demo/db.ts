/**
 * Banco de dados em memória do MODO DEMONSTRAÇÃO.
 *
 * Usado apenas quando `VITE_DEMO_MODE=true`: o site funciona sem a API,
 * respondendo com estes dados fictícios. As alterações feitas durante a
 * apresentação ficam salvas no `localStorage` deste navegador (para sobreviver
 * à troca de usuário/logout) e podem ser descartadas com "Reiniciar dados".
 *
 * Todos os nomes, CPFs e documentos são fictícios.
 */

export const DIA_MS = 24 * 60 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface DemoServidor {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string | null;
  nivelAcesso: number;
  ativo: boolean;
  unidadeId: string;
  senha: string;
  permissoesExtras: string[];
  criadoEm: string;
}

export interface DemoCidadao {
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
  senha: string;
  doisFatoresAtivo: boolean;
}

export interface DemoUnidade {
  id: string;
  nome: string;
  secretaria: string;
  endereco: string;
  telefone: string;
  horarioFuncionamento: string;
  ativa: boolean;
  modoAtribuicao: string;
  gestorId: string | null;
  prefixoProtocolo: string;
  criadoEm: string;
}

export interface DemoCategoria {
  id: string;
  nome: string;
  descricao: string;
  icone: string | null;
  cor: string;
  secretaria: string;
  ativa: boolean;
  gestorId: string | null;
  prefixoProtocolo: string | null;
  criadoEm: string;
}

export interface DemoTipo {
  id: string;
  nome: string;
  prazoTotalDiasUteis: number;
  ativo: boolean;
  categoriaId: string;
  fluxoId: string;
  unidadesIds: string[];
  criadoEm: string;
}

export interface DemoAutomacao {
  id: string;
  etapaId: string;
  tipo: string;
  payload: string;
}

export interface DemoEtapa {
  id: string;
  nome: string;
  prazosDiasUteis: number;
  ordem: number;
  fluxoId: string;
  servidorPadraoId: string | null;
  documentosObrigatorios: string[];
  observacoesObrigatorias: string | null;
  automacoes: DemoAutomacao[];
  criadoEm: string;
}

export interface DemoFluxo {
  id: string;
  nome: string;
  versao: number;
  criadoEm: string;
  criadoPorId: string;
  etapas: DemoEtapa[];
}

export interface DemoCampo {
  id: string;
  formularioId: string;
  tipo: string;
  rotulo: string;
  descricaoAuxiliar: string | null;
  obrigatorio: boolean;
  validacao: string | null;
  valorPadrao: string | null;
  ordem: number;
  opcoes: string[] | null;
}

export interface DemoFormulario {
  id: string;
  tipoProcessoId: string;
  unidadeId: string;
  ativo: boolean;
  criadoEm: string;
  criadoPorId: string;
  campos: DemoCampo[];
}

export interface DemoMovimentacao {
  etapaOrigemId: string | null;
  etapaDestinoId: string | null;
  acao: string;
  observacao: string | null;
  tipoObservacao: 'interna' | 'publica' | null;
  realizadoEm: string;
  servidorId: string | null;
}

export interface DemoMensagem {
  id: string;
  canal: 'publico' | 'interno';
  conteudo: string;
  remetenteCidadaoId: string | null;
  remetenteServidorId: string | null;
  destinatarioServidorId: string | null;
  caminhoAnexo: string | null;
  enviadaEm: string;
}

export interface DemoDocumento {
  id: string;
  nomeOriginal: string;
  mimeType: string;
  tamanhoBytes: number;
  enviadoPorCidadao: boolean;
  enviadoPorId: string;
  enviadoEm: string;
}

export interface DemoProcesso {
  id: string;
  protocolo: string;
  status: string;
  prioridade: number;
  cidadaoId: string;
  tipoProcessoId: string;
  unidadeId: string;
  servidorResponsavelId: string | null;
  etapaAtualId: string | null;
  abertoEm: string;
  prazoFinal: string;
  encerradoEm: string | null;
  atualizadoEm: string;
  respostas: Array<{ campoId: string; valor: string }>;
  movimentacoes: DemoMovimentacao[];
  mensagens: DemoMensagem[];
  documentos: DemoDocumento[];
  documentosSolicitados: string[];
}

export interface DemoAuditoria {
  id: string;
  ator: 'cidadao' | 'servidor' | 'sistema';
  atorCidadaoId: string | null;
  atorServidorId: string | null;
  enderecoIp: string;
  tipoAcao: string;
  modulo: string;
  objetoId: string | null;
  tipoObjeto: string | null;
  valorAnterior: string | null;
  valorPosterior: string | null;
  realizadaEmUtc: string;
}

export interface DemoTarefaAtribuicao {
  id: string;
  tarefaId: string;
  servidorId: string;
  status: string;
  concluidaEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

export interface DemoTarefa {
  id: string;
  titulo: string;
  descricao: string | null;
  status: string;
  prioridade: number | null;
  criadoPorId: string;
  processoId: string | null;
  prazo: string;
  criadoEm: string;
  atualizadoEm: string;
  atribuicoes: DemoTarefaAtribuicao[];
}

export interface DemoDb {
  versao: number;
  seq: number;
  servidores: DemoServidor[];
  cidadaos: DemoCidadao[];
  unidades: DemoUnidade[];
  categorias: DemoCategoria[];
  tipos: DemoTipo[];
  fluxos: DemoFluxo[];
  formularios: DemoFormulario[];
  processos: DemoProcesso[];
  auditoria: DemoAuditoria[];
  tarefas: DemoTarefa[];
  preferencias: {
    preferencias: Array<{ tipoEvento: string; canais: string[] }>;
    inicioSilencio: string | null;
    fimSilencio: string | null;
  };
}

// ---------------------------------------------------------------------------
// Utilitários de data
// ---------------------------------------------------------------------------

/** Data ISO relativa a "agora" (dias negativos = passado). */
export function diasAtras(dias: number, horas = 0): string {
  return new Date(Date.now() - dias * DIA_MS - horas * HORA_MS).toISOString();
}

/** Soma dias úteis (seg–sex) a uma data ISO. */
export function somarDiasUteis(iso: string, dias: number): string {
  const d = new Date(iso);
  let restantes = dias;
  while (restantes > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) restantes -= 1;
  }
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Dados fixos (seed)
// ---------------------------------------------------------------------------

const TODAS_PERMISSOES_ANALISTA = [
  'visualizar',
  'editar',
  'mover_etapa',
  'solicitar_documentos',
  'observacao_publica',
  'observacao_interna',
  'aprovar',
  'rejeitar',
  'atribuir',
];

function criarServidores(): DemoServidor[] {
  const base = diasAtras(400);
  return [
    { id: 'srv-admin', nome: 'Administrador do Sistema', cpf: '00000000000', email: 'admin@prefeitura.demo', telefone: '7932110000', nivelAcesso: 1, ativo: true, unidadeId: 'uni-central', senha: 'Admin@123', permissoesExtras: [], criadoEm: base },
    { id: 'srv-ana', nome: 'Ana Beatriz Souza', cpf: '11111111111', email: 'ana.souza@prefeitura.demo', telefone: '7932110001', nivelAcesso: 5, ativo: true, unidadeId: 'uni-obras', senha: 'Analista@123', permissoesExtras: TODAS_PERMISSOES_ANALISTA, criadoEm: base },
    { id: 'srv-carlos', nome: 'Carlos Eduardo Menezes', cpf: '33333333333', email: 'carlos.menezes@prefeitura.demo', telefone: '7932110002', nivelAcesso: 4, ativo: true, unidadeId: 'uni-obras', senha: 'Gestor@123', permissoesExtras: [], criadoEm: base },
    { id: 'srv-mariana', nome: 'Mariana Alves Rocha', cpf: '44444444444', email: 'mariana.rocha@prefeitura.demo', telefone: '7932110003', nivelAcesso: 5, ativo: true, unidadeId: 'uni-tributos', senha: 'Analista@123', permissoesExtras: TODAS_PERMISSOES_ANALISTA, criadoEm: base },
    { id: 'srv-roberto', nome: 'Roberto Lima Franco', cpf: '55555555555', email: 'roberto.franco@prefeitura.demo', telefone: '7932110004', nivelAcesso: 5, ativo: true, unidadeId: 'uni-saude', senha: 'Analista@123', permissoesExtras: TODAS_PERMISSOES_ANALISTA, criadoEm: base },
    { id: 'srv-juliana', nome: 'Juliana Ferreira Dias', cpf: '66666666666', email: 'juliana.dias@prefeitura.demo', telefone: '7932110005', nivelAcesso: 5, ativo: true, unidadeId: 'uni-central', senha: 'Analista@123', permissoesExtras: TODAS_PERMISSOES_ANALISTA, criadoEm: base },
    { id: 'srv-helena', nome: 'Helena Martins Prado', cpf: '77777777777', email: 'helena.prado@prefeitura.demo', telefone: null, nivelAcesso: 2, ativo: true, unidadeId: 'uni-central', senha: 'Gestor@123', permissoesExtras: [], criadoEm: base },
    { id: 'srv-otavio', nome: 'Otávio Nunes Barreto', cpf: '88888888888', email: 'otavio.barreto@prefeitura.demo', telefone: null, nivelAcesso: 7, ativo: false, unidadeId: 'uni-tributos', senha: 'Analista@123', permissoesExtras: [], criadoEm: base },
  ];
}

function criarCidadaos(): DemoCidadao[] {
  const c = (id: string, nome: string, cpf: string, email: string, logradouro: string, numero: string): DemoCidadao => ({
    id, nome, cpf, email, telefone: '79988887777', logradouro, numero, cep: '49000000', cidade: 'Aracaju', estado: 'SE', senha: 'Cidadao@123', doisFatoresAtivo: false,
  });
  return [
    c('cid-joao', 'João da Silva', '22222222222', 'joao.silva@email.demo', 'Rua das Laranjeiras', '120'),
    c('cid-maria', 'Maria Aparecida Oliveira', '12345678909', 'maria.oliveira@email.demo', 'Av. Beira Mar', '1500'),
    c('cid-pedro', 'Pedro Henrique Santos', '98765432100', 'pedro.santos@email.demo', 'Rua Itabaiana', '45'),
    c('cid-luiza', 'Luiza Costa Ribeiro', '11144477735', 'luiza.ribeiro@email.demo', 'Rua Laranjeiras', '890'),
    c('cid-rafael', 'Rafael Gomes Pereira', '52998224725', 'rafael.pereira@email.demo', 'Av. Hermes Fontes', '310'),
    c('cid-fernanda', 'Fernanda Lima Barros', '39053344705', 'fernanda.barros@email.demo', 'Rua Santa Luzia', '77'),
    c('cid-antonio', 'Antônio Carlos Mendes', '71428793860', 'antonio.mendes@email.demo', 'Rua Pacatuba', '12'),
    c('cid-camila', 'Camila Rodrigues Nascimento', '16899535009', 'camila.nascimento@email.demo', 'Av. Augusto Franco', '2200'),
  ];
}

function criarUnidades(): DemoUnidade[] {
  const u = (id: string, nome: string, secretaria: string, endereco: string, gestorId: string | null, prefixo: string): DemoUnidade => ({
    id, nome, secretaria, endereco, telefone: '7932110100', horarioFuncionamento: 'Seg a Sex, 8h às 14h', ativa: true, modoAtribuicao: 'manual', gestorId, prefixoProtocolo: prefixo, criadoEm: diasAtras(400),
  });
  return [
    u('uni-central', 'Central de Atendimento ao Cidadão', 'Secretaria de Administração', 'Praça General Valadão, s/n — Centro', 'srv-helena', 'CAC'),
    u('uni-obras', 'Protocolo de Obras e Licenciamento', 'Secretaria de Obras e Urbanismo', 'Rua Frei Paulo, 400 — Centro', 'srv-carlos', 'OBR'),
    u('uni-tributos', 'Setor de Tributos', 'Secretaria da Fazenda', 'Rua Itabaianinha, 50 — Centro', null, 'TRB'),
    u('uni-saude', 'Vigilância Sanitária', 'Secretaria de Saúde', 'Av. Desembargador Maynard, 210', null, 'VIS'),
    u('uni-ambiente', 'Gerência de Meio Ambiente', 'Secretaria do Meio Ambiente', 'Rua Lagarto, 960 — São José', null, 'AMB'),
  ];
}

function criarCategorias(): DemoCategoria[] {
  const c = (id: string, nome: string, descricao: string, cor: string, secretaria: string): DemoCategoria => ({
    id, nome, descricao, icone: null, cor, secretaria, ativa: true, gestorId: null, prefixoProtocolo: null, criadoEm: diasAtras(400),
  });
  return [
    c('cat-obras', 'Obras e Urbanismo', 'Licenças, alvarás e regularização de imóveis', '#1d4ed8', 'Secretaria de Obras e Urbanismo'),
    c('cat-tributos', 'Tributos e Finanças', 'IPTU, ISS, certidões e parcelamentos', '#0f766e', 'Secretaria da Fazenda'),
    c('cat-saude', 'Saúde e Vigilância', 'Licenças sanitárias e denúncias', '#be123c', 'Secretaria de Saúde'),
    c('cat-ambiente', 'Meio Ambiente', 'Poda, supressão de árvores e licenças ambientais', '#15803d', 'Secretaria do Meio Ambiente'),
    c('cat-servicos', 'Serviços Urbanos', 'Iluminação, vias públicas e limpeza', '#b45309', 'Secretaria de Administração'),
  ];
}

interface EtapaSeed {
  nome: string;
  prazo: number;
  docs?: string[];
}

function fluxo(id: string, nome: string, etapas: EtapaSeed[]): DemoFluxo {
  return {
    id,
    nome,
    versao: 1,
    criadoEm: diasAtras(380),
    criadoPorId: 'srv-admin',
    etapas: etapas.map((e, i) => ({
      id: `${id}-e${i + 1}`,
      nome: e.nome,
      prazosDiasUteis: e.prazo,
      ordem: i + 1,
      fluxoId: id,
      servidorPadraoId: null,
      documentosObrigatorios: e.docs ?? [],
      observacoesObrigatorias: null,
      automacoes:
        i === 0
          ? [{ id: `${id}-e1-a1`, etapaId: `${id}-e1`, tipo: 'email_cidadao', payload: 'Recebemos sua solicitação e ela já está em análise.' }]
          : [],
      criadoEm: diasAtras(380),
    })),
  };
}

function criarFluxos(): DemoFluxo[] {
  return [
    fluxo('flx-alvara', 'Licenciamento de obra', [
      { nome: 'Triagem documental', prazo: 3, docs: ['Projeto arquitetônico', 'ART/RRT do responsável técnico'] },
      { nome: 'Análise técnica', prazo: 10 },
      { nome: 'Vistoria no local', prazo: 7 },
      { nome: 'Emissão do alvará', prazo: 5 },
    ]),
    fluxo('flx-habitese', 'Habite-se', [
      { nome: 'Triagem documental', prazo: 3 },
      { nome: 'Vistoria final', prazo: 10 },
      { nome: 'Emissão do habite-se', prazo: 5 },
    ]),
    fluxo('flx-certidao', 'Emissão de certidão', [
      { nome: 'Conferência cadastral', prazo: 2 },
      { nome: 'Emissão', prazo: 3 },
    ]),
    fluxo('flx-iptu', 'Revisão de IPTU', [
      { nome: 'Triagem', prazo: 3 },
      { nome: 'Análise fiscal', prazo: 15 },
      { nome: 'Decisão', prazo: 7 },
    ]),
    fluxo('flx-sanitario', 'Licença sanitária', [
      { nome: 'Triagem documental', prazo: 3, docs: ['Contrato social', 'Planta baixa do estabelecimento'] },
      { nome: 'Inspeção sanitária', prazo: 8 },
      { nome: 'Emissão da licença', prazo: 4 },
    ]),
    fluxo('flx-poda', 'Poda e supressão de árvore', [
      { nome: 'Avaliação técnica', prazo: 5 },
      { nome: 'Execução do serviço', prazo: 10 },
    ]),
    fluxo('flx-via', 'Manutenção urbana', [
      { nome: 'Triagem', prazo: 2 },
      { nome: 'Programação da equipe', prazo: 5 },
      { nome: 'Execução', prazo: 8 },
    ]),
  ];
}

function criarTipos(): DemoTipo[] {
  const t = (id: string, nome: string, prazo: number, categoriaId: string, fluxoId: string, unidadesIds: string[]): DemoTipo => ({
    id, nome, prazoTotalDiasUteis: prazo, ativo: true, categoriaId, fluxoId, unidadesIds, criadoEm: diasAtras(380),
  });
  return [
    t('tp-alvara', 'Alvará de construção', 25, 'cat-obras', 'flx-alvara', ['uni-obras']),
    t('tp-habitese', 'Habite-se', 18, 'cat-obras', 'flx-habitese', ['uni-obras']),
    t('tp-certidao', 'Certidão negativa de débitos', 5, 'cat-tributos', 'flx-certidao', ['uni-tributos', 'uni-central']),
    t('tp-iptu', 'Revisão do valor do IPTU', 25, 'cat-tributos', 'flx-iptu', ['uni-tributos']),
    t('tp-sanitario', 'Alvará sanitário', 15, 'cat-saude', 'flx-sanitario', ['uni-saude']),
    t('tp-poda', 'Poda ou supressão de árvore', 15, 'cat-ambiente', 'flx-poda', ['uni-ambiente', 'uni-central']),
    t('tp-via', 'Reparo de via pública (buraco)', 15, 'cat-servicos', 'flx-via', ['uni-central']),
    t('tp-iluminacao', 'Troca de lâmpada em poste', 15, 'cat-servicos', 'flx-via', ['uni-central']),
  ];
}

/** Campos do formulário por tipo. O `id` do campo é o próprio rótulo, para que as respostas apareçam legíveis. */
const CAMPOS_POR_TIPO: Record<string, Array<Omit<DemoCampo, 'id' | 'formularioId' | 'ordem'>>> = {
  'tp-alvara': [
    { tipo: 'texto_curto', rotulo: 'Endereço da obra', descricaoAuxiliar: 'Rua, número e bairro', obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'texto_curto', rotulo: 'Inscrição imobiliária', descricaoAuxiliar: 'Consta no carnê do IPTU', obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'selecao_unica', rotulo: 'Tipo de obra', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: ['Construção nova', 'Reforma', 'Ampliação', 'Demolição'] },
    { tipo: 'numero', rotulo: 'Área construída (m²)', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'texto_longo', rotulo: 'Descrição da obra', descricaoAuxiliar: null, obrigatorio: false, validacao: null, valorPadrao: null, opcoes: null },
  ],
  'tp-habitese': [
    { tipo: 'texto_curto', rotulo: 'Endereço do imóvel', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'texto_curto', rotulo: 'Número do alvará de construção', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'data', rotulo: 'Data de conclusão da obra', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
  ],
  'tp-certidao': [
    { tipo: 'selecao_unica', rotulo: 'Finalidade', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: ['Licitação', 'Financiamento', 'Compra e venda de imóvel', 'Outros'] },
    { tipo: 'texto_curto', rotulo: 'Inscrição imobiliária (opcional)', descricaoAuxiliar: null, obrigatorio: false, validacao: null, valorPadrao: null, opcoes: null },
  ],
  'tp-iptu': [
    { tipo: 'texto_curto', rotulo: 'Inscrição imobiliária', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'selecao_unica', rotulo: 'Motivo da revisão', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: ['Área divergente', 'Padrão construtivo', 'Imóvel demolido', 'Outro'] },
    { tipo: 'texto_longo', rotulo: 'Justificativa', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
  ],
  'tp-sanitario': [
    { tipo: 'texto_curto', rotulo: 'Razão social', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'texto_curto', rotulo: 'CNPJ', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'selecao_unica', rotulo: 'Ramo de atividade', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: ['Restaurante', 'Padaria', 'Mercado', 'Farmácia', 'Salão de beleza'] },
  ],
  'tp-poda': [
    { tipo: 'texto_curto', rotulo: 'Endereço da árvore', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'selecao_unica', rotulo: 'Serviço solicitado', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: ['Poda', 'Supressão (remoção)'] },
    { tipo: 'texto_longo', rotulo: 'Motivo', descricaoAuxiliar: 'Ex.: galhos na fiação, risco de queda', obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
  ],
  'tp-via': [
    { tipo: 'texto_curto', rotulo: 'Endereço / ponto de referência', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'texto_longo', rotulo: 'Descrição do problema', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
  ],
  'tp-iluminacao': [
    { tipo: 'texto_curto', rotulo: 'Endereço do poste', descricaoAuxiliar: null, obrigatorio: true, validacao: null, valorPadrao: null, opcoes: null },
    { tipo: 'texto_curto', rotulo: 'Número da plaqueta do poste', descricaoAuxiliar: 'Se houver', obrigatorio: false, validacao: null, valorPadrao: null, opcoes: null },
  ],
};

function criarFormularios(tipos: DemoTipo[]): DemoFormulario[] {
  const lista: DemoFormulario[] = [];
  for (const tipo of tipos) {
    for (const unidadeId of tipo.unidadesIds) {
      const id = `frm-${tipo.id}-${unidadeId}`;
      lista.push({
        id,
        tipoProcessoId: tipo.id,
        unidadeId,
        ativo: true,
        criadoEm: diasAtras(370),
        criadoPorId: 'srv-admin',
        campos: (CAMPOS_POR_TIPO[tipo.id] ?? []).map((c, i) => ({ ...c, id: c.rotulo, formularioId: id, ordem: i + 1 })),
      });
    }
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Processos de exemplo
// ---------------------------------------------------------------------------

interface ProcessoSeed {
  cidadaoId: string;
  tipoId: string;
  unidadeId: string;
  /** Dias desde a abertura. */
  diasAtras: number;
  status: string;
  /** Índice (0-based) da etapa atual; -1 = sem etapa (encerrado). */
  etapa: number;
  servidorId: string | null;
  prioridade?: number;
  respostas: string[];
  docsSolicitados?: string[];
  mensagens?: Array<{ deCidadao: boolean; texto: string; diasAtras: number }>;
  internas?: Array<{ servidorId: string; texto: string; diasAtras: number }>;
  documentos?: string[];
  /** Força o prazo final (dias a partir de hoje, pode ser negativo). */
  prazoEmDias?: number;
}

const SEEDS: ProcessoSeed[] = [
  // --- Processos do cidadão de demonstração (João) ---
  {
    cidadaoId: 'cid-joao', tipoId: 'tp-alvara', unidadeId: 'uni-obras', diasAtras: 12, status: 'em_andamento', etapa: 1, servidorId: 'srv-ana', prioridade: 1,
    respostas: ['Rua das Laranjeiras, 120 — Centro', '01.234.0567.001', 'Ampliação', '68', 'Ampliação de um quarto e uma área de serviço nos fundos do imóvel.'],
    documentos: ['projeto-arquitetonico.pdf', 'art-responsavel-tecnico.pdf', 'escritura-imovel.pdf'],
    mensagens: [
      { deCidadao: true, texto: 'Bom dia! Gostaria de saber se falta algum documento para a análise.', diasAtras: 6 },
      { deCidadao: false, texto: 'Bom dia, Sr. João. A documentação está completa e o projeto já está em análise técnica. Avisaremos sobre a vistoria.', diasAtras: 5 },
    ],
    internas: [{ servidorId: 'srv-ana', texto: 'Projeto dentro do recuo mínimo. Agendar vistoria após parecer técnico.', diasAtras: 4 }],
  },
  {
    cidadaoId: 'cid-joao', tipoId: 'tp-certidao', unidadeId: 'uni-tributos', diasAtras: 40, status: 'finalizado', etapa: -1, servidorId: 'srv-mariana',
    respostas: ['Financiamento', '01.234.0567.001'], documentos: ['certidao-negativa-debitos.pdf'],
  },
  {
    cidadaoId: 'cid-joao', tipoId: 'tp-poda', unidadeId: 'uni-central', diasAtras: 5, status: 'aguardando_docs', etapa: 0, servidorId: 'srv-juliana',
    respostas: ['Rua das Laranjeiras, em frente ao nº 120', 'Poda', 'Galhos encostando na rede elétrica e no telhado vizinho.'],
    docsSolicitados: ['Foto da árvore mostrando os galhos'],
    mensagens: [{ deCidadao: false, texto: 'Para avaliarmos a poda, envie uma foto da árvore mostrando os galhos próximos à fiação.', diasAtras: 3 }],
  },
  {
    cidadaoId: 'cid-joao', tipoId: 'tp-via', unidadeId: 'uni-central', diasAtras: 1, status: 'aberto', etapa: 0, servidorId: null,
    respostas: ['Rua Pacatuba, próximo à praça', 'Buraco grande no meio da pista, risco para motociclistas.'],
  },
  // --- Demais cidadãos ---
  { cidadaoId: 'cid-maria', tipoId: 'tp-alvara', unidadeId: 'uni-obras', diasAtras: 20, status: 'em_andamento', etapa: 2, servidorId: 'srv-ana', prioridade: 2, respostas: ['Av. Beira Mar, 1500', '02.111.0001.010', 'Construção nova', '240', 'Residência unifamiliar de dois pavimentos.'], documentos: ['projeto.pdf', 'art.pdf'] },
  { cidadaoId: 'cid-pedro', tipoId: 'tp-habitese', unidadeId: 'uni-obras', diasAtras: 30, status: 'vencido', etapa: 1, servidorId: 'srv-ana', prioridade: 2, respostas: ['Rua Itabaiana, 45', 'ALV-2026-0087', diasAtras(35).slice(0, 10)], prazoEmDias: -3 },
  { cidadaoId: 'cid-luiza', tipoId: 'tp-iptu', unidadeId: 'uni-tributos', diasAtras: 15, status: 'em_andamento', etapa: 1, servidorId: 'srv-mariana', respostas: ['03.222.0450.002', 'Área divergente', 'A área cadastrada (180 m²) é maior que a área real do imóvel (132 m²).'] },
  { cidadaoId: 'cid-rafael', tipoId: 'tp-sanitario', unidadeId: 'uni-saude', diasAtras: 9, status: 'aguardando_cidadao', etapa: 1, servidorId: 'srv-roberto', respostas: ['Sabor do Nordeste Restaurante LTDA', '12.345.678/0001-90', 'Restaurante'], mensagens: [{ deCidadao: false, texto: 'Inspeção realizada. Necessário adequar a ventilação da cozinha. Informe quando a adequação estiver concluída.', diasAtras: 2 }] },
  { cidadaoId: 'cid-fernanda', tipoId: 'tp-certidao', unidadeId: 'uni-central', diasAtras: 3, status: 'aprovado', etapa: -1, servidorId: 'srv-juliana', respostas: ['Licitação', ''] },
  { cidadaoId: 'cid-antonio', tipoId: 'tp-poda', unidadeId: 'uni-ambiente', diasAtras: 25, status: 'rejeitado', etapa: -1, servidorId: null, respostas: ['Rua Lagarto, 300', 'Supressão (remoção)', 'A árvore suja a calçada.'] },
  { cidadaoId: 'cid-camila', tipoId: 'tp-iluminacao', unidadeId: 'uni-central', diasAtras: 2, status: 'em_andamento', etapa: 1, servidorId: 'srv-juliana', respostas: ['Av. Augusto Franco, 2200', 'P-55821'] },
  { cidadaoId: 'cid-maria', tipoId: 'tp-certidao', unidadeId: 'uni-tributos', diasAtras: 1, status: 'aberto', etapa: 0, servidorId: null, respostas: ['Compra e venda de imóvel', '02.111.0001.010'] },
  { cidadaoId: 'cid-pedro', tipoId: 'tp-via', unidadeId: 'uni-central', diasAtras: 8, status: 'em_andamento', etapa: 2, servidorId: 'srv-juliana', respostas: ['Rua Itabaiana x Rua Laranjeiras', 'Afundamento do asfalto após chuvas.'] },
  { cidadaoId: 'cid-luiza', tipoId: 'tp-alvara', unidadeId: 'uni-obras', diasAtras: 4, status: 'aberto', etapa: 0, servidorId: null, prioridade: 1, respostas: ['Rua Laranjeiras, 890', '03.222.0450.002', 'Reforma', '95', 'Troca de cobertura e reforma da fachada.'] },
  { cidadaoId: 'cid-rafael', tipoId: 'tp-iptu', unidadeId: 'uni-tributos', diasAtras: 60, status: 'finalizado', etapa: -1, servidorId: 'srv-mariana', respostas: ['04.010.0090.001', 'Padrão construtivo', 'Imóvel classificado como padrão alto, porém é padrão médio.'] },
  { cidadaoId: 'cid-fernanda', tipoId: 'tp-sanitario', unidadeId: 'uni-saude', diasAtras: 18, status: 'em_andamento', etapa: 1, servidorId: 'srv-roberto', respostas: ['Pão Quente Padaria ME', '98.765.432/0001-10', 'Padaria'], prazoEmDias: 1 },
  { cidadaoId: 'cid-antonio', tipoId: 'tp-habitese', unidadeId: 'uni-obras', diasAtras: 45, status: 'aprovado', etapa: -1, servidorId: 'srv-ana', respostas: ['Rua Pacatuba, 12', 'ALV-2025-0412', diasAtras(50).slice(0, 10)] },
  { cidadaoId: 'cid-camila', tipoId: 'tp-poda', unidadeId: 'uni-central', diasAtras: 11, status: 'aguardando_docs', etapa: 0, servidorId: 'srv-juliana', respostas: ['Av. Augusto Franco, em frente ao nº 2200', 'Poda', 'Árvore cobrindo a iluminação pública.'], docsSolicitados: ['Foto da árvore'] },
  { cidadaoId: 'cid-maria', tipoId: 'tp-iluminacao', unidadeId: 'uni-central', diasAtras: 35, status: 'finalizado', etapa: -1, servidorId: 'srv-juliana', respostas: ['Av. Beira Mar, 1500', ''] },
  { cidadaoId: 'cid-pedro', tipoId: 'tp-certidao', unidadeId: 'uni-tributos', diasAtras: 14, status: 'finalizado', etapa: -1, servidorId: 'srv-mariana', respostas: ['Outros', ''] },
  { cidadaoId: 'cid-luiza', tipoId: 'tp-via', unidadeId: 'uni-central', diasAtras: 22, status: 'vencido', etapa: 1, servidorId: 'srv-juliana', prioridade: 2, respostas: ['Rua Laranjeiras, 890', 'Bueiro sem tampa na calçada.'], prazoEmDias: -2 },
];

const STATUS_ENCERRADOS = new Set(['aprovado', 'rejeitado', 'finalizado']);

function criarProcessos(
  tipos: DemoTipo[],
  fluxos: DemoFluxo[],
  formularios: DemoFormulario[],
  unidades: DemoUnidade[],
): DemoProcesso[] {
  const contadorPorPrefixo: Record<string, number> = {};
  const ano = new Date().getFullYear();

  // Ordem cronológica para que o protocolo cresça com a data de abertura.
  const ordenados = [...SEEDS].sort((a, b) => b.diasAtras - a.diasAtras);

  return ordenados.map((s, idx) => {
    const tipo = tipos.find((t) => t.id === s.tipoId)!;
    const fl = fluxos.find((f) => f.id === tipo.fluxoId)!;
    const unidade = unidades.find((u) => u.id === s.unidadeId)!;
    const form = formularios.find((f) => f.tipoProcessoId === tipo.id && f.unidadeId === s.unidadeId);
    const prefixo = unidade.prefixoProtocolo;
    contadorPorPrefixo[prefixo] = (contadorPorPrefixo[prefixo] ?? 120) + 7;
    const protocolo = `${prefixo}-${ano}-${String(contadorPorPrefixo[prefixo]).padStart(5, '0')}`;

    const abertoEm = diasAtras(s.diasAtras, 3 + (idx % 5));
    const prazoFinal =
      s.prazoEmDias !== undefined
        ? new Date(Date.now() + s.prazoEmDias * DIA_MS).toISOString()
        : somarDiasUteis(abertoEm, tipo.prazoTotalDiasUteis);
    const encerrado = STATUS_ENCERRADOS.has(s.status);
    const rejeitado = s.status === 'rejeitado';
    const etapasPercorridas = rejeitado ? 1 : encerrado ? fl.etapas.length : Math.max(0, s.etapa);

    // Movimentações: abertura + uma por etapa já concluída.
    const movimentacoes: DemoMovimentacao[] = [
      { etapaOrigemId: null, etapaDestinoId: fl.etapas[0]!.id, acao: 'Processo aberto', observacao: null, tipoObservacao: null, realizadoEm: abertoEm, servidorId: null },
    ];
    const passo = s.diasAtras / (etapasPercorridas + 1);
    for (let i = 0; i < etapasPercorridas; i += 1) {
      const origem = fl.etapas[i]!;
      const ultima = (rejeitado && i === etapasPercorridas - 1) || i + 1 >= fl.etapas.length;
      const destino = ultima ? null : fl.etapas[i + 1]!;
      let acao = `Avançou de "${origem.nome}" para "${destino?.nome ?? ''}"`;
      if (ultima) {
        acao = s.status === 'rejeitado' ? 'Processo indeferido' : s.status === 'aprovado' ? 'Processo deferido' : 'Processo concluído';
      }
      movimentacoes.push({
        etapaOrigemId: origem.id,
        etapaDestinoId: destino?.id ?? null,
        acao,
        observacao: ultima && s.status === 'rejeitado' ? 'Supressão não autorizada: a árvore é saudável e não oferece risco.' : null,
        tipoObservacao: ultima && s.status === 'rejeitado' ? 'publica' : null,
        realizadoEm: diasAtras(Math.max(0, s.diasAtras - passo * (i + 1))),
        servidorId: s.servidorId ?? 'srv-helena',
      });
    }

    const mensagens: DemoMensagem[] = [];
    (s.mensagens ?? []).forEach((m, i) => {
      mensagens.push({
        id: `msg-${idx}-${i}`,
        canal: 'publico',
        conteudo: m.texto,
        remetenteCidadaoId: m.deCidadao ? s.cidadaoId : null,
        remetenteServidorId: m.deCidadao ? null : s.servidorId,
        destinatarioServidorId: null,
        caminhoAnexo: null,
        enviadaEm: diasAtras(m.diasAtras, 2),
      });
    });
    (s.internas ?? []).forEach((m, i) => {
      mensagens.push({
        id: `int-${idx}-${i}`,
        canal: 'interno',
        conteudo: m.texto,
        remetenteCidadaoId: null,
        remetenteServidorId: m.servidorId,
        destinatarioServidorId: null,
        caminhoAnexo: null,
        enviadaEm: diasAtras(m.diasAtras, 1),
      });
    });

    const documentos: DemoDocumento[] = (s.documentos ?? []).map((nome, i) => ({
      id: `doc-${idx}-${i}`,
      nomeOriginal: nome,
      mimeType: 'application/pdf',
      tamanhoBytes: 180_000 + i * 97_000,
      enviadoPorCidadao: !nome.startsWith('certidao'),
      enviadoPorId: nome.startsWith('certidao') ? s.servidorId ?? 'srv-admin' : s.cidadaoId,
      enviadoEm: nome.startsWith('certidao') ? diasAtras(Math.max(0, s.diasAtras - 2)) : abertoEm,
    }));

    return {
      id: `proc-${idx + 1}`,
      protocolo,
      status: s.status,
      prioridade: s.prioridade ?? 0,
      cidadaoId: s.cidadaoId,
      tipoProcessoId: tipo.id,
      unidadeId: s.unidadeId,
      servidorResponsavelId: s.servidorId,
      etapaAtualId: encerrado ? null : fl.etapas[Math.max(0, s.etapa)]!.id,
      abertoEm,
      prazoFinal,
      encerradoEm: encerrado ? diasAtras(Math.max(0, s.diasAtras - passo * etapasPercorridas)) : null,
      atualizadoEm: movimentacoes[movimentacoes.length - 1]!.realizadoEm,
      respostas: (form?.campos ?? []).map((c, i) => ({ campoId: c.id, valor: s.respostas[i] ?? '' })).filter((r) => r.valor !== ''),
      movimentacoes,
      mensagens,
      documentos,
      documentosSolicitados: s.docsSolicitados ?? [],
    };
  });
}

function criarAuditoria(processos: DemoProcesso[]): DemoAuditoria[] {
  const logs: DemoAuditoria[] = [];
  let n = 0;
  const add = (l: Omit<DemoAuditoria, 'id'>) => {
    n += 1;
    logs.push({ ...l, id: `aud-${n}` });
  };
  for (const p of processos) {
    add({ ator: 'cidadao', atorCidadaoId: p.cidadaoId, atorServidorId: null, enderecoIp: '177.38.12.40', tipoAcao: 'abrir_processo', modulo: 'processos', objetoId: p.id, tipoObjeto: 'Processo', valorAnterior: null, valorPosterior: p.protocolo, realizadaEmUtc: p.abertoEm });
    if (p.servidorResponsavelId) {
      add({ ator: 'servidor', atorCidadaoId: null, atorServidorId: 'srv-carlos', enderecoIp: '10.0.0.15', tipoAcao: 'atribuir_processo', modulo: 'processos', objetoId: p.id, tipoObjeto: 'Processo', valorAnterior: null, valorPosterior: p.servidorResponsavelId, realizadaEmUtc: new Date(new Date(p.abertoEm).getTime() + 2 * HORA_MS).toISOString() });
    }
    for (const m of p.movimentacoes.slice(1)) {
      add({ ator: 'servidor', atorCidadaoId: null, atorServidorId: m.servidorId, enderecoIp: '10.0.0.21', tipoAcao: 'mover_etapa', modulo: 'processos', objetoId: p.id, tipoObjeto: 'Processo', valorAnterior: m.etapaOrigemId, valorPosterior: m.etapaDestinoId, realizadaEmUtc: m.realizadoEm });
    }
  }
  for (let d = 0; d < 20; d += 1) {
    add({ ator: 'servidor', atorCidadaoId: null, atorServidorId: d % 2 ? 'srv-ana' : 'srv-mariana', enderecoIp: '10.0.0.21', tipoAcao: 'login', modulo: 'auth', objetoId: null, tipoObjeto: null, valorAnterior: null, valorPosterior: null, realizadaEmUtc: diasAtras(d, 10) });
  }
  add({ ator: 'servidor', atorCidadaoId: null, atorServidorId: 'srv-admin', enderecoIp: '10.0.0.2', tipoAcao: 'alterar_permissoes', modulo: 'servidores', objetoId: 'srv-ana', tipoObjeto: 'Servidor', valorAnterior: 'visualizar, editar', valorPosterior: 'visualizar, editar, aprovar, rejeitar', realizadaEmUtc: diasAtras(30) });
  add({ ator: 'sistema', atorCidadaoId: null, atorServidorId: null, enderecoIp: '127.0.0.1', tipoAcao: 'prazo_vencido', modulo: 'processos', objetoId: processos.find((p) => p.status === 'vencido')?.id ?? null, tipoObjeto: 'Processo', valorAnterior: 'em_andamento', valorPosterior: 'vencido', realizadaEmUtc: diasAtras(2) });
  return logs.sort((a, b) => b.realizadaEmUtc.localeCompare(a.realizadaEmUtc));
}

function criarTarefas(processos: DemoProcesso[]): DemoTarefa[] {
  const t = (id: string, titulo: string, descricao: string | null, status: string, prioridade: number, prazoDias: number, processoId: string | null, servidores: string[]): DemoTarefa => {
    const criadoEm = diasAtras(5);
    return {
      id, titulo, descricao, status, prioridade, criadoPorId: 'srv-carlos', processoId,
      prazo: new Date(Date.now() + prazoDias * DIA_MS).toISOString(), criadoEm, atualizadoEm: criadoEm,
      atribuicoes: servidores.map((s, i) => ({ id: `${id}-a${i}`, tarefaId: id, servidorId: s, status, concluidaEm: status === 'concluida' ? diasAtras(1) : null, criadoEm, atualizadoEm: criadoEm })),
    };
  };
  const alvara = processos.find((p) => p.tipoProcessoId === 'tp-alvara' && p.status === 'em_andamento');
  const vencido = processos.find((p) => p.status === 'vencido');
  return [
    t('tar-1', 'Agendar vistoria da obra', 'Combinar data com o requerente e o fiscal de obras.', 'pendente', 2, 2, alvara?.id ?? null, ['srv-ana']),
    t('tar-2', 'Regularizar processo com prazo vencido', 'Verificar pendências e dar andamento prioritário.', 'em_andamento', 2, 1, vencido?.id ?? null, ['srv-ana', 'srv-carlos']),
    t('tar-3', 'Atualizar checklist de documentos do alvará', 'Incluir exigência de laudo de sondagem para obras acima de 300 m².', 'pendente', 1, 7, null, ['srv-ana']),
    t('tar-4', 'Revisar modelos de resposta ao cidadão', null, 'concluida', 0, -2, null, ['srv-ana', 'srv-mariana']),
  ];
}

export function criarDbInicial(): DemoDb {
  const servidores = criarServidores();
  const unidades = criarUnidades();
  const categorias = criarCategorias();
  const fluxos = criarFluxos();
  const tipos = criarTipos();
  const formularios = criarFormularios(tipos);
  const processos = criarProcessos(tipos, fluxos, formularios, unidades);
  return {
    versao: DB_VERSAO,
    seq: 1000,
    servidores,
    cidadaos: criarCidadaos(),
    unidades,
    categorias,
    tipos,
    fluxos,
    formularios,
    processos,
    auditoria: criarAuditoria(processos),
    tarefas: criarTarefas(processos),
    preferencias: {
      preferencias: [
        { tipoEvento: 'criacao_processo', canais: ['email', 'painel'] },
        { tipoEvento: 'movimentacao_etapa', canais: ['email', 'painel'] },
        { tipoEvento: 'solicitacao_documentos', canais: ['email', 'painel'] },
        { tipoEvento: 'aprovacao', canais: ['email', 'painel'] },
        { tipoEvento: 'rejeicao', canais: ['email', 'painel'] },
        { tipoEvento: 'nova_mensagem', canais: ['painel'] },
        { tipoEvento: 'vencimento_prazo', canais: ['email'] },
      ],
      inicioSilencio: '22:00',
      fimSilencio: '07:00',
    },
  };
}

// ---------------------------------------------------------------------------
// Persistência (localStorage, tolerante a falhas)
// ---------------------------------------------------------------------------

const DB_VERSAO = 1;
const STORAGE_KEY = 'auditar-demo-db';

let db: DemoDb | null = null;

export function getDb(): DemoDb {
  if (db) return db;
  try {
    const bruto = window.localStorage.getItem(STORAGE_KEY);
    if (bruto) {
      const parsed = JSON.parse(bruto) as DemoDb;
      if (parsed.versao === DB_VERSAO) {
        db = parsed;
        return db;
      }
    }
  } catch {
    // Armazenamento indisponível ou corrompido: recomeça com os dados iniciais.
  }
  db = criarDbInicial();
  return db;
}

export function salvarDb(): void {
  if (!db) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Sem armazenamento: os dados ficam só em memória até recarregar a página.
  }
}

export function reiniciarDb(): void {
  db = criarDbInicial();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignora
  }
}

export function proximoId(prefixo: string): string {
  const d = getDb();
  d.seq += 1;
  return `${prefixo}-${d.seq}`;
}
