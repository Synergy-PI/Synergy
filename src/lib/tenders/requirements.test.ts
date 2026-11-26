import { describe, expect, it } from 'vitest';
import { extractRequirements } from './requirements';

// Trechos montados a partir da estrutura de editais reais do PNCP (modelos da AGU e do Estado do Paraná).
const EDITAL_PAGE_1 = `Proc. Adm. nº 35/2026 Edital PE nº 15/2026
Página 1 de 3
4. DA APRESENTAÇÃO DA PROPOSTA E DOS DOCUMENTOS DE HABILITAÇÃO
4.1. Os licitantes encaminharão, exclusivamente por meio do sistema, a proposta com o preço.
8. DA FASE DE HABILITAÇÃO
8.1. Os documentos previstos no Termo de Referência, necessários e suficientes para demonstrar a
capacidade do licitante de realizar o objeto da licitação, serão exigidos para fins de habilitação.
8.9. A habilitação será verificada por meio do SICAF, nos documentos por ele abrangidos.
9. DOS RECURSOS
9.1. A interposição de recurso referente à habilitação observará o disposto no art. 165.`;

const EDITAL_PAGE_2 = `Proc. Adm. nº 35/2026 Edital PE nº 15/2026
Página 2 de 3
TERMO DE REFERÊNCIA
8. DA HABILITAÇÃO
8.1. A documentação relativa à HABILITAÇÃO JURÍDICA consistirá em:
a) no caso de sociedade empresária: ato constitutivo, estatuto ou contrato social em vigor,
devidamente registrado na Junta Comercial da respectiva sede;
8.2. A documentação relativa à QUALIFICAÇÃO ECONÔMICO-FINANCEIRA consistirá em:
a) Certidão negativa de pedido de falência, expedida pelo distribuidor da sede da pessoa jurídica;
b) As empresas deverão comprovar capital ou patrimônio líquido mínimo de 5% do valor estimado;
8.3. A documentação relativa à REGULARIDADE FISCAL E TRABALHISTA consistirá em:
a) Prova de inscrição no Cadastro Nacional de Pessoa Jurídica – CNPJ;`;

const EDITAL_PAGE_3 = `Proc. Adm. nº 35/2026 Edital PE nº 15/2026
Página 3 de 3
b) Certificado de Regularidade de Situação para com o Fundo de Garantia de Tempo de Serviço (FGTS);
9. DA QUALIFICAÇÃO TÉCNICA
9.1. Atestado de capacidade técnica comprovando o fornecimento de, no mínimo, 30% do quantitativo,
pelo prazo de 12 (doze) meses.
10. DA GARANTIA DO PRODUTO
10.1. O objeto deverá ter garantia de, no mínimo,
12 (doze) meses, contados do recebimento definitivo.`;

const pdf = [EDITAL_PAGE_1, EDITAL_PAGE_2, EDITAL_PAGE_3];

