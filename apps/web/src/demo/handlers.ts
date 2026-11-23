/**
 * Rotas simuladas da API para o MODO DEMONSTRAÇÃO.
 *
 * Cada handler devolve exatamente o formato que as telas esperam (os mesmos
 * contratos de `apps/api`), lendo e alterando o banco em memória de `db.ts`.
 */
import {
  DIA_MS,
  getDb,
  proximoId,
  salvarDb,
  somarDiasUteis,
  type DemoAuditoria,
  type DemoMensagem,
  type DemoProcesso,
  type DemoServidor,
  type DemoTarefa,
} from './db';

// ---------------------------------------------------------------------------
// Infra de roteamento
// ---------------------------------------------------------------------------

export interface DemoRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  sessao: Sessao | null;
}

export interface Sessao {
  role: 'cidadao' | 'servidor';
  id: string;
}

export interface DemoResponse {
  status: number;
  data: unknown;
}

export class DemoHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Handler = (req: DemoRequest) => unknown;

interface Rota {
  method: string;
  regex: RegExp;
  nomes: string[];
  handler: Handler;
}

const rotas: Rota[] = [];

function rota(method: string, padrao: string, handler: Handler): void {
  const nomes: string[] = [];
  const regex = new RegExp(
    `^${padrao.replace(/:([a-zA-Z]+)/g, (_m, nome: string) => {
      nomes.push(nome);
      return '([^/]+)';
    })}/?$`,
  );
  rotas.push({ method, regex, nomes, handler });
}

