// Montagem do conteúdo consolidado do PDF do Processo (Task 22.1, Req. 26.1, 26.4).
//
// Este módulo NÃO renderiza o PDF. Sua única responsabilidade é, a partir dos
// dados já carregados de um Processo (dados gerais, respostas do formulário,
// movimentações, mensagens e documentos), produzir um MODELO estruturado de
// seções e linhas que o renderizador (`processoPdfRenderer.ts`, Task 22.3)
// converte em um artefato PDF.
//
// A função `montarConteudoPdf` é PURA: não acessa banco, rede, relógio nem
// qualquer estado global — recebe tudo por parâmetro e devolve um objeto novo.
// Isso a torna trivial de testar (Property 15, Task 22.2).
//
// Regra crítica (Req. 26.4): o PDF consolidado contém EXCLUSIVAMENTE as
// mensagens do canal público. As mensagens do canal interno entre Servidores
// jamais entram no conteúdo — a filtragem por `canal === 'publico'` é aplicada
// aqui, de forma defensiva, mesmo que o chamador já consulte apenas o canal
// público.

/** Canal público de mensagens — único canal incluído no PDF (Req. 26.4). */
export const CANAL_PUBLICO = 'publico';

// ---------------------------------------------------------------------------
// Modelo de entrada (dados já carregados pelo chamador)
// ---------------------------------------------------------------------------

/** Dados gerais do Processo para o cabeçalho e a seção do cidadão (Req. 26.1). */
export interface ProcessoPdfCabecalho {
  protocolo: string;
  tipoProcesso: string;
  unidade: string;
  status: string;
  cidadao: { nome: string; cpf: string } | null;
}

/** Uma resposta do Formulário_Dinâmico associada ao Processo (Req. 26.1). */
export interface RespostaFormularioPdf {
  /** Rótulo do campo, quando disponível; cai para o `campoId` na renderização. */
  campoLabel?: string | null;
  campoId: string;
  valor: string;
}

/** Item do histórico de movimentações (Req. 26.1). */
export interface MovimentacaoPdf {
  /** Nome do autor (Servidor) da movimentação, quando houver. */
  autor: string | null;
  /** Data e hora em que a movimentação foi realizada. */
  data: Date;
  /** Observação registrada na movimentação, quando houver. */
  observacao: string | null;
}

/** Mensagem do Processo — o campo `canal` determina se entra no PDF (Req. 26.4). */
export interface MensagemPdf {
  /** "publico" ou "interno" — somente "publico" é incluído (Req. 26.4). */
  canal: string;
  conteudo: string;
  /** Data e hora do envio, quando disponível. */
  enviadaEm?: Date | null;
  /** Autor da mensagem (nome do remetente), quando disponível. */
  autor?: string | null;
}

/** Documento anexado ao Processo (Req. 26.1). */
export interface DocumentoPdf {
  nomeOriginal: string;
}

/** Conjunto completo de dados de entrada para a montagem do conteúdo. */
export interface DadosProcessoPdf {
  cabecalho: ProcessoPdfCabecalho;
  respostas: RespostaFormularioPdf[];
  movimentacoes: MovimentacaoPdf[];
  /** Mensagens do Processo (públicas E/OU internas — a filtragem ocorre aqui). */
  mensagens: MensagemPdf[];
  documentos: DocumentoPdf[];
}

// ---------------------------------------------------------------------------
// Modelo de saída (estrutura de seções/linhas para o renderizador)
// ---------------------------------------------------------------------------

/**
 * Identificadores estáveis das seções obrigatórias do PDF (Req. 26.1). São
 * usados pela Property 15 para verificar a completude do conteúdo montado.
 */
export const SECOES_OBRIGATORIAS = [
  'cabecalho',
  'cidadao',
  'respostas',
  'movimentacoes',
  'mensagens',
  'documentos',
] as const;

export type SecaoId = (typeof SECOES_OBRIGATORIAS)[number];

/** Uma seção do PDF: um título e um conjunto ordenado de linhas de texto. */
export interface SecaoPdf {
  /** Identificador estável da seção (ver `SECOES_OBRIGATORIAS`). */
  id: SecaoId;
  /** Título exibido da seção (pt-BR). */
  titulo: string;
  /** Linhas de texto que compõem o corpo da seção (podem ser vazias). */
  linhas: string[];
}

/** Modelo estruturado do conteúdo do PDF — uma lista ordenada de seções. */
export interface ConteudoPdfProcesso {
  /** Título geral do documento (usado no topo do PDF). */
  titulo: string;
  /** Seções na ordem em que devem ser renderizadas. */
  secoes: SecaoPdf[];
}

// ---------------------------------------------------------------------------
// Helpers de formatação (puros)
// ---------------------------------------------------------------------------