describe('extractRequirements', () => {
  const found = extractRequirements(pdf);
  const byText = (start: string) => found.find((item) => item.text.startsWith(start));

  it('pega só as cláusulas das seções de habilitação', () => {
    expect(found.map((item) => item.label)).toEqual([
      '8.1',
      '8.9',
      'a)',
      'a)',
      'b)',
      'a)',
      'b)',
      '9.1',
    ]);
    // A seção de apresentação da proposta, os recursos e a garantia do produto ficam de fora.
    expect(found.some((item) => item.text.includes('encaminharão'))).toBe(false);
    expect(found.some((item) => item.text.includes('interposição'))).toBe(false);
    expect(found.some((item) => item.text.includes('garantia de, no mínimo'))).toBe(false);
  });

  it('usa o título do grupo e as palavras da cláusula para definir a categoria', () => {
    expect(byText('no caso de sociedade empresária')?.category).toBe('LEGAL');
    expect(byText('Certidão negativa de pedido de falência')?.category).toBe('FINANCIAL');
    expect(byText('As empresas deverão comprovar capital')?.category).toBe('FINANCIAL');
    expect(byText('Prova de inscrição no Cadastro Nacional')?.category).toBe('FISCAL');
    // O item continua na página seguinte, ainda dentro do grupo fiscal.
    expect(byText('Certificado de Regularidade')?.category).toBe('FISCAL');
    expect(byText('Atestado de capacidade técnica')?.category).toBe('TECHNICAL');
  });

  it('junta as linhas quebradas e guarda a página onde a cláusula começa', () => {
    const legal = byText('no caso de sociedade empresária');
    expect(legal?.text).toBe(
      'no caso de sociedade empresária: ato constitutivo, estatuto ou contrato social em vigor, devidamente registrado na Junta Comercial da respectiva sede;',
    );
    expect(legal?.page).toBe(2);
    expect(byText('Certificado de Regularidade')?.page).toBe(3);
  });

  it('não confunde "12 (doze) meses" no início de uma linha com a cláusula 12', () => {
    expect(byText('Atestado de capacidade técnica')?.text).toBe(
      'Atestado de capacidade técnica comprovando o fornecimento de, no mínimo, 30% do quantitativo, pelo prazo de 12 (doze) meses.',
    );
  });

  it('marca as regras de procedimento, mas não as exigências', () => {
    expect(byText('Os documentos previstos no Termo de Referência')?.procedural).toBe(true);
    expect(byText('A habilitação será verificada por meio do SICAF')?.procedural).toBe(true);
    expect(byText('Prova de inscrição')?.procedural).toBe(false);
    expect(byText('Atestado de capacidade técnica')?.procedural).toBe(false);
  });

  it('ignora cabeçalhos e rodapés repetidos nas páginas', () => {
    expect(found.some((item) => item.text.includes('Proc. Adm.'))).toBe(false);
    expect(found.some((item) => /Página \d de 3/.test(item.text))).toBe(false);
  });

  it('entende o anexo de documentos com o grupo e o conteúdo na mesma cláusula', () => {
    const annex = extractRequirements([
      `14 REQUISITOS DE HABILITAÇÃO
14.1 Os requisitos de habilitação são aqueles previstos nos Documentos de Habilitação (Anexo II).
15 DA SUBCONTRATAÇÃO
15.1 Não será admitida a subcontratação do objeto.`,
      `ANEXO II
DOCUMENTOS DE HABILITAÇÃO
1.2 DOCUMENTOS DE HABILITAÇÃO JURÍDICA: Cédula de Identidade, no caso de pessoa física.
1.4 DOCUMENTOS DE QUALIFICAÇÃO ECONÔMICO-FINANCEIRA:
1.4.1 balanço patrimonial dos 2 (dois) últimos exercícios sociais;
ANEXO III - MODELO DE PROPOSTA
1.1 Declaramos que o preço proposto inclui todos os custos da habilitação técnica do pessoal.`,
    ]);
    expect(annex.map((item) => [item.label, item.category, item.page])).toEqual([
      ['14.1', 'OTHER', 1],
      ['1.2', 'LEGAL', 2],
      ['1.4.1', 'FINANCIAL', 2],
    ]);
    expect(annex[1].text).toBe('Cédula de Identidade, no caso de pessoa física.');
  });

  it('trata cada linha como parágrafo em documentos do Word, que perdem a numeração', () => {
    const word = [
      `DA APRESENTAÇÃO DA PROPOSTA
A proposta deverá ser enviada pelo sistema eletrônico.
DA FASE DE HABILITAÇÃO
QUALIFICAÇÃO TÉCNICA
Registro ou inscrição da empresa na entidade profissional competente CREA, em plena validade;
Comprovar a execução de serviço de, no mínimo, 69,00 m de rede de hidrantes.
DOS RECURSOS
Caberá recurso no prazo de 3 (três) dias úteis.`,
    ];
    const paragraphs = extractRequirements(word, { paragraphs: true });
    expect(paragraphs.map((item) => item.text)).toEqual([
      'Registro ou inscrição da empresa na entidade profissional competente CREA, em plena validade;',
      'Comprovar a execução de serviço de, no mínimo, 69,00 m de rede de hidrantes.',
    ]);
    expect(paragraphs.every((item) => item.category === 'TECHNICAL')).toBe(true);
  });

  it('não repete o requisito que aparece no edital e de novo em um anexo', () => {
    const repeated = extractRequirements([
      `8. DA HABILITAÇÃO
8.1. Prova de inscrição no Cadastro Nacional de Pessoa Jurídica – CNPJ;
9. DOS RECURSOS
ANEXO I - DOCUMENTOS DE HABILITAÇÃO
1.1. Prova de inscrição no Cadastro Nacional de Pessoa Jurídica - CNPJ;`,
    ]);
    expect(repeated).toHaveLength(1);
  });

  it('devolve lista vazia quando o documento não tem seção de habilitação', () => {
    expect(
      extractRequirements(['1. DO OBJETO\n1.1. Aquisição de material de expediente.']),
    ).toEqual([]);
    expect(extractRequirements([])).toEqual([]);
  });
});
