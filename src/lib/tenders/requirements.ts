// Localiza as seções de habilitação de um edital e as quebra em cláusulas, sem IA.
// Módulo puro (texto por página -> requisitos com categoria, página e texto literal), com testes.
//
// As regras vieram de uma amostra de 65 licitações do Paraná (nov/2026): acharam a seção em 52 dos 54
// editais com texto legível, em ~40 ms. É uma triagem: há ruído, e por isso cada requisito guarda o
// texto literal e a página para conferência.
import { fold } from './text';

export const REQUIREMENT_CATEGORIES = [
  'TECHNICAL',
  'FINANCIAL',
  'LEGAL',
  'FISCAL',
  'DECLARATION',
  'OTHER',
] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export type ExtractedRequirement = {
  category: RequirementCategory;
  /** Numeração da cláusula no documento ("8.1.3", "a)"); vazio quando não há. */
  label: string;
  /** Página (a partir de 1) onde a cláusula começa. */
  page: number;
  /** Texto literal da cláusula. */
  text: string;
  /** Regra de procedimento (como a administração conduz a habilitação), não exigência à empresa. */
  procedural: boolean;
};

export type ExtractOptions = {
  /**
   * Documentos do Word e RTF chegam com um parágrafo por linha e sem a numeração automática:
   * cada linha vira uma cláusula. Em PDF, as linhas são quebras visuais e se juntam à cláusula anterior.
   */
  paragraphs?: boolean;
};

type ClauseKind = 'num' | 'item' | 'loose' | 'para' | 'annex';

type Clause = {
  kind: ClauseKind;
  label: string;
  /** Profundidade da numeração (1 = "8.", 2 = "8.1"); valores altos são itens e títulos soltos. */
  level: number;
  page: number;
  text: string;
};

const ITEM_LEVEL = 90;
const BULLET_LEVEL = 91;
const LOOSE_LEVEL = 80;
const PARAGRAPH_LEVEL = 95;
const MAX_TOP_LEVEL_NUMBER = 60;

/** Linhas que se repetem em muitas páginas (cabeçalho, rodapé, "Página 3 de 62") não são conteúdo. */
function repeatedLines(pages: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.split('\n')) {
      const key = lineKey(line);
      if (key.length < 3 || key.length > 160 || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([key]) => key));
}

/** Linha sem acentos, com os números trocados por "#", para comparar cabeçalhos entre páginas. */
function lineKey(line: string): string {
  return fold(line).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

const NUMERIC = /^(\d{1,2}(?:\.\d{1,2}){0,5})(\.?)\s*[-–—)]?\s+(?=\S)/;
const LETTER = /^\(?([a-z](?:\.\d{1,2})?)\)\s+(?=\S)/i;
const ROMAN = /^([IVXL]{1,6})\s*[-–—)]\s+(?=\S)/;
const BULLET = /^[•●▪◦✓➢\-–]\s+(?=\S)/;

type Marker = { kind: 'num' | 'item'; label: string; level: number; rest: string };

function parseMarker(line: string): Marker | null {
  const numeric = NUMERIC.exec(line);
  if (numeric) {
    const [whole, number, dot] = numeric;
    const rest = line.slice(whole.length);
    const level = number.split('.').length;
    // "12 (doze) meses" no início de uma linha quebrada não é a cláusula 12.
    if (level === 1 && !dot && !/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2}/.test(rest)) return null;
    if (level === 1 && Number(number) > MAX_TOP_LEVEL_NUMBER) return null;
    return { kind: 'num', label: number, level, rest };
  }
  const letter = LETTER.exec(line);
  if (letter) {
    return {
      kind: 'item',
      label: `${letter[1]})`,
      level: ITEM_LEVEL,
      rest: line.slice(letter[0].length),
    };
  }
  const roman = ROMAN.exec(line);
  if (roman) {
    return { kind: 'item', label: roman[1], level: ITEM_LEVEL, rest: line.slice(roman[0].length) };
  }
  const bullet = BULLET.exec(line);
  if (bullet) {
    return { kind: 'item', label: '', level: BULLET_LEVEL, rest: line.slice(bullet[0].length) };
  }
  return null;
}

