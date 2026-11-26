// Texto de um documento de licitação, página por página: PDF, DOCX, DOC, RTF e ZIP com PDFs.
//
// O arquivo vem de terceiros (órgãos públicos, via PNCP): é apenas lido em memória, nunca gravado em
// disco nem executado, com limites de tamanho, de páginas e de descompactação.
import 'server-only';
import { strFromU8, unzipSync } from 'fflate';
import { getDocumentProxy } from 'unpdf';
import WordExtractor from 'word-extractor';
import { detectDocumentKind, docxXmlToText, hasUsableText, rtfToText } from './document-formats';

/** Formato lido, para exibição ("PDF", "DOCX"...). `null` quando não foi possível ler. */
export type ReadableKind = 'PDF' | 'DOCX' | 'DOC' | 'RTF' | 'ZIP';

export type DocumentText = {
  kind: ReadableKind | null;
  /** Texto de cada página. Word e RTF não têm páginas no arquivo: vêm como uma página só. */
  pages: string[];
  pageCount: number;
  /** Páginas com texto de verdade; a diferença para `pageCount` são páginas escaneadas. */
  textPages: number;
  /** Um parágrafo por linha (Word, RTF), em vez de linhas visuais (PDF). Ver `ExtractOptions`. */
  paragraphs: boolean;
};

const MAX_PDF_PAGES = 400;
const MAX_PDFS_PER_ZIP = 8;
/** Limite de cada arquivo descompactado e do total, contra "bombas" de compressão. */
const MAX_UNZIPPED_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_UNZIPPED_TOTAL_BYTES = 80 * 1024 * 1024;

const EMPTY: DocumentText = {
  kind: null,
  pages: [],
  pageCount: 0,
  textPages: 0,
  paragraphs: false,
};

function result(kind: ReadableKind, pages: string[], pageCount: number, paragraphs: boolean) {
  return { kind, pages, pageCount, textPages: pages.filter(hasUsableText).length, paragraphs };
}

type TextItem = { str: string; hasEOL: boolean; transform: number[] };

/** Reconstrói as linhas de uma página a partir dos fragmentos de texto do PDF. */
function joinTextItems(items: readonly unknown[]): string {
  let out = '';
  let lastY: number | null = null;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || !('str' in raw)) continue;
    const item = raw as TextItem;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
    out += item.str;
    if (item.hasEOL) out += '\n';
    lastY = y;
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

async function pdfPages(bytes: Uint8Array): Promise<{ pages: string[]; pageCount: number }> {
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    const pages: string[] = [];
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PDF_PAGES); number++) {
      const page = await pdf.getPage(number);
      pages.push(joinTextItems((await page.getTextContent()).items));
      page.cleanup();
    }
    return { pages, pageCount: pdf.numPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Abre só os arquivos que interessam (PDF e DOCX), respeitando os limites de tamanho. */
function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      const wanted = /\.(pdf|docx)$/i.test(file.name) || file.name === 'word/document.xml';
      if (!wanted || file.originalSize > MAX_UNZIPPED_ENTRY_BYTES) return false;
      total += file.originalSize;
      return total <= MAX_UNZIPPED_TOTAL_BYTES;
    },
  });
}

async function zipText(bytes: Uint8Array): Promise<DocumentText> {
  const entries = unzip(bytes);
  const document = entries['word/document.xml'];
  if (document) return result('DOCX', [docxXmlToText(strFromU8(document))], 1, true);

  // ZIP com vários arquivos (edital + anexos): junta as páginas dos PDFs, na ordem dos nomes.
  const names = Object.keys(entries).sort((a, b) => a.localeCompare(b, 'pt', { numeric: true }));
  const pages: string[] = [];
  let pageCount = 0;
  for (const name of names.filter((item) => /\.pdf$/i.test(item)).slice(0, MAX_PDFS_PER_ZIP)) {
    if (detectDocumentKind(entries[name]) !== 'pdf') continue;
    const pdf = await pdfPages(entries[name]);
    pages.push(...pdf.pages);
    pageCount += pdf.pageCount;
  }
  if (pages.length > 0) return result('ZIP', pages, pageCount, false);

  // Sem PDF: tenta o primeiro DOCX dentro do ZIP.
  const docx = names.find((item) => /\.docx$/i.test(item));
  if (docx) {
    const inner = unzip(entries[docx])['word/document.xml'];
    if (inner) return result('ZIP', [docxXmlToText(strFromU8(inner))], 1, true);
  }
  return EMPTY;
}

/**
 * Lê o texto do documento. Devolve `kind: null` quando o formato não é suportado; lança erro apenas se
 * o arquivo estiver corrompido.
 */
export async function extractDocumentText(bytes: Uint8Array): Promise<DocumentText> {
  switch (detectDocumentKind(bytes)) {
    case 'pdf': {
      const { pages, pageCount } = await pdfPages(bytes);
      return result('PDF', pages, pageCount, false);
    }
    case 'zip':
      return zipText(bytes);
    case 'ole': {
      const document = await new WordExtractor().extract(Buffer.from(bytes));
      return result('DOC', [document.getBody()], 1, true);
    }
    case 'rtf':
      return result('RTF', [rtfToText(Buffer.from(bytes).toString('latin1'))], 1, true);
    default:
      return EMPTY;
  }
}
