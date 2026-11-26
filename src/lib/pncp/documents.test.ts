import { describe, expect, it } from 'vitest';
import {
  buildDocumentListUrl,
  buildDocumentUrl,
  parseDocumentList,
  selectDocuments,
  type PncpDocument,
} from './documents';

const ref = { cnpj: '78200482000110', year: '2026', sequence: 10 };

const doc = (
  sequence: number,
  typeId: number | null,
  typeName: string,
  title = '',
): PncpDocument => ({
  sequence,
  typeId,
  typeName,
  title,
});

describe('endereços', () => {
  it('usa o caminho /api/pncp, que aceita clientes externos', () => {
    expect(buildDocumentListUrl(ref)).toBe(
      'https://pncp.gov.br/api/pncp/v1/orgaos/78200482000110/compras/2026/10/arquivos?pagina=1&tamanhoPagina=50',
    );
    expect(buildDocumentUrl(ref, 3)).toBe(
      'https://pncp.gov.br/api/pncp/v1/orgaos/78200482000110/compras/2026/10/arquivos/3',
    );
  });
});

describe('parseDocumentList', () => {
  it('normaliza os registros e ignora inativos e inválidos', () => {
    const list = parseDocumentList([
      {
        sequencialDocumento: 1,
        titulo: '  PE102026 -  Edital.pdf ',
        tipoDocumentoId: 2,
        tipoDocumentoNome: 'Edital',
        statusAtivo: true,
        url: 'https://pncp.gov.br/pncp-api/v1/orgaos/x/compras/2026/10/arquivos/1',
      },
      { sequencialDocumento: 2, titulo: 'Antigo', tipoDocumentoId: 2, statusAtivo: false },
      { sequencialDocumento: 'três', titulo: 'Quebrado' },
      { sequencialDocumento: 4 },
    ]);
    expect(list).toEqual([
      { sequence: 1, title: 'PE102026 - Edital.pdf', typeId: 2, typeName: 'Edital' },
      { sequence: 4, title: '', typeId: null, typeName: 'Documento' },
    ]);
  });

  it('devolve lista vazia quando o corpo não é uma lista', () => {
    expect(parseDocumentList({ erro: true })).toEqual([]);
    expect(parseDocumentList(null)).toEqual([]);
  });
});

describe('selectDocuments', () => {
  it('lê o edital antes do termo de referência e ignora o resto', () => {
    const selected = selectDocuments([
      doc(1, 4, 'Termo de Referência'),
      doc(2, 3, 'Minuta do Contrato', 'Anexo I - minuta'),
      doc(3, 2, 'Edital'),
      doc(4, 16, 'Outros Documentos', 'Planilha de custos'),
    ]);
    expect(selected.map((item) => item.sequence)).toEqual([3, 1]);
  });

  it('busca o termo de referência pelo título quando ele veio como outro tipo', () => {
    const selected = selectDocuments([
      doc(1, 2, 'Edital', '5__EDITAL_PE_N_0412026'),
      doc(2, 16, 'Outros Documentos', '3___TR__2026__DECORAO_NATALINA'),
      doc(3, 16, 'Outros Documentos', 'Anexo_I__Termo_de_refetencia'),
      doc(4, 16, 'Outros Documentos', 'Mapa de preços'),
      doc(5, 10, 'Documento de Formalização da Demanda - DFD', 'TR AQUISICAO'),
    ]);
    expect(selected.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it('não procura anexos quando já existe um termo de referência', () => {
    const selected = selectDocuments([
      doc(1, 2, 'Edital'),
      doc(2, 4, 'Termo de Referência'),
      doc(3, 16, 'Outros Documentos', 'Anexo I - TR antigo'),
    ]);
    expect(selected.map((item) => item.sequence)).toEqual([1, 2]);
  });

  it('usa o aviso nas contratações diretas e limita a quantidade', () => {
    expect(selectDocuments([doc(1, 1, 'Aviso de Contratação Direta')])).toHaveLength(1);
    const many = Array.from({ length: 8 }, (_, index) => doc(index + 1, 2, 'Edital'));
    expect(selectDocuments(many).map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it('cai no primeiro documento útil quando nenhum tem o tipo esperado', () => {
    const selected = selectDocuments([
      doc(1, 20, 'Ato que autoriza a Contratação Direta'),
      doc(2, 16, 'Outros Documentos', 'Chamamento público'),
    ]);
    expect(selected.map((item) => item.sequence)).toEqual([2]);
    expect(selectDocuments([])).toEqual([]);
  });
});