/** Título solto (sem numeração) de um grupo de documentos: "Habilitação jurídica", "Qualificação Técnica"... */
const LOOSE_HEADING =
  /^(d[aeo]s?\s+)?((documenta[cç][aã]o|documentos|requisitos|exig[eê]ncias|condi[cç][oõ]es)\s+(de|para|relativ[ao]s?\s+[aà])\s+)?(habilita[cç][aã]o|qualifica[cç][aã]o|regularidade|capacidade)(\s+[\p{L} ,\-–]{4,70})?:?$/iu;

/** "ANEXO II", "ANEXO 3 - MODELO DE PROPOSTA": começa outro documento dentro do mesmo arquivo. */
const ANNEX = /^ANEXO\s+([IVXL]{1,6}|\d{1,2})\b/;

function upperRatio(text: string): { letters: number; ratio: number } {
  const letters = text.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return { letters: letters.length, ratio: letters.length > 0 ? upper / letters.length : 0 };
}

/** Quebra o documento em cláusulas, cada uma com a página onde começa. */
function toClauses(pages: readonly string[], { paragraphs = false }: ExtractOptions): Clause[] {
  const repeated = repeatedLines(pages);
  const clauses: Clause[] = [];
  let current: Clause | null = null;
  const push = (clause: Clause) => {
    current = clause;
    clauses.push(clause);
  };

  pages.forEach((pageText, index) => {
    const page = index + 1;
    for (const raw of pageText.split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      const key = lineKey(line);
      if (repeated.has(key) || key === 'pagina # de #' || key === '#') continue;

      const marker = parseMarker(line);
      if (ANNEX.test(line) && line.length < 120) {
        push({ kind: 'annex', label: '', level: 0, page, text: line });
      } else if (marker) {
        push({
          kind: marker.kind,
          label: marker.label,
          level: marker.level,
          page,
          text: marker.rest,
        });
      } else if (
        LOOSE_HEADING.test(line) &&
        /^\p{Lu}/u.test(line) &&
        line.length < 90 &&
        !/[.;,]$/.test(line)
      ) {
        push({ kind: 'loose', label: '', level: LOOSE_LEVEL, page, text: line });
      } else if (paragraphs) {
        const { letters, ratio } = upperRatio(line);
        const title = line.length < 110 && !/[.;,]$/.test(line) && letters >= 6 && ratio > 0.85;
        push({
          kind: title ? 'loose' : 'para',
          label: '',
          level: title ? LOOSE_LEVEL : PARAGRAPH_LEVEL,
          page,
          text: line,
        });
      } else if (current) {
        const clause: Clause = current;
        clause.text += (clause.text.endsWith('-') ? '' : ' ') + line;
      }
    }
  });
  return clauses;
}

// Os padrões abaixo são aplicados ao texto "dobrado" (minúsculas, sem acentos).

const CATEGORY_HEADINGS: ReadonlyArray<readonly [RequirementCategory, RegExp]> = [
  ['TECHNICAL', /qualificacao tecnic|capacidade tecnic|habilitacao tecnic/],
  ['FINANCIAL', /economic[oa][- ]financeir|qualificacao economic|habilitacao economic/],
  ['LEGAL', /habilitacao juridica|capacidade juridica/],
  [
    'FISCAL',
    /regularidade fiscal|habilitacao fiscal|fiscal(,| e) (social|trabalhista)|regularidade trabalhista/,
  ],
  ['DECLARATION', /^(d[aeo]s? )?(outras )?declarac(ao|oes)\b/],
];

