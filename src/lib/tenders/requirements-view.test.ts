import { describe, expect, it } from 'vitest';
import { buildRequirementsView, sanitizeListQuery, type RequirementRow } from './requirements-view';

const row = (position: number, overrides: Partial<RequirementRow>): RequirementRow => ({
  id: `r${position}`,
  position,
  category: 'OTHER',
  procedural: false,
  label: null,
  text: 'As empresas deverão comprovar capital ou patrimônio líquido mínimo de 5% do valor estimado.',
  documentType: 'Edital',
  page: 1,
  aiCategory: null,
  aiProcedural: null,
  aiTitle: null,
  aiHighlight: null,
  ...overrides,
});

const rules = [
  row(0, { category: 'OTHER', procedural: true, text: 'A habilitação será verificada no SICAF.' }),
  row(1, { category: 'FISCAL', text: 'Prova de inscrição no CNPJ;' }),
  row(2, {
    category: 'TECHNICAL',
    text: 'Atestado de capacidade técnica compatível com o objeto.',
  }),
  row(3, { category: 'FINANCIAL' }),
];

const reviewed = [
  row(0, { category: 'TECHNICAL', aiCategory: 'OTHER', aiProcedural: true }),
  row(1, {
    category: 'OTHER',
    aiCategory: 'FINANCIAL',
    aiProcedural: false,
    aiTitle: 'Capital ou patrimônio líquido mínimo de 5%',
    aiHighlight: true,
  }),
  row(2, {
    category: 'OTHER',
    text: 'Prova de inscrição no CNPJ;',
    aiCategory: 'FISCAL',
    aiProcedural: false,
    aiTitle: 'Prova de inscrição no CNPJ',
    aiHighlight: false,
  }),
];

describe('buildRequirementsView', () => {
  it('agrupa pela categoria das regras, com a qualificação técnica primeiro', () => {
    const view = buildRequirementsView(rules, { useAi: true, showProcedural: false });
    expect(view.groups.map((group) => [group.category, group.items.length])).toEqual([
      ['TECHNICAL', 1],
      ['FINANCIAL', 1],
      ['FISCAL', 1],
    ]);
    expect(view).toMatchObject({ requirementCount: 3, proceduralCount: 1, aiApplied: false });
    expect(view.highlights).toEqual([]);
  });

  it('mostra as regras de procedimento só quando pedido', () => {
    const view = buildRequirementsView(rules, { useAi: false, showProcedural: true });
    expect(view.groups.at(-1)).toMatchObject({ category: 'OTHER', items: [{ procedural: true }] });
  });

  it('usa a classificação, o título e o destaque da IA', () => {
    const view = buildRequirementsView(reviewed, { useAi: true, showProcedural: false });
    expect(view.aiApplied).toBe(true);
    expect(view).toMatchObject({ requirementCount: 2, proceduralCount: 1 });
    expect(view.groups.map((group) => group.category)).toEqual(['FINANCIAL', 'FISCAL']);
    expect(view.highlights.map((item) => item.title)).toEqual([
      'Capital ou patrimônio líquido mínimo de 5%',
    ]);
    // O título que não encurta a cláusula não é exibido.
    expect(view.groups[1].items[0].title).toBeNull();
  });

  it('volta à classificação das regras quando a IA é desligada', () => {
    const view = buildRequirementsView(reviewed, { useAi: false, showProcedural: false });
    expect(view.aiApplied).toBe(false);
    expect(view.requirementCount).toBe(3);
    expect(view.highlights).toEqual([]);
    expect(view.groups.every((group) => group.items.every((item) => item.title === null))).toBe(
      true,
    );
  });

  it('mantém nas regras as cláusulas que a IA não recebeu', () => {
    const mixed = [...reviewed, row(3, { category: 'LEGAL', text: 'Contrato social em vigor.' })];
    const view = buildRequirementsView(mixed, { useAi: true, showProcedural: false });
    expect(view.groups.map((group) => group.category)).toEqual(['FINANCIAL', 'LEGAL', 'FISCAL']);
  });
});

describe('sanitizeListQuery', () => {
  it('mantém os filtros conhecidos da listagem', () => {
    expect(
      sanitizeListQuery(
        'q=gest%C3%A3o+de+frota&nicho=logtech&uf=PR&ordem=prazo&pagina=3&porPagina=50',
      ),
    ).toBe('q=gest%C3%A3o+de+frota&nicho=logtech&uf=PR&ordem=prazo&pagina=3&porPagina=50');
    expect(sanitizeListQuery('nicho=todos&uf=todos&modalidade=6')).toBe(
      'nicho=todos&uf=todos&modalidade=6',
    );
  });

  it('descarta chaves desconhecidas e valores fora do formato', () => {
    expect(
      sanitizeListQuery('uf=PR&next=https://evil.example&ordem=<script>&pagina=abc&porPagina=7'),
    ).toBe('uf=PR');
    expect(sanitizeListQuery(undefined)).toBe('');
    expect(sanitizeListQuery('q='.padEnd(500, 'a'))).toBe('');
    expect(sanitizeListQuery(['uf=SC', 'uf=PR'])).toBe('uf=SC');
  });
});
