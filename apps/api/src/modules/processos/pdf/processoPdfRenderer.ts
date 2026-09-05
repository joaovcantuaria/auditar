// Renderizador do PDF do Processo (Task 22.3, Req. 26.1, 26.2).
//
// O worker de relatórios (`jobs/relatorio.worker.ts#toPdf`) produz um PDF 1.4
// de página única a partir de um resumo textual, mas sua assinatura é acoplada
// ao tipo `RelatorioResultado` e não é reutilizável para o conteúdo estruturado
// do Processo. Para NÃO acoplar este módulo ao worker (e evitar puxar BullMQ/
// MinIO/Redis transitivamente para dentro da rota HTTP), reaproveitamos aqui a
// MESMA abordagem de geração — montagem manual de objetos PDF 1.4 com uma
// tabela xref e um stream de operadores de texto (`BT/Tf/Td/Tj/ET`), no mesmo
// estilo de `toPdf`.
//
// A diferença é que este renderizador recebe o modelo estruturado
// (`ConteudoPdfProcesso`) produzido por `montarConteudoPdf` e o serializa em
// múltiplas páginas quando necessário, escrevendo títulos de seção e linhas de
// corpo. Continua sendo um renderizador mínimo e determinístico — o objetivo é
// um artefato binário abrível, não diagramação rica.

import type { ConteudoPdfProcesso, SecaoPdf } from './processoPdfContent.js';

// ---------------------------------------------------------------------------
// Constantes de layout (pontos PDF; página US Letter, como em `toPdf`)
// ---------------------------------------------------------------------------

const PAGINA_LARGURA = 612;
const PAGINA_ALTURA = 792;
const MARGEM_ESQUERDA = 50;
const TOPO_Y = 760;
const RODAPE_Y = 50;
const ALTURA_LINHA = 16;
const FONTE_TITULO_DOC = 16;
const FONTE_TITULO_SECAO = 13;
const FONTE_CORPO = 11;

/**
 * Largura máxima aproximada (em caracteres) de uma linha de corpo antes de
 * quebrar. Helvetica 11pt tem largura média ~5.5pt/caractere; com ~512pt úteis
 * cabem ~90 caracteres. Usamos uma quebra conservadora por contagem de
 * caracteres (determinística e suficiente para um renderizador mínimo).
 */
const MAX_CHARS_LINHA = 95;

// ---------------------------------------------------------------------------
// Helpers de texto
// ---------------------------------------------------------------------------

/**
 * Escapa os caracteres que têm significado especial dentro de uma string
 * literal PDF (`(`, `)` e `\`), e remove caracteres de controle/quebra que
 * poderiam corromper o stream de conteúdo. Mesmo tratamento base de `toPdf`,
 * estendido para neutralizar quebras de linha (substituídas por espaço).
 */
function escaparTextoPdf(texto: string): string {
  return texto
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/([\\()])/g, '\\$1');
}

/**
 * Quebra uma linha longa em fatias de no máximo `MAX_CHARS_LINHA` caracteres,
 * preferindo cortar em espaços para não partir palavras quando possível.
 */
function quebrarLinha(texto: string): string[] {
  if (texto.length <= MAX_CHARS_LINHA) return [texto];
  const partes: string[] = [];
  let resto = texto;
  while (resto.length > MAX_CHARS_LINHA) {
    let corte = resto.lastIndexOf(' ', MAX_CHARS_LINHA);
    if (corte <= 0) corte = MAX_CHARS_LINHA; // palavra única muito longa
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte).trimStart();
  }
  if (resto.length > 0) partes.push(resto);
  return partes;
}

// ---------------------------------------------------------------------------
// Modelo intermediário: item de texto posicionável
// ---------------------------------------------------------------------------

interface ItemTexto {
  texto: string;
  fonte: number;
}

/**
 * Achata o conteúdo estruturado em uma sequência linear de itens de texto
 * (título do documento, títulos de seção e linhas de corpo já quebradas),
 * preservando a ordem de renderização.
 */