const CATEGORY_CONTENT: ReadonlyArray<readonly [RequirementCategory, RegExp]> = [
  [
    'TECHNICAL',
    /atestado|capacidade tecnic|acervo tecnico|responsavel tecnico|\b(crea|cau|cra|crc|crm|crq|oab)\b|conselho (regional|profissional|de classe)|equipe tecnica|visita tecnica|vistoria|prova de conceito|amostra|certificac(ao|oes) (iso|tecnica|do fabricante|de qualidade)|experiencia (minima|anterior)/,
  ],
  [
    'FINANCIAL',
    /falencia|recuperacao judicial|balanco|demonstrac(ao|oes) contabe|indices? de liquidez|liquidez (geral|corrente)|solvencia geral|patrimonio liquido|capital (social )?(minimo|circulante)|garantia de proposta/,
  ],
  [
    'FISCAL',
    /\bcnpj\b|\bfgts\b|\bcndt\b|debitos trabalhistas|fazenda (federal|estadual|municipal|nacional|publica)|divida ativa|seguridade social|\binss\b|cadastro de contribuinte|tributos (federais|estaduais|municipais)|regularidade (fiscal|perante|para com|com a)/,
  ],
  [
    'LEGAL',
    /contrato social|ato constitutivo|estatuto|registro (publico de empresas|comercial)|junta comercial|empresario individual|microempreendedor|\bccmei\b|decreto de autorizacao|cedula de identidade|documento de identificacao|sociedade (empresaria|simples|cooperativa|anonima)/,
  ],
  [
    'DECLARATION',
    /^declarac(ao|oes)\b|declaracao de (que|inexistencia|cumprimento|nao|idoneidade)|inciso xxxiii|menor de (18|dezoito)|trabalho (forcado|degradante|infantil)/,
  ],
];

/** Um título abre uma zona de habilitação quando fala dela, mas não de proposta, julgamento, recurso... */
const ZONE_TERMS =
  /\bhabilitacao\b|qualificacao (tecnic|economic)|regularidade fiscal|capacidade tecnic/;
const ZONE_EXCLUDE =
  /proposta|julgamento|recurso|impugnac|sanc(ao|oes)|inabilitac|manutencao|convocac|declaracao/;
const isZoneStart = (folded: string) => ZONE_TERMS.test(folded) && !ZONE_EXCLUDE.test(folded);

/** Título de grupo seguido do conteúdo na mesma cláusula: "DOCUMENTOS DE HABILITAÇÃO JURÍDICA: Cédula...". */
const INLINE_GROUP =
  /^((?:DOCUMENTOS|DOCUMENTAÇÃO|REQUISITOS)\s+(?:DE|PARA|RELATIVA À)\s+)?((?:HABILITAÇÃO|QUALIFICAÇÃO|REGULARIDADE|CAPACIDADE)\s+[\p{Lu} ,\-–]{4,60}):\s*(.*)$/u;

function headingCategory(folded: string): RequirementCategory | null {
  return CATEGORY_HEADINGS.find(([, pattern]) => pattern.test(folded))?.[0] ?? null;
}

function contentCategory(folded: string): RequirementCategory | null {
  return CATEGORY_CONTENT.find(([, pattern]) => pattern.test(folded))?.[0] ?? null;
}

/** Cláusula curta, sem ponto final, com cara de título de seção. */
function isHeading(clause: Clause): boolean {
  if (clause.kind === 'loose') return true;
  if (clause.kind !== 'num') return false;
  const text = clause.text.trim();
  if (text.length > 140 || /[.;,]$/.test(text)) return false;
  const { letters, ratio } = upperRatio(text);
  return letters >= 4 && (ratio > 0.6 || text.length < 70);
}

/** Introduz um grupo: "8.1. A documentação relativa à HABILITAÇÃO JURÍDICA consistirá em:". */
function isIntro(clause: Clause): boolean {
  return clause.text.length < 260 && /:\s*$/.test(clause.text);
}

const PROCEDURAL_OPENER =
  /^(os documentos|a documentacao|a habilitacao|a comprovacao|sera verificad|serao verificad|sera aceit|sera inabilitad|sera considerad|nao serao aceit|havendo|caso |na hipotese|quando |se o licitante|constatad|o (pregoeiro|agente de contratacao)|a verificacao|somente|apos |considerando|em caso de|a nao|o nao|e de responsabilidade|na analise|respeitada|complementacao|atualizacao de documentos|para fins de habilitacao, (sera|serao|a verificacao))/;
