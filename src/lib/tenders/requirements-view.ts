// O que a tela de requisitos mostra a partir das cláusulas gravadas: grupos, destaques e contagens.
// Módulo puro (sem banco) para facilitar testes unitários.
import type { RequirementCategory } from './requirements';
import { ALL, TENDER_PAGE_SIZES, TENDER_SORTS } from './filters';

/** Ordem dos grupos na tela: primeiro o que costuma decidir se vale participar. */
export const REQUIREMENT_CATEGORY_ORDER: readonly RequirementCategory[] = [
  'TECHNICAL',
  'FINANCIAL',
  'LEGAL',
  'FISCAL',
  'DECLARATION',
  'OTHER',
];

export type RequirementRow = {
  id: string;
  position: number;
  category: RequirementCategory;
  procedural: boolean;
  label: string | null;
  text: string;
  documentType: string;
  page: number;
  aiCategory: RequirementCategory | null;
  aiProcedural: boolean | null;
  aiTitle: string | null;
  aiHighlight: boolean | null;
};

export type RequirementItem = {
  id: string;
  label: string | null;
  /** Título curto escrito pela IA; `null` quando não há ou quando não resume o texto. */
  title: string | null;
  /** Texto literal do documento. */
  text: string;
  documentType: string;
  page: number;
  highlight: boolean;
  procedural: boolean;
};

export type RequirementGroup = { category: RequirementCategory; items: RequirementItem[] };

export type RequirementsView = {
  groups: RequirementGroup[];
  /** Exigências que mais restringem a participação, segundo a IA, na ordem do documento. */
  highlights: RequirementItem[];
  requirementCount: number;
  proceduralCount: number;
  /** A classificação exibida é a da IA (e não só a das regras). */
  aiApplied: boolean;
};

export type RequirementsViewOptions = {
  /** Usar a classificação da IA quando ela existir. */
  useAi: boolean;
  /** Incluir as regras de procedimento na lista. */
  showProcedural: boolean;
};

/** Um título só ajuda se for bem mais curto que a cláusula que ele resume. */
const TITLE_MIN_SAVING = 20;

export function buildRequirementsView(
  rows: readonly RequirementRow[],
  options: RequirementsViewOptions,
): RequirementsView {
  const aiApplied = options.useAi && rows.some((row) => row.aiProcedural !== null);
  const byCategory = new Map<RequirementCategory, RequirementItem[]>();
  const highlights: RequirementItem[] = [];
  let requirementCount = 0;
  let proceduralCount = 0;

  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    // Cláusulas além do limite enviado à IA ficam com a classificação das regras.
    const reviewed = aiApplied && row.aiProcedural !== null;
    const procedural = reviewed ? row.aiProcedural === true : row.procedural;
    const category = reviewed && row.aiCategory ? row.aiCategory : row.category;
    const title =
      reviewed && row.aiTitle && row.aiTitle.length + TITLE_MIN_SAVING < row.text.length
        ? row.aiTitle
        : null;
    const item: RequirementItem = {
      id: row.id,
      label: row.label,
      title,
      text: row.text,
      documentType: row.documentType,
      page: row.page,
      highlight: reviewed && !procedural && row.aiHighlight === true,
      procedural,
    };

    if (procedural) proceduralCount++;
    else requirementCount++;
    if (item.highlight) highlights.push(item);
    if (procedural && !options.showProcedural) continue;
    const items = byCategory.get(category) ?? [];
    items.push(item);
    byCategory.set(category, items);
  }

  return {
    groups: REQUIREMENT_CATEGORY_ORDER.flatMap((category) => {
      const items = byCategory.get(category);
      return items ? [{ category, items }] : [];
    }),
    highlights,
    requirementCount,
    proceduralCount,
    aiApplied,
  };
}

const LIST_QUERY_KEYS = ['q', 'nicho', 'uf', 'modalidade', 'ordem', 'pagina', 'porPagina'] as const;
const MAX_LIST_QUERY_LENGTH = 400;

/**
 * Query string da listagem de onde o usuário veio, para o link "Voltar" devolvê-lo ao mesmo lugar.
 * Vem da URL, então só as chaves e os formatos conhecidos são mantidos.
 */
export function sanitizeListQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw.length > MAX_LIST_QUERY_LENGTH) return '';
  const input = new URLSearchParams(raw);
  const output = new URLSearchParams();
  for (const key of LIST_QUERY_KEYS) {
    const item = input.get(key)?.trim();
    if (!item) continue;
    const valid =
      key === 'q'
        ? item.length <= 80
        : key === 'ordem'
          ? TENDER_SORTS.some((sort) => sort === item)
          : key === 'porPagina'
            ? TENDER_PAGE_SIZES.some((size) => String(size) === item)
            : key === 'pagina' || key === 'modalidade'
              ? /^\d{1,6}$/.test(item)
              : key === 'uf'
                ? item === ALL || /^[A-Za-z]{2}$/.test(item)
                : /^[a-z0-9-]{1,60}$/.test(item);
    if (valid) output.set(key, item);
  }
  return output.toString();
}