export function despachar(req: Omit<DemoRequest, 'params'>): DemoResponse {
  for (const r of rotas) {
    if (r.method !== req.method) continue;
    const m = r.regex.exec(req.path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.nomes.forEach((nome, i) => {
      params[nome] = decodeURIComponent(m[i + 1] ?? '');
    });
    const resultado = r.handler({ ...req, params });
    salvarDb();
    if (resultado && typeof resultado === 'object' && '__status' in resultado) {
      const { __status, ...resto } = resultado as { __status: number; [k: string]: unknown };
      return { status: __status, data: 'body' in resto ? resto.body : resto };
    }
    return { status: 200, data: resultado ?? null };
  }
  // Rota não simulada: responde vazio em vez de quebrar a tela.
  if (req.method === 'GET') return { status: 200, data: { data: [] } };
  return { status: 200, data: { ok: true, mensagem: 'Ação registrada (demonstração).', message: 'Ação registrada (demonstração).' } };
}

function criado(body: unknown) {
  return { __status: 201, body };
}

function semConteudo() {
  return { __status: 204, body: null };
}

// ---------------------------------------------------------------------------
// Helpers de domínio
// ---------------------------------------------------------------------------

const agora = () => new Date().toISOString();

export const STATUS_COR: Record<string, string> = {
  aberto: '#2563eb',
  em_andamento: '#7c3aed',
  aguardando_docs: '#d97706',
  aguardando_cidadao: '#ca8a04',
  vencido: '#dc2626',
  aprovado: '#16a34a',
  rejeitado: '#be123c',
  finalizado: '#475569',
};

const ENCERRADOS = new Set(['aprovado', 'rejeitado', 'finalizado']);

function exigirSessao(req: DemoRequest, role?: 'cidadao' | 'servidor'): Sessao {
  if (!req.sessao || (role && req.sessao.role !== role)) {
    throw new DemoHttpError(401, 'Sessão expirada. Faça login novamente.');
  }
  return req.sessao;
}

function servidorPorId(id: string | null | undefined): DemoServidor | undefined {
  return id ? getDb().servidores.find((s) => s.id === id) : undefined;
}

function nomeServidor(id: string | null | undefined): string | null {
  return servidorPorId(id)?.nome ?? null;
}

function acharProcesso(idOuProtocolo: string): DemoProcesso {
  const p = getDb().processos.find((x) => x.id === idOuProtocolo || x.protocolo === idOuProtocolo);
  if (!p) throw new DemoHttpError(404, 'Processo não encontrado.');
  return p;
}

function processoDoCidadao(req: DemoRequest): DemoProcesso {
  const sessao = exigirSessao(req, 'cidadao');
  const p = acharProcesso(req.params.id ?? '');
  if (p.cidadaoId !== sessao.id) throw new DemoHttpError(404, 'Processo não encontrado.');
  return p;
}

function tipoDe(p: DemoProcesso) {
  return getDb().tipos.find((t) => t.id === p.tipoProcessoId)!;
}

function fluxoDe(p: DemoProcesso) {
  const tipo = tipoDe(p);
  return getDb().fluxos.find((f) => f.id === tipo.fluxoId)!;
}

function categoriaNome(p: DemoProcesso): string | null {
  const tipo = tipoDe(p);
  return getDb().categorias.find((c) => c.id === tipo.categoriaId)?.nome ?? null;
}

function unidadeNome(id: string): string {
  return getDb().unidades.find((u) => u.id === id)?.nome ?? '—';
}

function cidadaoDe(p: DemoProcesso) {
  return getDb().cidadaos.find((c) => c.id === p.cidadaoId);
}

function formatarCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function auditar(req: DemoRequest, tipoAcao: string, modulo: string, objetoId: string | null, extra: Partial<DemoAuditoria> = {}): void {
  getDb().auditoria.unshift({
    id: proximoId('aud'),
    ator: req.sessao?.role ?? 'sistema',
    atorCidadaoId: req.sessao?.role === 'cidadao' ? req.sessao.id : null,
    atorServidorId: req.sessao?.role === 'servidor' ? req.sessao.id : null,
    enderecoIp: '189.45.100.23',
    tipoAcao,
    modulo,
    objetoId,
    tipoObjeto: objetoId ? 'Processo' : null,
    valorAnterior: null,
    valorPosterior: null,
    realizadaEmUtc: agora(),
    ...extra,
  });
}

/** Troca códigos internos (servidor, etapa) pelo nome legível, para a auditoria. */
function legivel(v: string | null): string | null {
  if (!v) return v;
  const db = getDb();
  const s = db.servidores.find((x) => x.id === v);
  if (s) return s.nome;
  for (const f of db.fluxos) {
    const e = f.etapas.find((x) => x.id === v);
    if (e) return e.nome;
  }
  return v === 'concluido' ? 'Concluído' : v;
}

function paginar<T>(itens: T[], query: Record<string, string>) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.max(1, Number(query.pageSize) || 20);
  const total = itens.length;
  return {
    data: itens.slice((page - 1) * pageSize, page * pageSize),
    meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Recalcula o status "vencido" para processos em aberto com prazo estourado. */
function statusAtual(p: DemoProcesso): string {
  if (!ENCERRADOS.has(p.status) && new Date(p.prazoFinal).getTime() < Date.now()) return 'vencido';
  return p.status;
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------

function soDigitos(v: unknown): string {
  return texto(v).replace(/\D/g, '');
}

export function tokenPara(role: 'cidadao' | 'servidor', id: string): string {
  return `demo.${role}.${id}`;
}

rota('POST', '/auth/cidadao/login', (req) => {
  const cpf = soDigitos(req.body.cpf);
  const c = getDb().cidadaos.find((x) => x.cpf === cpf);
  if (!c || c.senha !== texto(req.body.senha)) {
    throw new DemoHttpError(401, 'CPF ou senha incorretos. Na demonstração use o CPF 222.222.222-22 e a senha Cidadao@123.');
  }
  auditar({ ...req, sessao: { role: 'cidadao', id: c.id } }, 'login', 'auth', null);
  return { token: tokenPara('cidadao', c.id), cidadao: { id: c.id, nome: c.nome } };
});

rota('POST', '/auth/cidadao/2fa/enviar', () => ({ mensagem: 'Código enviado (demonstração).', message: 'Código enviado (demonstração).' }));
rota('POST', '/auth/cidadao/2fa/verificar', () => {
  const c = getDb().cidadaos[0]!;
  return { token: tokenPara('cidadao', c.id), cidadao: { id: c.id, nome: c.nome } };
});
rota('POST', '/auth/cidadao/registrar', () =>
  criado({ id: 'cid-novo', mensagem: 'Cadastro realizado! Na demonstração, entre com o CPF 222.222.222-22 e a senha Cidadao@123.' }),
);
rota('POST', '/auth/cidadao/ativar', () => ({ id: 'cid-joao', mensagem: 'Conta ativada com sucesso.' }));
rota('POST', '/auth/cidadao/reenviar-ativacao', () => ({ mensagem: 'Enviamos um novo link de ativação (demonstração).' }));
rota('POST', '/auth/cidadao/recuperar-senha', () => ({ mensagem: 'Se o CPF estiver cadastrado, enviaremos as instruções por e-mail (demonstração).' }));
rota('POST', '/auth/cidadao/nova-senha', () => ({ mensagem: 'Senha alterada com sucesso.' }));
rota('POST', '/auth/cidadao/logout', () => semConteudo());

rota('POST', '/auth/servidor/login', (req) => {
  const cpf = soDigitos(req.body.cpf);
  const s = getDb().servidores.find((x) => x.cpf === cpf);
  if (!s || s.senha !== texto(req.body.senha)) {
    throw new DemoHttpError(401, 'CPF ou senha incorretos. Na demonstração use 000.000.000-00 / Admin@123 ou 111.111.111-11 / Analista@123.');
  }
  if (!s.ativo) throw new DemoHttpError(403, 'Este servidor está desativado.');
  auditar({ ...req, sessao: { role: 'servidor', id: s.id } }, 'login', 'auth', null);
  return {
    token: tokenPara('servidor', s.id),
    servidor: { id: s.id, nome: s.nome, nivelAcesso: s.nivelAcesso, senhaTemporaria: false },
    mustChangePassword: false,
  };
});
rota('POST', '/auth/servidor/trocar-senha', () => ({ mensagem: 'Senha alterada com sucesso.' }));
rota('POST', '/auth/servidor/logout', () => semConteudo());

// ---------------------------------------------------------------------------
// Conta do cidadão
// ---------------------------------------------------------------------------

function cidadaoLogado(req: DemoRequest) {
  const sessao = exigirSessao(req, 'cidadao');
  const c = getDb().cidadaos.find((x) => x.id === sessao.id);
  if (!c) throw new DemoHttpError(401, 'Sessão expirada.');
  return c;
}

function perfil(req: DemoRequest) {
  const c = cidadaoLogado(req);
  const { senha: _senha, ...dados } = c;
  return { data: { ...dados, doisFatoresCanal: c.doisFatoresAtivo ? 'email' : null } };
}

rota('GET', '/cidadao/conta', perfil);
rota('PATCH', '/cidadao/conta', (req) => {
  const c = cidadaoLogado(req);
  for (const campo of ['nome', 'telefone', 'logradouro', 'numero', 'cep', 'cidade', 'estado'] as const) {
    if (typeof req.body[campo] === 'string') c[campo] = req.body[campo] as string;
  }
  return perfil(req);
});
rota('PATCH', '/cidadao/conta/2fa', (req) => {
  const c = cidadaoLogado(req);
  c.doisFatoresAtivo = Boolean(req.body.ativo ?? req.body.ativar ?? !c.doisFatoresAtivo);
  return perfil(req);
});
const okMensagem = (m: string) => () => ({ message: m, mensagem: m });
rota('POST', '/cidadao/conta/alterar-email', okMensagem('Enviamos um link de confirmação para o novo e-mail (demonstração).'));
rota('POST', '/cidadao/conta/confirmar-email', okMensagem('E-mail confirmado.'));
rota('POST', '/cidadao/conta/alterar-senha', okMensagem('Senha alterada com sucesso.'));
rota('DELETE', '/cidadao/conta', okMensagem('Na demonstração a conta não é excluída de verdade.'));
rota('GET', '/cidadao/conta/acessos', (req) => {
  cidadaoLogado(req);
  const itens = [0, 1, 3, 6, 10].map((d, i) => {
    const dt = new Date(Date.now() - d * DIA_MS - i * 3_600_000);
    return { data: dt.toISOString().slice(0, 10), hora: dt.toTimeString().slice(0, 5), ip: ['189.45.100.23', '177.38.12.40', '200.150.3.9'][i % 3]! };
  });
  return { data: itens };
});
rota('GET', '/cidadao/conta/notificacoes/preferencias', () => ({ data: getDb().preferencias }));
rota('PUT', '/cidadao/conta/notificacoes/preferencias', (req) => {
  const db = getDb();
  db.preferencias = {
    preferencias: (req.body.preferencias as typeof db.preferencias.preferencias) ?? db.preferencias.preferencias,
    inicioSilencio: (req.body.inicioSilencio as string | null) ?? null,
    fimSilencio: (req.body.fimSilencio as string | null) ?? null,
  };
  return { data: db.preferencias };
});

// ---------------------------------------------------------------------------
// Processos — Portal do Cidadão
// ---------------------------------------------------------------------------

rota('GET', '/processos', (req) => {
  const sessao = exigirSessao(req, 'cidadao');
  const { status, periodoInicio, periodoFim } = req.query;
  const lista = getDb()
    .processos.filter((p) => p.cidadaoId === sessao.id)
    .filter((p) => !status || statusAtual(p) === status)
    .filter((p) => !periodoInicio || p.abertoEm.slice(0, 10) >= periodoInicio)
    .filter((p) => !periodoFim || p.abertoEm.slice(0, 10) <= periodoFim)
    .sort((a, b) => b.abertoEm.localeCompare(a.abertoEm))
    .map((p) => ({
      protocolo: p.protocolo,
      categoria: categoriaNome(p),
      tipoProcesso: tipoDe(p).nome,
      abertoEm: p.abertoEm,
      status: statusAtual(p),
      prazoFinal: p.prazoFinal,
    }));
  return { data: lista, meta: { total: lista.length, page: 1, pageSize: lista.length, totalPages: 1 } };
});

function novoProtocolo(unidadeId: string): string {
  const unidade = getDb().unidades.find((u) => u.id === unidadeId);
  const prefixo = unidade?.prefixoProtocolo ?? 'PRT';
  const ano = new Date().getFullYear();
  const usados = getDb()
    .processos.filter((p) => p.protocolo.startsWith(`${prefixo}-${ano}-`))
    .map((p) => Number(p.protocolo.split('-')[2]) || 0);
  const prox = Math.max(200, ...usados) + 1;
  return `${prefixo}-${ano}-${String(prox).padStart(5, '0')}`;
}

function abrirProcesso(req: DemoRequest, cidadaoId: string) {
  const db = getDb();
  const tipo = db.tipos.find((t) => t.id === texto(req.body.tipoProcessoId));
  const unidadeId = texto(req.body.unidadeId);
  if (!tipo || !db.unidades.some((u) => u.id === unidadeId)) {
    throw new DemoHttpError(400, 'Selecione o tipo de processo e a unidade.');
  }
  const fl = db.fluxos.find((f) => f.id === tipo.fluxoId)!;
  const abertoEm = agora();
  const p: DemoProcesso = {
    id: proximoId('proc'),
    protocolo: novoProtocolo(unidadeId),
    status: 'aberto',
    prioridade: 0,
    cidadaoId,
    tipoProcessoId: tipo.id,
    unidadeId,
    servidorResponsavelId: null,
    etapaAtualId: fl.etapas[0]?.id ?? null,
    abertoEm,
    prazoFinal: somarDiasUteis(abertoEm, tipo.prazoTotalDiasUteis),
    encerradoEm: null,
    atualizadoEm: abertoEm,
    respostas: ((req.body.respostas as Array<{ campoId: string; valor: string }>) ?? []).filter((r) => r.valor),
    movimentacoes: [
      {
        etapaOrigemId: null,
        etapaDestinoId: fl.etapas[0]?.id ?? null,
        acao: req.sessao?.role === 'servidor' ? 'Processo aberto no balcão de atendimento' : 'Processo aberto',
        observacao: null,
        tipoObservacao: null,
        realizadoEm: abertoEm,
        servidorId: req.sessao?.role === 'servidor' ? req.sessao.id : null,
      },
    ],
    mensagens: [],
    documentos: [],
    documentosSolicitados: [],
  };
  db.processos.push(p);
  auditar(req, 'abrir_processo', 'processos', p.id, { valorPosterior: p.protocolo });
  return criado({ protocolo: p.protocolo, processoId: p.id });
}

rota('POST', '/processos', (req) => abrirProcesso(req, exigirSessao(req, 'cidadao').id));

rota('GET', '/processos/:id', (req) => {
  const p = processoDoCidadao(req);
  const etapa = fluxoDe(p).etapas.find((e) => e.id === p.etapaAtualId);
  return {
    data: {
      protocolo: p.protocolo,
      categoria: categoriaNome(p),
      tipoProcesso: tipoDe(p).nome,
      unidade: unidadeNome(p.unidadeId),
      abertoEm: p.abertoEm,
      prazoFinal: p.prazoFinal,
      status: statusAtual(p),
      etapaAtual: etapa?.nome ?? null,
      respostas: p.respostas,
    },
  };
});

function historicoPublico(p: DemoProcesso) {
  return p.movimentacoes
    .map((m) => ({
      data: m.realizadoEm,
      acao: m.acao,
      responsavel: m.servidorId ? nomeServidor(m.servidorId) ?? 'Servidor' : 'Cidadão',
      observacao: m.tipoObservacao === 'interna' ? null : m.observacao,
    }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

rota('GET', '/processos/:id/historico', (req) => ({ data: historicoPublico(processoDoCidadao(req)) }));

function mensagensPublicas(p: DemoProcesso) {
  return p.mensagens
    .filter((m) => m.canal === 'publico')
    .sort((a, b) => a.enviadaEm.localeCompare(b.enviadaEm))
    .map((m) => ({
      id: m.id,
      remetente: m.remetenteCidadaoId ? cidadaoDe(p)?.nome ?? 'Cidadão' : nomeServidor(m.remetenteServidorId) ?? unidadeNome(p.unidadeId),
      conteudo: m.conteudo,
      enviadaEm: m.enviadaEm,
    }));
}

rota('GET', '/processos/:id/mensagens', (req) => ({ data: mensagensPublicas(processoDoCidadao(req)) }));
rota('POST', '/processos/:id/mensagens', (req) => {
  const p = processoDoCidadao(req);
  const m: DemoMensagem = {
    id: proximoId('msg'),
    canal: 'publico',
    conteudo: texto(req.body.conteudo),
    remetenteCidadaoId: p.cidadaoId,
    remetenteServidorId: null,
    destinatarioServidorId: null,
    caminhoAnexo: null,
    enviadaEm: agora(),
  };
  p.mensagens.push(m);
  if (p.status === 'aguardando_cidadao') p.status = 'em_andamento';
  auditar(req, 'enviar_mensagem', 'processos', p.id);
  return criado({ data: mensagensPublicas(p).find((x) => x.id === m.id) });
});

// ---------------------------------------------------------------------------
// Documentos (cidadão e servidor)
// ---------------------------------------------------------------------------

export const DEMO_UPLOAD_PREFIX = '/__demo_upload__/';

function documentosResumo(p: DemoProcesso) {
  return [...p.documentos]
    .sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm))
    .map(({ id, nomeOriginal, tamanhoBytes, enviadoEm, enviadoPorCidadao }) => ({ id, nomeOriginal, tamanhoBytes, enviadoEm, enviadoPorCidadao }));
}

function uploadUrl(p: DemoProcesso, req: DemoRequest) {
  const nome = texto(req.body.nomeOriginal).replace(/[^a-zA-Z0-9._-]/g, '_') || 'arquivo';
  return {
    uploadUrl: `${DEMO_UPLOAD_PREFIX}${p.id}/${nome}`,
    caminhoStorage: `processos/${p.unidadeId}/${p.id}/${proximoId('arq')}-${nome}`,
    expiraEm: new Date(Date.now() + 300_000).toISOString(),
  };
}

function confirmarDocumento(p: DemoProcesso, req: DemoRequest) {
  const doc = {
    id: proximoId('doc'),
    nomeOriginal: texto(req.body.nomeOriginal) || 'documento.pdf',
    mimeType: texto(req.body.mimeType) || 'application/pdf',
    tamanhoBytes: Number(req.body.tamanhoBytes) || 100_000,
    enviadoPorCidadao: req.sessao?.role === 'cidadao',
    enviadoPorId: req.sessao?.id ?? 'desconhecido',
    enviadoEm: agora(),
  };
  p.documentos.push(doc);
  if (req.sessao?.role === 'cidadao' && p.status === 'aguardando_docs') {
    p.status = 'em_andamento';
    p.documentosSolicitados = [];
  }
  auditar(req, 'anexar_documento', 'processos', p.id, { valorPosterior: doc.nomeOriginal });
  const { mimeType: _m, enviadoPorId: _e, ...resumo } = doc;
  return { doc, resumo };
}

/** PDF mínimo e válido para os downloads simulados. */
function pdfDemo(titulo: string): string {
  const conteudo = `BT /F1 18 Tf 60 760 Td (${titulo.replace(/[()\\]/g, '')}) Tj ET\nBT /F1 11 Tf 60 730 Td (Documento de demonstracao - Auditar) Tj ET`;
  const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>endobj\n4 0 obj<</Length ${conteudo.length}>>stream\n${conteudo}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  return `data:application/pdf;base64,${btoa(unescape(encodeURIComponent(pdf)))}`;
}

function download(p: DemoProcesso, docId: string) {
  const doc = p.documentos.find((d) => d.id === docId);
  if (!doc) throw new DemoHttpError(404, 'Documento não encontrado.');
  return { downloadUrl: pdfDemo(doc.nomeOriginal), nomeOriginal: doc.nomeOriginal, expiraEm: new Date(Date.now() + 300_000).toISOString() };
}

rota('GET', '/processos/:id/documentos', (req) => ({ data: documentosResumo(processoDoCidadao(req)) }));
rota('POST', '/processos/:id/documentos/upload-url', (req) => uploadUrl(processoDoCidadao(req), req));
rota('POST', '/processos/:id/documentos', (req) => criado(confirmarDocumento(processoDoCidadao(req), req).doc));
rota('GET', '/processos/:id/documentos/:docId/download', (req) => download(processoDoCidadao(req), req.params.docId!));

function processoAdmin(req: DemoRequest): DemoProcesso {
  exigirSessao(req, 'servidor');
  return acharProcesso(req.params.id ?? '');
}

rota('GET', '/admin/processos/:id/documentos', (req) => ({ data: documentosResumo(processoAdmin(req)) }));
rota('POST', '/admin/processos/:id/documentos/upload-url', (req) => uploadUrl(processoAdmin(req), req));
rota('POST', '/admin/processos/:id/documentos', (req) => criado({ data: confirmarDocumento(processoAdmin(req), req).resumo }));
rota('GET', '/admin/processos/:id/documentos/:docId/download', (req) => download(processoAdmin(req), req.params.docId!));

// ---------------------------------------------------------------------------
// Formulários públicos
// ---------------------------------------------------------------------------

rota('GET', '/formularios', (req) => {
  const f = getDb().formularios.find((x) => x.tipoProcessoId === req.query.tipoId && x.unidadeId === req.query.unidadeId && x.ativo);
  if (!f) throw new DemoHttpError(404, 'Formulário não encontrado para este tipo e unidade.');
  return { data: f };
});

// ---------------------------------------------------------------------------
// Configuração (categorias, tipos, unidades, fluxos, formulários)
// ---------------------------------------------------------------------------

rota('GET', '/admin/config/categorias', () => ({ data: getDb().categorias }));
rota('POST', '/admin/config/categorias', (req) => {
  const c = { id: proximoId('cat'), nome: texto(req.body.nome), descricao: texto(req.body.descricao), icone: null, cor: texto(req.body.cor) || '#1d4ed8', secretaria: texto(req.body.secretaria), ativa: true, gestorId: null, prefixoProtocolo: null, criadoEm: agora() };
  getDb().categorias.push(c);
  return criado(c);
});
rota('PATCH', '/admin/config/categorias/:id', (req) => {
  const c = getDb().categorias.find((x) => x.id === req.params.id);
  if (!c) throw new DemoHttpError(404, 'Categoria não encontrada.');
  Object.assign(c, req.body);
  return c;
});
rota('DELETE', '/admin/config/categorias/:id', (req) => {
  const c = getDb().categorias.find((x) => x.id === req.params.id);
  if (c) c.ativa = false;
  return semConteudo();
});

function tipoComUnidades(t: ReturnType<typeof getDb>['tipos'][number]) {
  const { unidadesIds, ...resto } = t;
  return { ...resto, unidades: unidadesIds.map((unidadeId) => ({ unidadeId })) };
}

rota('GET', '/admin/config/tipos-processo', (req) =>
  getDb()
    .tipos.filter((t) => !req.query.categoriaId || t.categoriaId === req.query.categoriaId)
    .map(tipoComUnidades),
);
rota('POST', '/admin/config/tipos-processo', (req) => {
  const t = { id: proximoId('tp'), nome: texto(req.body.nome), prazoTotalDiasUteis: Number(req.body.prazoTotalDiasUteis) || 15, ativo: true, categoriaId: texto(req.body.categoriaId), fluxoId: texto(req.body.fluxoId) || 'flx-via', unidadesIds: (req.body.unidadesIds as string[]) ?? [], criadoEm: agora() };
  getDb().tipos.push(t);
  return criado(tipoComUnidades(t));
});
rota('PATCH', '/admin/config/tipos-processo/:id', (req) => {
  const t = getDb().tipos.find((x) => x.id === req.params.id);
  if (!t) throw new DemoHttpError(404, 'Tipo não encontrado.');
  const { unidadesIds, ...resto } = req.body as Record<string, unknown>;
  Object.assign(t, resto);
  if (Array.isArray(unidadesIds)) t.unidadesIds = unidadesIds as string[];
  return tipoComUnidades(t);
});
rota('DELETE', '/admin/config/tipos-processo/:id', (req) => {
  const t = getDb().tipos.find((x) => x.id === req.params.id);
  if (t) t.ativo = false;
  return semConteudo();
});

rota('GET', '/admin/config/unidades', () => ({ data: getDb().unidades }));
rota('POST', '/admin/config/unidades', (req) => {
  const u = { id: proximoId('uni'), nome: texto(req.body.nome), secretaria: texto(req.body.secretaria), endereco: texto(req.body.endereco), telefone: texto(req.body.telefone), horarioFuncionamento: texto(req.body.horarioFuncionamento), ativa: true, modoAtribuicao: texto(req.body.modoAtribuicao) || 'manual', gestorId: texto(req.body.gestorId) || null, prefixoProtocolo: 'PRT', criadoEm: agora() };
  getDb().unidades.push(u);
  return criado(u);
});
rota('PATCH', '/admin/config/unidades/:id', (req) => {
  const u = getDb().unidades.find((x) => x.id === req.params.id);
  if (!u) throw new DemoHttpError(404, 'Unidade não encontrada.');
  Object.assign(u, req.body);
  return u;
});
rota('DELETE', '/admin/config/unidades/:id', (req) => {
  const u = getDb().unidades.find((x) => x.id === req.params.id);
  if (u) u.ativa = false;
  return semConteudo();
});

function fluxoDetalhe(id: string) {
  const f = getDb().fluxos.find((x) => x.id === id);
  if (!f) throw new DemoHttpError(404, 'Fluxo não encontrado.');
  return { ...f, prazoTotalDiasUteis: f.etapas.reduce((s, e) => s + e.prazosDiasUteis, 0) };
}

function salvarFluxo(req: DemoRequest, id: string | null) {
  const db = getDb();
  let f = id ? db.fluxos.find((x) => x.id === id) : undefined;
  if (!f) {
    f = { id: proximoId('flx'), nome: '', versao: 0, criadoEm: agora(), criadoPorId: req.sessao?.id ?? 'srv-admin', etapas: [] };
    db.fluxos.push(f);
  }
  const fluxoId = f.id;
  f.nome = texto(req.body.nome) || f.nome;
  f.versao += 1;
  f.etapas = ((req.body.etapas as Array<Record<string, unknown>>) ?? []).map((e, i) => {
    const etapaId = `${fluxoId}-v${f!.versao}-e${i + 1}`;
    return {
      id: etapaId,
      nome: texto(e.nome),
      prazosDiasUteis: Number(e.prazosDiasUteis) || 1,
      ordem: i + 1,
      fluxoId,
      servidorPadraoId: texto(e.servidorPadraoId) || null,
      documentosObrigatorios: (e.documentosObrigatorios as string[]) ?? [],
      observacoesObrigatorias: texto(e.observacoesObrigatorias) || null,
      automacoes: ((e.automacoes as Array<{ tipo: string; payload: string }>) ?? []).map((a, j) => ({ id: `${etapaId}-a${j}`, etapaId, tipo: a.tipo, payload: a.payload })),
      criadoEm: agora(),
    };
  });
  const det = fluxoDetalhe(fluxoId);
  return { salvo: true, fluxo: f, prazoTotalDiasUteis: det.prazoTotalDiasUteis, salvoEm: agora() };
}

rota('GET', '/admin/config/fluxos', () => getDb().fluxos);
rota('GET', '/admin/config/fluxos/:id', (req) => fluxoDetalhe(req.params.id!));
rota('POST', '/admin/config/fluxos', (req) => criado(salvarFluxo(req, null)));
rota('PUT', '/admin/config/fluxos/:id', (req) => salvarFluxo(req, req.params.id!));

rota('GET', '/admin/config/formularios', () => ({ data: getDb().formularios }));
function camposDe(formularioId: string, body: Record<string, unknown>) {
  return ((body.campos as Array<Record<string, unknown>>) ?? []).map((c, i) => ({
    id: texto(c.rotulo) || `campo-${i + 1}`,
    formularioId,
    tipo: texto(c.tipo),
    rotulo: texto(c.rotulo),
    descricaoAuxiliar: texto(c.descricaoAuxiliar) || null,
    obrigatorio: Boolean(c.obrigatorio),
    validacao: texto(c.validacao) || null,
    valorPadrao: texto(c.valorPadrao) || null,
    ordem: Number(c.ordem) || i + 1,
    opcoes: (c.opcoes as string[]) ?? null,
  }));
}
rota('POST', '/admin/config/formularios', (req) => {
  const id = proximoId('frm');
  const f = { id, tipoProcessoId: texto(req.body.tipoProcessoId), unidadeId: texto(req.body.unidadeId), ativo: true, criadoEm: agora(), criadoPorId: req.sessao?.id ?? 'srv-admin', campos: camposDe(id, req.body) };
  getDb().formularios.push(f);
  return criado(f);
});
rota('PUT', '/admin/config/formularios/:id', (req) => {
  const f = getDb().formularios.find((x) => x.id === req.params.id);
  if (!f) throw new DemoHttpError(404, 'Formulário não encontrado.');
  f.campos = camposDe(f.id, req.body);
  return f;
});

// ---------------------------------------------------------------------------
// Painel — processos
// ---------------------------------------------------------------------------

function itemLista(p: DemoProcesso) {
  const status = statusAtual(p);
  const ultima = p.movimentacoes[p.movimentacoes.length - 1];
  return {
    protocolo: p.protocolo,
    cidadao: cidadaoDe(p)?.nome ?? '—',
    categoria: categoriaNome(p),
    tipoProcesso: tipoDe(p).nome,
    status,
    statusCor: STATUS_COR[status] ?? '#475569',
    prazoFinal: p.prazoFinal,
    servidorResponsavel: nomeServidor(p.servidorResponsavelId),
    ultimaMovimentacao: ultima?.realizadoEm ?? p.abertoEm,
  };
}

rota('GET', '/admin/processos', (req) => {
  exigirSessao(req, 'servidor');
  const q = req.query;
  let lista = [...getDb().processos];
  if (q.q) {
    const termo = q.q.toLowerCase();
    const digitos = q.q.replace(/\D/g, '');
    lista = lista.filter((p) => {
      const c = cidadaoDe(p);
      return p.protocolo.toLowerCase().includes(termo) || c?.nome.toLowerCase().includes(termo) || (digitos.length >= 3 && c?.cpf.includes(digitos));
    });
  } else {
    lista = lista.filter((p) => {
      const c = cidadaoDe(p);
      const tipo = tipoDe(p);
      return (
        (!q.status || statusAtual(p) === q.status) &&
        (!q.categoriaId || tipo.categoriaId === q.categoriaId) &&
        (!q.tipoProcessoId || p.tipoProcessoId === q.tipoProcessoId) &&
        (!q.unidadeId || p.unidadeId === q.unidadeId) &&
        (!q.servidorResponsavelId || p.servidorResponsavelId === q.servidorResponsavelId) &&
        (!q.nomeCidadao || (c?.nome.toLowerCase().includes(q.nomeCidadao.toLowerCase()) ?? false)) &&
        (!q.cpfCidadao || (c?.cpf.includes(q.cpfCidadao.replace(/\D/g, '')) ?? false)) &&
        (!q.dataAberturaInicio || p.abertoEm.slice(0, 10) >= q.dataAberturaInicio) &&
        (!q.dataAberturaFim || p.abertoEm.slice(0, 10) <= q.dataAberturaFim) &&
        (!q.prazoInicio || p.prazoFinal.slice(0, 10) >= q.prazoInicio) &&
        (!q.prazoFim || p.prazoFinal.slice(0, 10) <= q.prazoFim) &&
        (!q.prioridade || String(p.prioridade) === q.prioridade)
      );
    });
  }
  const dir = q.direcao === 'asc' ? 1 : -1;
  const chave = (p: DemoProcesso): string => {
    switch (q.ordenarPor) {
      case 'protocolo': return p.protocolo;
      case 'cidadao': return cidadaoDe(p)?.nome ?? '';
      case 'tipo': return tipoDe(p).nome;
      case 'status': return statusAtual(p);
      case 'prazoFinal': return p.prazoFinal;
      case 'servidor': return nomeServidor(p.servidorResponsavelId) ?? '';
      default: return p.abertoEm;
    }
  };
  lista.sort((a, b) => chave(a).localeCompare(chave(b)) * dir);
  return paginar(lista.map(itemLista), q);
});

rota('POST', '/admin/processos', (req) => {
  exigirSessao(req, 'servidor');
  const cidadaoId = texto(req.body.cidadaoId);
  if (!getDb().cidadaos.some((c) => c.id === cidadaoId)) throw new DemoHttpError(400, 'Cidadão não encontrado.');
  return abrirProcesso(req, cidadaoId);
});

rota('GET', '/admin/cidadaos', (req) => {
  exigirSessao(req, 'servidor');
  const cpf = soDigitos(req.query.cpf);
  const c = getDb().cidadaos.find((x) => x.cpf === cpf);
  if (!c) throw new DemoHttpError(404, 'Nenhum cidadão cadastrado com este CPF. Experimente 222.222.222-22.');
  return { data: { id: c.id, cpf: c.cpf, cpfFormatado: formatarCpf(c.cpf), nome: c.nome, email: c.email, telefone: c.telefone } };
});

function detalheAdmin(p: DemoProcesso) {
  const fl = fluxoDe(p);
  const idx = fl.etapas.findIndex((e) => e.id === p.etapaAtualId);
  const etapa = idx >= 0 ? fl.etapas[idx]! : null;
  const proxima = idx >= 0 ? fl.etapas[idx + 1] ?? null : null;
  const c = cidadaoDe(p);
  return {
    protocolo: p.protocolo,
    status: statusAtual(p),
    prioridade: p.prioridade,
    cidadao: c ? { nome: c.nome, cpf: formatarCpf(c.cpf) } : null,
    categoria: categoriaNome(p),
    tipoProcesso: tipoDe(p).nome,
    unidade: unidadeNome(p.unidadeId),
    servidorResponsavel: nomeServidor(p.servidorResponsavelId),
    abertoEm: p.abertoEm,
    prazoFinal: p.prazoFinal,
    etapaAtual: etapa ? { id: etapa.id, nome: etapa.nome, prazosDiasUteis: etapa.prazosDiasUteis } : null,
    etapasAnteriores: (idx >= 0 ? fl.etapas.slice(0, idx) : ENCERRADOS.has(p.status) ? fl.etapas : []).map((e) => ({
      id: e.id,
      nome: e.nome,
      concluidaEm: p.movimentacoes.find((m) => m.etapaOrigemId === e.id)?.realizadoEm ?? null,
    })),
    proximaEtapa: proxima ? { id: proxima.id, nome: proxima.nome } : null,
    movimentacoes: p.movimentacoes.map((m) => ({
      etapaOrigemId: m.etapaOrigemId,
      etapaDestinoId: m.etapaDestinoId,
      observacao: m.observacao ?? m.acao,
      tipoObservacao: m.tipoObservacao,
      realizadoEm: m.realizadoEm,
      servidor: m.servidorId ? { nome: nomeServidor(m.servidorId) ?? 'Servidor' } : null,
    })),
    respostas: p.respostas,
    acoesPendentes: {
      proximaEtapa: proxima ? { id: proxima.id, nome: proxima.nome } : null,
      documentosSolicitadosPendentes: p.documentosSolicitados,
    },
  };
}

function resumoTramitacao(p: DemoProcesso) {
  return { data: { protocolo: p.protocolo, status: statusAtual(p), etapaAtualId: p.etapaAtualId } };
}

rota('GET', '/admin/processos/:id', (req) => ({ data: detalheAdmin(processoAdmin(req)) }));

rota('PATCH', '/admin/processos/:id', (req) => {
  const p = processoAdmin(req);
  const alterados: string[] = [];
  if (typeof req.body.prioridade === 'number' && req.body.prioridade !== p.prioridade) {
    auditar(req, 'edicao_corretiva', 'processos', p.id, { valorAnterior: String(p.prioridade), valorPosterior: String(req.body.prioridade) });
    p.prioridade = req.body.prioridade;
    alterados.push('prioridade');
  }
  for (const r of (req.body.respostas as Array<{ campoId: string; valor: string }>) ?? []) {
    const atual = p.respostas.find((x) => x.campoId === r.campoId);
    if (atual && atual.valor !== r.valor) {
      auditar(req, 'edicao_corretiva', 'processos', p.id, { valorAnterior: atual.valor, valorPosterior: r.valor });
      atual.valor = r.valor;
      alterados.push(r.campoId);
    } else if (!atual) {
      p.respostas.push(r);
      alterados.push(r.campoId);
    }
  }
  return { data: { protocolo: p.protocolo, prioridade: p.prioridade, camposAlterados: alterados } };
});

function registrarMov(p: DemoProcesso, req: DemoRequest, mov: Partial<(typeof p.movimentacoes)[number]> & { acao: string }) {
  const realizadoEm = agora();
  p.movimentacoes.push({
    etapaOrigemId: p.etapaAtualId,
    etapaDestinoId: p.etapaAtualId,
    observacao: null,
    tipoObservacao: null,
    servidorId: req.sessao?.id ?? null,
    realizadoEm,
    ...mov,
  });
  p.atualizadoEm = realizadoEm;
  if (!p.servidorResponsavelId && req.sessao?.role === 'servidor') p.servidorResponsavelId = req.sessao.id;
}

rota('POST', '/admin/processos/:id/avancar-etapa', (req) => {
  const p = processoAdmin(req);
  if (ENCERRADOS.has(p.status)) throw new DemoHttpError(400, 'Este processo já foi encerrado.');
  if (p.documentosSolicitados.length > 0) {
    throw new DemoHttpError(400, 'Há documentos solicitados ao cidadão ainda pendentes.');
  }
  const fl = fluxoDe(p);
  const idx = fl.etapas.findIndex((e) => e.id === p.etapaAtualId);
  const atual = fl.etapas[idx];
  const prox = fl.etapas[idx + 1];
  const obs = texto(req.body.observacao) || null;
  if (prox) {
    registrarMov(p, req, { etapaDestinoId: prox.id, acao: `Avançou de "${atual?.nome}" para "${prox.nome}"`, observacao: obs, tipoObservacao: obs ? 'publica' : null });
    p.etapaAtualId = prox.id;
    p.status = 'em_andamento';
  } else {
    registrarMov(p, req, { etapaDestinoId: null, acao: 'Processo deferido', observacao: obs ?? 'Solicitação aprovada.', tipoObservacao: 'publica' });
    p.etapaAtualId = null;
    p.status = 'aprovado';
    p.encerradoEm = agora();
  }
  auditar(req, 'mover_etapa', 'processos', p.id, { valorAnterior: atual?.id ?? null, valorPosterior: prox?.id ?? 'concluido' });
  return resumoTramitacao(p);
});

rota('POST', '/admin/processos/:id/rejeitar', (req) => {
  const p = processoAdmin(req);
  const motivo = texto(req.body.motivo);
  registrarMov(p, req, { etapaDestinoId: null, acao: 'Processo indeferido', observacao: motivo, tipoObservacao: 'publica' });
  p.status = 'rejeitado';
  p.etapaAtualId = null;
  p.encerradoEm = agora();
  auditar(req, 'rejeitar_processo', 'processos', p.id, { valorPosterior: motivo });
  return resumoTramitacao(p);
});

rota('POST', '/admin/processos/:id/solicitar-documentos', (req) => {
  const p = processoAdmin(req);
  const docs = ((req.body.documentos as string[]) ?? []).filter(Boolean);
  p.documentosSolicitados = docs;
  p.status = 'aguardando_docs';
  registrarMov(p, req, { acao: 'Documentos solicitados ao cidadão', observacao: docs.join('; '), tipoObservacao: 'publica' });
  auditar(req, 'solicitar_documentos', 'processos', p.id, { valorPosterior: docs.join('; ') });
  return resumoTramitacao(p);
});

rota('POST', '/admin/processos/:id/observacoes', (req) => {
  const p = processoAdmin(req);
  const tipo = req.body.tipo === 'interna' ? 'interna' : 'publica';
  registrarMov(p, req, { acao: tipo === 'interna' ? 'Observação interna' : 'Observação ao cidadão', observacao: texto(req.body.conteudo), tipoObservacao: tipo });
  const m = p.movimentacoes[p.movimentacoes.length - 1]!;
  return criado({ data: { id: proximoId('obs'), processoId: p.id, observacao: m.observacao, tipoObservacao: m.tipoObservacao, realizadoEm: m.realizadoEm } });
});

rota('GET', '/admin/processos/:id/auditoria', (req) => {
  const p = processoAdmin(req);
  const movs = p.movimentacoes.map((m) => ({ origem: 'movimentacao' as const, autor: m.servidorId ? nomeServidor(m.servidorId) : cidadaoDe(p)?.nome ?? null, acao: m.acao, data: m.realizadoEm }));
  const auds = getDb()
    .auditoria.filter((a) => a.objetoId === p.id)
    .map((a) => ({
      origem: 'auditoria' as const,
      autor: a.atorServidorId ? nomeServidor(a.atorServidorId) : a.atorCidadaoId ? cidadaoDe(p)?.nome ?? 'Cidadão' : 'Sistema',
      acao: a.tipoAcao,
      valorAnterior: legivel(a.valorAnterior),
      valorPosterior: legivel(a.valorPosterior),
      data: a.realizadaEmUtc,
    }));
  return { data: [...movs, ...auds].sort((a, b) => b.data.localeCompare(a.data)) };
});

rota('GET', '/admin/processos/:id/pdf', (req) => {
  const p = processoAdmin(req);
  const base64 = pdfDemo(`Processo ${p.protocolo}`).split(',')[1]!;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
});

rota('GET', '/admin/processos/:id/mensagens', (req) => ({ data: mensagensPublicas(processoAdmin(req)) }));
rota('POST', '/admin/processos/:id/mensagens', (req) => {
  const p = processoAdmin(req);
  const m: DemoMensagem = { id: proximoId('msg'), canal: 'publico', conteudo: texto(req.body.conteudo), remetenteCidadaoId: null, remetenteServidorId: req.sessao!.id, destinatarioServidorId: null, caminhoAnexo: null, enviadaEm: agora() };
  p.mensagens.push(m);
  auditar(req, 'enviar_mensagem', 'processos', p.id);
  return criado({ data: mensagensPublicas(p).find((x) => x.id === m.id), notificacaoEntregue: true });
});

function internas(p: DemoProcesso) {
  return p.mensagens
    .filter((m) => m.canal === 'interno')
    .sort((a, b) => a.enviadaEm.localeCompare(b.enviadaEm))
    .map((m) => ({ id: m.id, conteudo: m.conteudo, remetenteServidor: m.remetenteServidorId ? { nome: nomeServidor(m.remetenteServidorId) ?? 'Servidor' } : null, destinatarioServidorId: m.destinatarioServidorId, caminhoAnexo: m.caminhoAnexo, enviadaEm: m.enviadaEm }));
}

rota('GET', '/admin/processos/:id/mensagens/internas', (req) => ({ data: internas(processoAdmin(req)) }));
rota('POST', '/admin/processos/:id/mensagens/internas', (req) => {
  const p = processoAdmin(req);
  const anexo = req.body.anexo as { caminhoStorage?: string } | undefined;
  const m: DemoMensagem = { id: proximoId('int'), canal: 'interno', conteudo: texto(req.body.conteudo), remetenteCidadaoId: null, remetenteServidorId: req.sessao!.id, destinatarioServidorId: texto(req.body.destinatarioServidorId) || null, caminhoAnexo: anexo?.caminhoStorage ?? null, enviadaEm: agora() };
  p.mensagens.push(m);
  return criado({ data: internas(p).find((x) => x.id === m.id) });
});

function cargas() {
  const db = getDb();
  return db.servidores
    .filter((s) => s.ativo && s.nivelAcesso >= 4 && s.nivelAcesso <= 5)
    .map((s) => ({ servidorId: s.id, nome: s.nome, processosAtivos: db.processos.filter((p) => p.servidorResponsavelId === s.id && !ENCERRADOS.has(p.status)).length }))
    .sort((a, b) => a.processosAtivos - b.processosAtivos);
}

rota('GET', '/admin/processos/:id/atribuir/cargas', (req) => {
  processoAdmin(req);
  return { data: cargas() };
});

function atribuir(req: DemoRequest, servidorId: string | null, modo: string, justificativa?: string) {
  const p = processoAdmin(req);
  const anterior = p.servidorResponsavelId;
  p.servidorResponsavelId = servidorId;
  if (p.status === 'aberto' && servidorId) p.status = 'em_andamento';
  registrarMov(p, req, {
    acao: servidorId ? `Atribuído a ${nomeServidor(servidorId)}` : 'Enviado para a fila geral',
    observacao: justificativa ?? null,
    tipoObservacao: justificativa ? 'interna' : null,
  });
  auditar(req, justificativa ? 'reatribuir_processo' : 'atribuir_processo', 'processos', p.id, { valorAnterior: anterior, valorPosterior: servidorId });
  return { data: { processoId: p.id, servidorId, modo, filaGeral: !servidorId } };
}

rota('POST', '/admin/processos/:id/atribuir', (req) => {
  const modo = texto(req.body.modo) || 'manual';
  let servidorId: string | null = texto(req.body.servidorId) || null;
  if (modo === 'automatico') servidorId = cargas()[0]?.servidorId ?? null;
  if (modo === 'fila_geral') servidorId = null;
  return atribuir(req, servidorId, modo);
});
rota('POST', '/admin/processos/:id/reatribuir', (req) => atribuir(req, texto(req.body.servidorDestinoId), 'manual', texto(req.body.justificativa)));

// ---------------------------------------------------------------------------
// Servidores
// ---------------------------------------------------------------------------

const PERMISSOES = ['visualizar', 'editar', 'mover_etapa', 'rejeitar', 'solicitar_documentos', 'observacao_publica', 'observacao_interna', 'acessar_relatorios', 'gerenciar_usuarios', 'configurar_fluxos', 'acessar_auditoria', 'atribuir', 'aprovar', 'gerenciar_tarefas'];

function servidorItem(s: DemoServidor) {
  return { id: s.id, nome: s.nome, cpf: s.cpf, email: s.email, telefone: s.telefone, nivelAcesso: s.nivelAcesso, ativo: s.ativo, senhaTemporaria: false, unidadeId: s.unidadeId, criadoEm: s.criadoEm, atualizadoEm: s.criadoEm };
}

function acharServidor(id: string) {
  const s = getDb().servidores.find((x) => x.id === id);
  if (!s) throw new DemoHttpError(404, 'Servidor não encontrado.');
  return s;
}

rota('GET', '/admin/servidores', (req) => {
  exigirSessao(req, 'servidor');
  const lista = getDb()
    .servidores.filter((s) => !req.query.nivel || String(s.nivelAcesso) === req.query.nivel)
    .filter((s) => !req.query.ativo || String(s.ativo) === req.query.ativo)
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map(servidorItem);
  return paginar(lista, req.query);
});
rota('POST', '/admin/servidores', (req) => {
  const s: DemoServidor = { id: proximoId('srv'), nome: texto(req.body.nome), cpf: soDigitos(req.body.cpf), email: texto(req.body.email), telefone: texto(req.body.telefone) || null, nivelAcesso: Number(req.body.nivelAcesso) || 5, ativo: true, unidadeId: texto(req.body.unidadeId) || 'uni-central', senha: 'Analista@123', permissoesExtras: [], criadoEm: agora() };
  getDb().servidores.push(s);
  auditar(req, 'criar_servidor', 'servidores', null, { valorPosterior: s.nome });
  return criado({ servidor: servidorItem(s), senhaEnviada: true, mensagem: 'Servidor cadastrado. Na demonstração, a senha inicial é Analista@123.' });
});
rota('GET', '/admin/servidores/:id', (req) => {
  const s = acharServidor(req.params.id!);
  return { ...servidorItem(s), permissoes: PERMISSOES.map((permissao) => ({ permissao, concedida: s.permissoesExtras.includes(permissao) })) };
});
rota('PATCH', '/admin/servidores/:id', (req) => {
  const s = acharServidor(req.params.id!);
  for (const campo of ['nome', 'email', 'telefone', 'unidadeId'] as const) {
    if (typeof req.body[campo] === 'string') (s as unknown as Record<string, unknown>)[campo] = req.body[campo];
  }
  if (req.body.nivelAcesso !== undefined) s.nivelAcesso = Number(req.body.nivelAcesso);
  return servidorItem(s);
});
rota('POST', '/admin/servidores/:id/desativar', (req) => {
  const s = acharServidor(req.params.id!);
  s.ativo = false;
  return { id: s.id, ativo: false, reatribuidos: 0 };
});
rota('PUT', '/admin/servidores/:id/permissoes', (req) => {
  const s = acharServidor(req.params.id!);
  const lista = (req.body.permissoes as Array<{ permissao: string; concedida: boolean }>) ?? [];
  s.permissoesExtras = lista.filter((p) => p.concedida).map((p) => p.permissao);
  auditar(req, 'alterar_permissoes', 'servidores', null, { valorPosterior: s.permissoesExtras.join(', ') });
  return { permissoes: PERMISSOES.map((permissao) => ({ permissao, concedida: s.permissoesExtras.includes(permissao) })) };
});

// ---------------------------------------------------------------------------
// Dashboards e relatórios
// ---------------------------------------------------------------------------

const STATUS = ['aberto', 'em_andamento', 'aguardando_docs', 'aguardando_cidadao', 'vencido', 'aprovado', 'rejeitado', 'finalizado'];

function contarPorStatus(lista: DemoProcesso[]) {
  const r: Record<string, number> = Object.fromEntries(STATUS.map((s) => [s, 0]));
  for (const p of lista) r[statusAtual(p)] = (r[statusAtual(p)] ?? 0) + 1;
  return r;
}

const ok = <T>(value: T) => ({ value, erro: false });

/** Série diária "realista": volume real + base fictícia para gráficos mais cheios. */
function serieDias(dias: number, base: number) {
  const procs = getDb().processos;
  return Array.from({ length: dias }, (_, i) => {
    const d = new Date(Date.now() - (dias - 1 - i) * DIA_MS);
    const dia = d.toISOString().slice(0, 10);
    const reais = procs.filter((p) => p.abertoEm.slice(0, 10) === dia).length;
    const fim = d.getDay() === 0 || d.getDay() === 6;
    return { dia, total: reais + (fim ? 1 : base + ((i * 7) % 5)) };
  });
}

function filtrarPorQuery(lista: DemoProcesso[], q: Record<string, string>) {
  return lista.filter(
    (p) =>
      (!q.unidadeId || p.unidadeId === q.unidadeId) &&
      (!q.categoriaId || tipoDe(p).categoriaId === q.categoriaId) &&
      (!q.de || p.abertoEm.slice(0, 10) >= q.de) &&
      (!q.ate || p.abertoEm.slice(0, 10) <= q.ate),
  );
}

rota('GET', '/admin/dashboard/analista', (req) => {
  const s = exigirSessao(req, 'servidor');
  const meus = getDb().processos.filter((p) => p.servidorResponsavelId === s.id);
  const amanha = Date.now() + DIA_MS;
  return {
    porStatus: ok(contarPorStatus(meus)),
    vencendoEm24h: ok(meus.filter((p) => !ENCERRADOS.has(p.status) && new Date(p.prazoFinal).getTime() <= amanha && new Date(p.prazoFinal).getTime() >= Date.now()).length),
    tempoMedioResolucaoHoras: ok(86),
    produtividadeDiaria: ok(serieDias(14, 2)),
  };
});

rota('GET', '/admin/dashboard/gestor-unidade', () => {
  const procs = getDb().processos;
  const aprovados = procs.filter((p) => p.status === 'aprovado' || p.status === 'finalizado').length;
  const rejeitados = procs.filter((p) => p.status === 'rejeitado').length;
  const total = Math.max(1, aprovados + rejeitados);
  return {
    porStatus: ok(contarPorStatus(procs)),
    cargaPorServidor: ok(cargas().map((c) => ({ servidorId: c.servidorId, nome: c.nome, ativos: c.processosAtivos }))),
    taxaAprovacaoRejeicao: ok({ aprovados, rejeitados, taxaAprovacao: aprovados / total, taxaRejeicao: rejeitados / total }),
    volumeDiario: ok(serieDias(30, 3)),
  };
});

function grupos(chave: 'unidade' | 'categoria') {
  const db = getDb();
  const itens = chave === 'unidade' ? db.unidades.map((u) => ({ id: u.id, nome: u.nome })) : db.categorias.map((c) => ({ id: c.id, nome: c.nome }));
  return itens.map((g) => ({
    ...g,
    porStatus: contarPorStatus(db.processos.filter((p) => (chave === 'unidade' ? p.unidadeId === g.id : tipoDe(p).categoriaId === g.id))),
  }));
}

rota('GET', '/admin/dashboard/gestor-categoria', () => ({
  porStatusPorUnidade: ok(grupos('unidade')),
  tempoMedioPorTipo: ok(getDb().tipos.map((t, i) => ({ tipoProcessoId: t.id, nome: t.nome, horas: 40 + ((i * 37) % 180) }))),
  comparacaoUnidades: ok(grupos('unidade')),
}));

rota('GET', '/admin/dashboard/gestor-geral', () => ({
  porStatusPorCategoria: ok(grupos('categoria')),
  volumeSemanal: ok(
    Array.from({ length: 10 }, (_, i) => ({
      semana: new Date(Date.now() - (9 - i) * 7 * DIA_MS).toISOString().slice(0, 10),
      total: 14 + ((i * 5) % 9) + i,
    })),
  ),
  comparacaoPeriodos: ok({ periodoAtual: 87, periodoAnterior: 72, variacaoPercentual: 20.8 }),
}));

rota('GET', '/admin/dashboard/resumo', (req) => {
  const lista = filtrarPorQuery(getDb().processos, req.query);
  const c = contarPorStatus(lista);
  const em48h = Date.now() + 2 * DIA_MS;
  const abertos = lista.filter((p) => !ENCERRADOS.has(p.status));
  const vencendo = abertos.filter((p) => statusAtual(p) !== 'vencido' && new Date(p.prazoFinal).getTime() <= em48h);
  const vencidos = abertos.filter((p) => statusAtual(p) === 'vencido');
  const mapa = (l: DemoProcesso[]) => ({ quantidade: l.length, processos: l.map((p) => ({ id: p.protocolo, protocolo: p.protocolo, prazoFinal: p.prazoFinal })) });
  return {
    cards: ok({ total: lista.length, abertos: c.aberto ?? 0, emAndamento: c.em_andamento ?? 0, aguardandoDocs: c.aguardando_docs ?? 0, atrasados: c.vencido ?? 0, aprovados: c.aprovado ?? 0, finalizados: c.finalizado ?? 0, rejeitados: c.rejeitado ?? 0 }),
    prazos: ok({ vencendo: mapa(vencendo), vencidos: mapa(vencidos) }),
  };
});

rota('GET', '/admin/dashboard/desempenho-equipe', (req) => {
  const db = getDb();
  const lista = db.servidores
    .filter((s) => s.ativo && s.nivelAcesso >= 4)
    .map((s, i) => {
      const meus = db.processos.filter((p) => p.servidorResponsavelId === s.id);
      return {
        servidorId: s.id,
        nome: s.nome,
        atribuidos: meus.length,
        emAndamento: meus.filter((p) => !ENCERRADOS.has(p.status)).length,
        concluidos: meus.filter((p) => ENCERRADOS.has(p.status)).length,
        atrasados: meus.filter((p) => statusAtual(p) === 'vencido').length,
        tempoMedioConclusaoHoras: 48 + i * 19,
        tarefasPendentes: db.tarefas.filter((t) => t.status !== 'concluida' && t.atribuicoes.some((a) => a.servidorId === s.id)).length,
      };
    });
  const ordem = (req.query.ordenarPor ?? 'nome') as keyof (typeof lista)[number];
  lista.sort((a, b) => (typeof a[ordem] === 'number' ? (b[ordem] as number) - (a[ordem] as number) : String(a[ordem]).localeCompare(String(b[ordem]))));
  return ok(lista);
});

rota('GET', '/admin/relatorios', (req) => {
  const db = getDb();
  const q = req.query;
  const lista = db.processos.filter(
    (p) =>
      (!q.categoriaId || tipoDe(p).categoriaId === q.categoriaId) &&
      (!q.tipoProcessoId || p.tipoProcessoId === q.tipoProcessoId) &&
      (!q.unidadeId || p.unidadeId === q.unidadeId) &&
      (!q.servidorId || p.servidorResponsavelId === q.servidorId),
  );
  return {
    periodo: { dataInicio: q.dataInicio ?? null, dataFim: q.dataFim ?? null },
    volumePorPeriodo: serieDias(30, 3).map((d) => ({ data: d.dia, total: d.total })),
    tempoMedioPorTipo: db.tipos.map((t, i) => ({ tipoProcessoId: t.id, tipoProcesso: t.nome, tempoMedioDias: 3 + ((i * 3) % 14), totalResolvidos: 4 + ((i * 7) % 20) })),
    taxaPorUnidade: db.unidades.map((u, i) => {
      const aprovados = 10 + ((i * 7) % 15);
      const rejeitados = 1 + (i % 4);
      const total = aprovados + rejeitados;
      return { unidadeId: u.id, unidade: u.nome, aprovados, rejeitados, total, taxaAprovacao: aprovados / total, taxaRejeicao: rejeitados / total };
    }),
    vencidosPorServidor: db.servidores
      .filter((s) => s.nivelAcesso === 5)
      .map((s) => ({ servidorId: s.id, servidor: s.nome, totalVencidos: lista.filter((p) => p.servidorResponsavelId === s.id && statusAtual(p) === 'vencido').length })),
    volumePorCategoria: db.categorias.map((c) => ({ categoriaId: c.id, categoria: c.nome, total: lista.filter((p) => tipoDe(p).categoriaId === c.id).length * 6 + 3 })),
  };
});

const exportacao = () => criado({ jobId: proximoId('job') });
const statusExportacao = (formato: string) => () => ({
  status: 'concluido',
  downloadUrl:
    formato === 'csv'
      ? `data:text/csv;charset=utf-8,${encodeURIComponent('Indicador;Valor\nProcessos no periodo;87\nTaxa de aprovacao;91%\n')}`
      : pdfDemo('Relatorio de demonstracao'),
});
rota('POST', '/admin/relatorios/exportar', exportacao);
rota('GET', '/admin/relatorios/exportar/:jobId', statusExportacao('pdf'));
rota('POST', '/admin/auditoria/exportar', exportacao);
rota('GET', '/admin/auditoria/exportar/:jobId', statusExportacao('csv'));

rota('GET', '/admin/auditoria', (req) => {
  const q = req.query;
  const db = getDb();
  const protocoloId = q.protocolo ? db.processos.find((p) => p.protocolo.toLowerCase().includes(q.protocolo!.toLowerCase()))?.id : undefined;
  const lista = db.auditoria.filter(
    (a) =>
      (!q.dataInicio || a.realizadaEmUtc.slice(0, 10) >= q.dataInicio) &&
      (!q.dataFim || a.realizadaEmUtc.slice(0, 10) <= q.dataFim) &&
      (!q.tipoAcao || a.tipoAcao.includes(q.tipoAcao)) &&
      (!q.ator || a.ator === q.ator) &&
      (!q.atorId || a.atorServidorId === q.atorId || a.atorCidadaoId === q.atorId) &&
      (!q.modulo || a.modulo === q.modulo) &&
      (!q.protocolo || a.objetoId === protocoloId),
  );
  return paginar(
    lista.map((a) => ({ ...a, valorAnterior: legivel(a.valorAnterior), valorPosterior: legivel(a.valorPosterior) })),
    q,
  );
});

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

function tarefaView(t: DemoTarefa) {
  const p = t.processoId ? getDb().processos.find((x) => x.id === t.processoId) : undefined;
  return { ...t, processo: p ? { id: p.protocolo, protocolo: p.protocolo } : null };
}

function acharTarefa(id: string) {
  const t = getDb().tarefas.find((x) => x.id === id);
  if (!t) throw new DemoHttpError(404, 'Tarefa não encontrada.');
  return t;
}

rota('GET', '/admin/tarefas', (req) => {
  const q = req.query;
  return getDb()
    .tarefas.filter((t) => (!q.status || t.status === q.status) && (!q.prazoDe || t.prazo.slice(0, 10) >= q.prazoDe) && (!q.prazoAte || t.prazo.slice(0, 10) <= q.prazoAte))
    .map(tarefaView);
});
rota('GET', '/admin/tarefas/minhas', (req) => {
  const s = exigirSessao(req, 'servidor');
  const grupos: Record<string, unknown[]> = { pendente: [], em_andamento: [], concluida: [] };
  for (const t of getDb().tarefas) {
    for (const a of t.atribuicoes) {
      if (a.servidorId === s.id) grupos[a.status]?.push({ ...a, tarefa: tarefaView(t) });
    }
  }
  return grupos;
});
rota('GET', '/admin/tarefas/:id', (req) => tarefaView(acharTarefa(req.params.id!)));
rota('POST', '/admin/tarefas', (req) => {
  const s = exigirSessao(req, 'servidor');
  const db = getDb();
  const id = proximoId('tar');
  const criadoEm = agora();
  const destinatarios = req.body.todos ? db.servidores.filter((x) => x.ativo).map((x) => x.id) : ((req.body.destinatarios as string[]) ?? []);
  const processoRef = texto(req.body.processoId);
  const processo = processoRef ? db.processos.find((p) => p.id === processoRef || p.protocolo === processoRef) : undefined;
  const t: DemoTarefa = {
    id,
    titulo: texto(req.body.titulo),
    descricao: texto(req.body.descricao) || null,
    status: 'pendente',
    prioridade: typeof req.body.prioridade === 'number' ? req.body.prioridade : 1,
    criadoPorId: s.id,
    processoId: processo?.id ?? null,
    prazo: texto(req.body.prazo) || new Date(Date.now() + 3 * DIA_MS).toISOString(),
    criadoEm,
    atualizadoEm: criadoEm,
    atribuicoes: destinatarios.map((servidorId, i) => ({ id: `${id}-a${i}`, tarefaId: id, servidorId, status: 'pendente', concluidaEm: null, criadoEm, atualizadoEm: criadoEm })),
  };
  db.tarefas.unshift(t);
  return criado({ tarefa: tarefaView(t), atribuicoes: t.atribuicoes });
});
rota('PATCH', '/admin/tarefas/:id', (req) => {
  const t = acharTarefa(req.params.id!);
  Object.assign(t, req.body, { atualizadoEm: agora() });
  return tarefaView(t);
});
rota('DELETE', '/admin/tarefas/:id', (req) => {
  const db = getDb();
  db.tarefas = db.tarefas.filter((t) => t.id !== req.params.id);
  return { id: req.params.id };
});
rota('PATCH', '/admin/tarefas/:id/atribuicoes/minha', (req) => {
  const s = exigirSessao(req, 'servidor');
  const t = acharTarefa(req.params.id!);
  const a = t.atribuicoes.find((x) => x.servidorId === s.id);
  if (!a) throw new DemoHttpError(403, 'Esta tarefa não está atribuída a você.');
  a.status = texto(req.body.status) || a.status;
  a.atualizadoEm = agora();
  a.concluidaEm = a.status === 'concluida' ? agora() : null;
  const todos = t.atribuicoes.map((x) => x.status);
  t.status = todos.every((x) => x === 'concluida') ? 'concluida' : todos.some((x) => x !== 'pendente') ? 'em_andamento' : 'pendente';
  return a;
});

// ---------------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------------

rota('GET', '/notificacoes', () => []);