function achatarConteudo(conteudo: ConteudoPdfProcesso): ItemTexto[] {
  const itens: ItemTexto[] = [];
  itens.push({ texto: conteudo.titulo, fonte: FONTE_TITULO_DOC });

  const escreverSecao = (secao: SecaoPdf): void => {
    itens.push({ texto: '', fonte: FONTE_CORPO }); // espaçamento antes da seção
    itens.push({ texto: secao.titulo, fonte: FONTE_TITULO_SECAO });
    for (const linha of secao.linhas) {
      for (const fatia of quebrarLinha(linha)) {
        itens.push({ texto: fatia, fonte: FONTE_CORPO });
      }
    }
  };

  for (const secao of conteudo.secoes) {
    escreverSecao(secao);
  }
  return itens;
}

/**
 * Distribui os itens de texto em páginas conforme a altura disponível. Cada
 * página é uma lista de itens com seu `y` já calculado.
 */
interface LinhaPosicionada {
  texto: string;
  fonte: number;
  y: number;
}

function paginar(itens: ItemTexto[]): LinhaPosicionada[][] {
  const paginas: LinhaPosicionada[][] = [];
  let atual: LinhaPosicionada[] = [];
  let y = TOPO_Y;

  for (const item of itens) {
    if (y < RODAPE_Y) {
      paginas.push(atual);
      atual = [];
      y = TOPO_Y;
    }
    atual.push({ texto: item.texto, fonte: item.fonte, y });
    y -= ALTURA_LINHA;
  }
  if (atual.length > 0) paginas.push(atual);
  if (paginas.length === 0) paginas.push([]);
  return paginas;
}

// ---------------------------------------------------------------------------
// Serialização PDF 1.4 (mesma abordagem de `toPdf`)
// ---------------------------------------------------------------------------

/** Monta o stream de conteúdo (operadores de texto) de uma página. */
function montarStreamPagina(linhas: LinhaPosicionada[]): string {
  return linhas
    .filter((l) => l.texto.length > 0)
    .map(
      (l) =>
        `BT /F1 ${l.fonte} Tf ${MARGEM_ESQUERDA} ${l.y} Td (${escaparTextoPdf(l.texto)}) Tj ET`,
    )
    .join('\n');
}

/**
 * Renderiza o conteúdo estruturado do Processo em um Buffer de PDF 1.4 válido,
 * com uma ou mais páginas. Determinístico e sem dependências externas.
 *
 * Estrutura de objetos:
 *   1: Catalog
 *   2: Pages (Kids = todas as páginas)
 *   3: Font (Helvetica)
 *   Para cada página i (0-based): objeto Page e objeto Contents.
 */
export function renderProcessoPdf(conteudo: ConteudoPdfProcesso): Buffer {
  const itens = achatarConteudo(conteudo);
  const paginas = paginar(itens);

  // Objetos fixos: 1 Catalog, 2 Pages, 3 Font. Páginas e conteúdos vêm a seguir.
  const objetos: string[] = [];

  // Reserva os índices: Page objects e Content objects intercalados a partir do 4.
  const primeiroPageObj = 4;
  const idsPages: number[] = [];
  for (let i = 0; i < paginas.length; i++) {
    idsPages.push(primeiroPageObj + i * 2);
  }

  objetos.push('<< /Type /Catalog /Pages 2 0 R >>'); // obj 1
  objetos.push(
    `<< /Type /Pages /Kids [${idsPages.map((id) => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>`,
  ); // obj 2
  objetos.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // obj 3

  paginas.forEach((linhas, i) => {
    const pageId = primeiroPageObj + i * 2;
    const contentId = pageId + 1;
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGINA_LARGURA} ${PAGINA_ALTURA}] ` +
        `/Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    ); // Page obj
    const stream = montarStreamPagina(linhas);
    const streamLen = Buffer.byteLength(stream, 'utf8');
    objetos.push(`<< /Length ${streamLen} >>\nstream\n${stream}\nendstream`); // Content obj
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objetos.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objetos[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objetos.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}