/** Formata uma data/hora em pt-BR (dd/mm/aaaa hh:mm) de forma determinística. */
export function formatarDataHora(data: Date | null | undefined): string {
  if (!data || Number.isNaN(data.getTime())) return '-';
  const dd = String(data.getUTCDate()).padStart(2, '0');
  const mm = String(data.getUTCMonth() + 1).padStart(2, '0');
  const aaaa = data.getUTCFullYear();
  const hh = String(data.getUTCHours()).padStart(2, '0');
  const min = String(data.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${aaaa} ${hh}:${min}`;
}

/** Normaliza um texto opcional para exibição, com fallback "-". */
function ou(valor: string | null | undefined): string {
  const s = (valor ?? '').trim();
  return s.length > 0 ? s : '-';
}

// ---------------------------------------------------------------------------
// Montagem do conteúdo (função pura — Task 22.1)
// ---------------------------------------------------------------------------

/**
 * Monta o modelo estruturado do conteúdo do PDF consolidado de um Processo
 * (Req. 26.1) a partir dos dados já carregados.
 *
 * Sempre produz TODAS as seções obrigatórias (`SECOES_OBRIGATORIAS`), mesmo
 * quando algum conjunto de dados está vazio — nesse caso a seção recebe uma
 * linha indicando a ausência (ex.: "Nenhum documento anexado"). Isso garante a
 * completude verificada pela Property 15.
 *
 * As mensagens do canal INTERNO são integralmente omitidas (Req. 26.4): a
 * filtragem por `canal === 'publico'` é aplicada aqui, independentemente do que
 * o chamador tenha consultado.
 *
 * @param dados Dados já carregados do Processo.
 * @returns Modelo estruturado pronto para renderização.
 */
export function montarConteudoPdf(dados: DadosProcessoPdf): ConteudoPdfProcesso {
  const { cabecalho, respostas, movimentacoes, mensagens, documentos } = dados;

  // --- Cabeçalho (protocolo, tipo, unidade, status) ---
  const secaoCabecalho: SecaoPdf = {
    id: 'cabecalho',
    titulo: 'Dados do Processo',
    linhas: [
      `Protocolo: ${ou(cabecalho.protocolo)}`,
      `Tipo de Processo: ${ou(cabecalho.tipoProcesso)}`,
      `Unidade: ${ou(cabecalho.unidade)}`,
      `Status: ${ou(cabecalho.status)}`,
    ],
  };

  // --- Dados do cidadão ---
  const secaoCidadao: SecaoPdf = {
    id: 'cidadao',
    titulo: 'Dados do Cidadão',
    linhas: cabecalho.cidadao
      ? [`Nome: ${ou(cabecalho.cidadao.nome)}`, `CPF: ${ou(cabecalho.cidadao.cpf)}`]
      : ['Nenhum cidadão associado'],
  };

  // --- Respostas do Formulário_Dinâmico ---
  const secaoRespostas: SecaoPdf = {
    id: 'respostas',
    titulo: 'Respostas do Formulário',
    linhas:
      respostas.length > 0
        ? respostas.map((r) => `${ou(r.campoLabel ?? r.campoId)}: ${ou(r.valor)}`)
        : ['Nenhuma resposta registrada'],
  };

  // --- Histórico de movimentações (autor, data/hora, observação) ---
  const secaoMovimentacoes: SecaoPdf = {
    id: 'movimentacoes',
    titulo: 'Histórico de Movimentações',
    linhas:
      movimentacoes.length > 0
        ? movimentacoes.map((m) => {
            const partes = [`${formatarDataHora(m.data)} — ${ou(m.autor)}`];
            if (m.observacao && m.observacao.trim().length > 0) {
              partes.push(`Observação: ${m.observacao.trim()}`);
            }
            return partes.join(' | ');
          })
        : ['Nenhuma movimentação registrada'],
  };

  // --- Mensagens PÚBLICAS (Req. 26.4 — canal interno é excluído) ---
  const mensagensPublicas = mensagens.filter((m) => m.canal === CANAL_PUBLICO);
  const secaoMensagens: SecaoPdf = {
    id: 'mensagens',
    titulo: 'Mensagens Públicas',
    linhas:
      mensagensPublicas.length > 0
        ? mensagensPublicas.map((m) => {
            const cabecalhoMsg = `${formatarDataHora(m.enviadaEm ?? null)} — ${ou(m.autor)}`;
            return `${cabecalhoMsg}: ${ou(m.conteudo)}`;
          })
        : ['Nenhuma mensagem pública registrada'],
  };

  // --- Lista de documentos anexados ---
  const secaoDocumentos: SecaoPdf = {
    id: 'documentos',
    titulo: 'Documentos Anexados',
    linhas:
      documentos.length > 0
        ? documentos.map((d) => ou(d.nomeOriginal))
        : ['Nenhum documento anexado'],
  };

  return {
    titulo: `Processo ${ou(cabecalho.protocolo)}`,
    secoes: [
      secaoCabecalho,
      secaoCidadao,
      secaoRespostas,
      secaoMovimentacoes,
      secaoMensagens,
      secaoDocumentos,
    ],
  };
}
