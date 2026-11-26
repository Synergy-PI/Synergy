import { describe, expect, it } from 'vitest';
import { detectDocumentKind, docxXmlToText, hasUsableText, rtfToText } from './document-formats';

const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('detectDocumentKind', () => {
  it('reconhece o formato pelos primeiros bytes', () => {
    expect(detectDocumentKind(bytes('%PDF-1.7\n'))).toBe('pdf');
    expect(detectDocumentKind(bytes('PK\x03\x04resto'))).toBe('zip');
    expect(detectDocumentKind(bytes('{\\rtf1\\ansi'))).toBe('rtf');
    expect(detectDocumentKind(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1))).toBe('ole');
    expect(detectDocumentKind(bytes('<html>'))).toBe('unknown');
    expect(detectDocumentKind(new Uint8Array())).toBe('unknown');
  });
});

describe('hasUsableText', () => {
  it('descarta páginas só com o número ou um carimbo', () => {
    expect(hasUsableText('Página 3 de 62')).toBe(false);
    expect(hasUsableText('8.1. Prova de inscrição no Cadastro Nacional de Pessoa Jurídica')).toBe(
      true,
    );
  });
});

describe('rtfToText', () => {
  it('extrai os parágrafos e ignora fontes, imagens e cabeçalhos', () => {
    const rtf =
      '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}{\\f1 Times New Roman;}}' +
      '{\\header Prefeitura Municipal\\par}' +
      '{\\*\\generator Msftedit 5.41;}' +
      "\\pard\\f0 8. DA HABILITA\\u199 \\'c7\\u195 \\'c3O\\par\r\n" +
      "8.1. Prova de inscri\\'e7\\'e3o no CNPJ;\\par\n" +
      '{\\pict\\wmetafile8 0100090000}' +
      'Valor: R$ 10 \\{estimado\\}\\tab fim\\par}';
    expect(rtfToText(rtf).split('\n').filter(Boolean)).toEqual([
      '8. DA HABILITAÇÃO',
      '8.1. Prova de inscrição no CNPJ;',
      'Valor: R$ 10 {estimado}\tfim',
    ]);
  });

  it('não duplica o caractere substituto que vem depois de \\u', () => {
    expect(rtfToText("{\\rtf1 comprova\\u231 \\'e7\\u227 \\'e3o e a\\u231?\\u227?o}")).toBe(
      'comprovação e ação',
    );
  });

  it('respeita \\uc0, que dispensa o substituto', () => {
    expect(rtfToText('{\\rtf1\\uc0 a\\u231 \\u227 o}')).toBe('ação');
  });
});

describe('docxXmlToText', () => {
  it('devolve um parágrafo por linha e decodifica as entidades', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>DA FASE DE HABILITA</w:t></w:r><w:r><w:t>ÇÃO</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Capital &gt;= 10% &amp; índices</w:t><w:tab/><w:t>fim&#225;&#xE9;</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    expect(docxXmlToText(xml)).toBe('DA FASE DE HABILITAÇÃO\nCapital >= 10% & índices\tfimáé\n');
  });
});
