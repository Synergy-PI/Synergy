import { describe, expect, it } from 'vitest';
import {
  AI_CATEGORIES_COMPLETE,
  AI_MAX_CLAUSES,
  buildAiRequest,
  parseAiResponse,
  type AiClauseSource,
} from './requirements-ai';

const clauses: AiClauseSource[] = [
  { position: 0, page: 10, text: 'A habilitação será verificada por meio do SICAF.' },
  {
    position: 1,
    page: 33,
    text: 'Prova de inscrição no Cadastro Nacional de Pessoa Jurídica – CNPJ;',
  },
  {
    position: 2,
    page: 35,
    text: 'As empresas deverão comprovar capital ou patrimônio líquido mínimo de 5% do valor estimado da contratação.',
  },
];

const answer = (itens: unknown[]) => JSON.stringify({ itens });
const full = [
  { i: 1, k: 'procedimento', c: 'outras', t: '', d: false },
  { i: 2, k: 'exigencia', c: 'fiscal', t: 'Prova de inscrição no CNPJ', d: false },
  {
    i: 3,
    k: 'exigencia',
    c: 'economica',
    t: 'Capital ou patrimônio líquido mínimo de 5%',
    d: true,
  },
];

describe('buildAiRequest', () => {
  it('numera as cláusulas a partir de 1 e guarda a posição de cada uma', () => {
    const request = buildAiRequest('Aquisição de software', clauses);
    const body = JSON.parse(request.userContent);
    expect(body.objeto).toBe('Aquisição de software');
    expect(body.clausulas.map((clause: { i: number; p: number }) => [clause.i, clause.p])).toEqual([
      [1, 10],
      [2, 33],
      [3, 35],
    ]);
    expect(request.positions).toEqual([0, 1, 2]);
  });

  it('limita a quantidade de cláusulas e o tamanho de cada texto', () => {
    const many = Array.from({ length: AI_MAX_CLAUSES + 30 }, (_, position) => ({
      position,
      page: 1,
      text: 'x'.repeat(5000),
    }));
    const request = buildAiRequest('o'.repeat(5000), many);
    const body = JSON.parse(request.userContent);
    expect(body.clausulas).toHaveLength(AI_MAX_CLAUSES);
    expect(body.clausulas[0].x.length).toBeLessThan(1300);
    expect(body.objeto.length).toBe(600);
    expect(request.positions).toHaveLength(AI_MAX_CLAUSES);
  });
});

describe('parseAiResponse', () => {
  it('aceita a resposta completa e traduz tipo e categoria', () => {
    const result = parseAiResponse(answer(full), clauses);
    expect(result).toEqual({
      ok: true,
      discardedTitles: 0,
      items: [
        { position: 0, procedural: true, category: 'OTHER', title: null, highlight: false },
        {
          position: 1,
          procedural: false,
          category: 'FISCAL',
          title: 'Prova de inscrição no CNPJ',
          highlight: false,
        },
        {
          position: 2,
          procedural: false,
          category: 'FINANCIAL',
          title: 'Capital ou patrimônio líquido mínimo de 5%',
          highlight: true,
        },
      ],
    });
  });

  it('lê o JSON mesmo dentro de uma cerca de código', () => {
    const fenced = `Aqui está:\n\`\`\`json\n${answer(full)}\n\`\`\``;
    expect(parseAiResponse(fenced, clauses).ok).toBe(true);
  });

  it('descarta o título com número que não está na cláusula, mas mantém a classificação', () => {
    const invented = [...full.slice(0, 2), { ...full[2], t: 'Patrimônio líquido mínimo de 10%' }];
    const result = parseAiResponse(answer(invented), clauses);
    expect(result.ok && result.discardedTitles).toBe(1);
    expect(result.ok && result.items[2]).toMatchObject({
      title: null,
      highlight: true,
      category: 'FINANCIAL',
    });
  });

  it('descarta títulos longos demais', () => {
    const long = [...full.slice(0, 2), { ...full[2], t: 'Capital mínimo '.repeat(20) }];
    const result = parseAiResponse(answer(long), clauses);
    expect(result.ok && result.items[2].title).toBeNull();
  });

  it('não marca destaque nem título em regra de procedimento', () => {
    const procedure = [{ ...full[0], t: 'Verificação no SICAF', d: true }, ...full.slice(1)];
    const result = parseAiResponse(answer(procedure), clauses);
    expect(result.ok && result.items[0]).toMatchObject({ title: null, highlight: false });
  });

  it('recusa resposta ilegível, incompleta ou fora do combinado', () => {
    expect(parseAiResponse('desculpe, não consegui', clauses).ok).toBe(false);
    expect(parseAiResponse('{"itens": "nenhum"}', clauses).ok).toBe(false);
    // Só 1 de 3 cláusulas.
    expect(parseAiResponse(answer(full.slice(0, 1)), clauses).ok).toBe(false);
    expect(parseAiResponse(answer([...full, { ...full[0], i: 9 }]), clauses).ok).toBe(false);
    expect(
      parseAiResponse(answer([{ ...full[0], k: 'talvez' }, ...full.slice(1)]), clauses).ok,
    ).toBe(false);
    expect(
      parseAiResponse(answer([{ ...full[0], c: 'ambiental' }, ...full.slice(1)]), clauses).ok,
    ).toBe(false);
  });

  it('ignora a repetição de uma cláusula já respondida', () => {
    const result = parseAiResponse(answer([...full, { ...full[1], c: 'juridica' }]), clauses);
    expect(result.ok && result.items).toHaveLength(3);
    expect(result.ok && result.items[1].category).toBe('FISCAL');
  });

  it('cobre todas as categorias do extrator', () => {
    expect(AI_CATEGORIES_COMPLETE).toBe(true);
  });
});
