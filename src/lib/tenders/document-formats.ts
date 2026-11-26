// Reconhecimento do formato de um documento e conversão de RTF e DOCX em texto.
// Módulo puro (sem bibliotecas nem disco), com testes. PDF, ZIP e DOC ficam em document-text.ts.

export type DocumentKind = 'pdf' | 'zip' | 'ole' | 'rtf' | 'unknown';

/** Formato pelos primeiros bytes do arquivo: o nome e o Content-Type do PNCP não são confiáveis. */
export function detectDocumentKind(bytes: Uint8Array): DocumentKind {
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (head === '%PDF-') return 'pdf';
  if (head.startsWith('PK')) return 'zip'; // DOCX também é um ZIP
  if (head === '{\\rtf') return 'rtf';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
    return 'ole'; // .doc
  return 'unknown';
}

/** Página com texto de verdade: menos que isto costuma ser só o número da página sobre uma imagem. */
export function hasUsableText(page: string): boolean {
  return (page.match(/[\p{L}\p{N}]/gu) ?? []).length >= 30;
}

/** Grupos do RTF que não são texto do documento (tabelas de fontes, imagens, cabeçalhos...). */
const RTF_SKIPPED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'objdata',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'generator',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'xmlnstbl',
  'mmathPr',
  'filetbl',
  'revtbl',
  'fldinst',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
]);
const RTF_LINE_BREAKS = new Set(['par', 'line', 'row', 'sect', 'page']);
const RTF_CONTROL_WORD = /\\([a-zA-Z]+)(-?\d+)? ?/y;

/**
 * Texto de um documento RTF, um parágrafo por linha. Percorre o arquivo uma vez: grupos de formatação
 * são ignorados e os caracteres acentuados (`\'e7`, `\u231`) são decodificados.
 */
export function rtfToText(rtf: string): string {
  const windows1252 = new TextDecoder('windows-1252');
  /** Para cada grupo aberto, se o grupo de fora estava sendo ignorado. */
  const outerSkip: boolean[] = [];
  let skip = false;
  /** Quantos caracteres substitutos vêm depois de um `\uN` (definido por `\ucN`; o padrão é 1). */
  let fallbackLength = 1;
  let pendingFallback = 0;
  let out = '';
  let i = 0;

  const emit = (text: string) => {
    if (skip) return;
    if (pendingFallback > 0) pendingFallback--;
    else out += text;
  };

  while (i < rtf.length) {
    const char = rtf[i];
    if (char === '{') {
      outerSkip.push(skip);
      i++;
    } else if (char === '}') {
      skip = outerSkip.pop() ?? false;
      i++;
    } else if (char === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        emit(next);
        i += 2;
      } else if (next === '*') {
        // Destino opcional (`{\*\algo ...}`): o grupo inteiro pode ser ignorado.
        skip = true;
        i += 2;
      } else if (next === "'") {
        const byte = Number.parseInt(rtf.slice(i + 2, i + 4), 16);
        if (!Number.isNaN(byte)) emit(windows1252.decode(Uint8Array.of(byte)));
        i += 4;
      } else if (next === '~') {
        emit(' ');
        i += 2;
      } else {
        RTF_CONTROL_WORD.lastIndex = i;
        const match = RTF_CONTROL_WORD.exec(rtf);
        if (!match) {
          i += 2; // símbolo de controle sem texto (hífen opcional, etc.)
          continue;
        }
        const [whole, word, parameter] = match;
        i += whole.length;
        if (RTF_SKIPPED_DESTINATIONS.has(word)) skip = true;
        else if (skip) continue;
        else if (RTF_LINE_BREAKS.has(word)) out += '\n';
        else if (word === 'tab' || word === 'cell') out += '\t';
        else if (word === 'uc' && parameter) fallbackLength = Number(parameter);
        else if (word === 'u' && parameter) {
          const code = Number(parameter);
          out += String.fromCharCode(code < 0 ? code + 65536 : code);
          pendingFallback = fallbackLength;
        }
      }
    } else {
      // Quebras de linha do arquivo não são quebras do documento.
      if (char !== '\r' && char !== '\n') emit(char);
      i++;
    }
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Texto do `word/document.xml` de um DOCX, um parágrafo por linha. */
export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, entity: string) => {
      if (entity.startsWith('#')) {
        const code =
          entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : '';
      }
      return XML_ENTITIES[entity] ?? whole;
    });
}