const PROCEDURAL_ANYWHERE =
  /somente sera(o)? exigid|sera(o)? verificad[oa]s? (por meio|se o licitante)|poder(a|ao) ser (substituid|apresentad)/;
/** Um documento concreto a entregar: a cláusula é uma exigência mesmo que comece como regra. */
const DELIVERABLE =
  /\b(atestados?|certidao|certidoes|prova de|balanco|registro ou inscricao|comprovante|alvara|licenca de|contrato social|ato constitutivo|indices?|capital|patrimonio liquido)\b/;

function isProcedural(folded: string): boolean {
  if (PROCEDURAL_ANYWHERE.test(folded)) return true;
  return PROCEDURAL_OPENER.test(folded) && !DELIVERABLE.test(folded);
}

type Zone = { level: number };

/**
 * Requisitos de habilitação de um documento. Cada um mantém o texto literal da cláusula (nada é
 * reescrito), a página e a categoria deduzida do título do grupo ou das palavras da própria cláusula.
 */
export function extractRequirements(
  pages: readonly string[],
  options: ExtractOptions = {},
): ExtractedRequirement[] {
  const requirements: ExtractedRequirement[] = [];
  let zone: Zone | null = null;
  let groupCategory: RequirementCategory | null = null;
  let groupLevel: number | null = null;

  for (const clause of toClauses(pages, options)) {
    if (clause.kind === 'annex') {
      // O título do anexo pode ser a própria zona ("ANEXO II - DOCUMENTOS DE HABILITAÇÃO").
      const title = fold(clause.text).replace(/^anexo\s+\S+\s*[-–—:.]?\s*/, '');
      zone = isZoneStart(title) ? { level: 0 } : null;
      groupCategory = null;
      continue;
    }

    let text = clause.text.trim();
    const inline = INLINE_GROUP.exec(text);
    if (inline && inline[3].length >= 12) {
      const category = headingCategory(fold(inline[2]));
      if (category) {
        zone ??= { level: clause.level };
        groupCategory = category;
        groupLevel = clause.level;
        text = inline[3].trim();
      }
    }
    const current: Clause = { ...clause, text };
    const folded = fold(text).replace(/\s+/g, ' ').trim();
    const heading = isHeading(current);

    if (heading && isZoneStart(folded)) {
      // Um subtítulo dentro da zona atual só troca a categoria; fora dela, abre uma zona nova.
      if (!zone || clause.level <= zone.level) zone = { level: clause.level };
      groupCategory = headingCategory(folded);
      groupLevel = clause.level;
      continue;
    }
    if (!zone) continue;

    const closesZone =
      (clause.kind === 'num' && clause.level <= zone.level) ||
      (clause.kind === 'loose' && zone.level >= LOOSE_LEVEL && !headingCategory(folded));
    if (heading && closesZone) {
      zone = null;
      groupCategory = null;
      continue;
    }

    const ownHeadingCategory = headingCategory(folded);
    if ((heading || isIntro(current)) && ownHeadingCategory) {
      groupCategory = ownHeadingCategory;
      groupLevel = clause.level;
      continue;
    }
    if (heading) {
      // Subtítulo sem categoria conhecida ("Disposições gerais"): encerra o grupo atual.
      if (groupLevel !== null && clause.level <= groupLevel) groupCategory = null;
      continue;
    }
    if (text.length < 12) continue;

    requirements.push({
      category: contentCategory(folded) ?? groupCategory ?? 'OTHER',
      label: clause.label,
      page: clause.page,
      text,
      procedural: isProcedural(folded),
    });
  }

  // O mesmo requisito costuma se repetir no corpo do edital e em um anexo.
  const seen = new Set<string>();
  return requirements.filter((item) => {
    const key = fold(item.text)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
