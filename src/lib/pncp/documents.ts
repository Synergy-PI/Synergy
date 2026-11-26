// Documentos oficiais de uma contratação no PNCP: endereços, validação da listagem e escolha do que ler.
// Módulo puro (sem rede nem banco). A rede fica em documents-client.ts.
//
// API oficial de integração do PNCP (consultas públicas, sem autenticação):
// https://pncp.gov.br/api/pncp/swagger-ui/index.html
import { z } from 'zod';
import { fold } from '@/lib/tenders/text';
import type { PncpTenderRef } from './normalize';

const BASE_URL = 'https://pncp.gov.br/api/pncp/v1';
const LIST_PAGE_SIZE = 50;

/** Tipos de documento do PNCP que trazem as condições de habilitação. */
const TYPE_DIRECT_NOTICE = 1; // Aviso de Contratação Direta
const TYPE_EDITAL = 2;
const TYPE_REFERENCE_TERMS = 4; // Termo de Referência
const PRIMARY_TYPES = new Set([TYPE_DIRECT_NOTICE, TYPE_EDITAL, TYPE_REFERENCE_TERMS]);

/** No máximo estes documentos são baixados por licitação (cada download leva de segundos a minutos). */
export const MAX_DOCUMENTS_PER_TENDER = 4;
const MAX_PRIMARY_DOCUMENTS = 3;

function tenderPath(ref: PncpTenderRef): string {
  return `${BASE_URL}/orgaos/${ref.cnpj}/compras/${ref.year}/${ref.sequence}/arquivos`;
}

export function buildDocumentListUrl(ref: PncpTenderRef): string {
  return `${tenderPath(ref)}?pagina=1&tamanhoPagina=${LIST_PAGE_SIZE}`;
}

/**
 * Endereço de download de um documento. A listagem devolve um campo `url` apontando para `/pncp-api/`,
 * que responde 422 a clientes externos: o caminho que funciona é este, em `/api/pncp/`.
 */
export function buildDocumentUrl(ref: PncpTenderRef, sequence: number): string {
  return `${tenderPath(ref)}/${sequence}`;
}

const rawDocumentSchema = z.object({
  sequencialDocumento: z.number().int().positive(),
  titulo: z.string().nullish(),
  tipoDocumentoId: z.number().int().nullish(),
  tipoDocumentoNome: z.string().nullish(),
  statusAtivo: z.boolean().nullish(),
});

export type PncpDocument = {
  /** Número do documento dentro da contratação (usado no endereço de download). */
  sequence: number;
  title: string;
  typeId: number | null;
  /** Nome do tipo como publicado ("Edital", "Termo de Referência", "Outros Documentos"...). */
  typeName: string;
};

const clean = (value: string | null | undefined, max: number) =>
  (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Valida a listagem de documentos; registros fora do formato ou inativos são ignorados. */
export function parseDocumentList(payload: unknown): PncpDocument[] {
  if (!Array.isArray(payload)) return [];
  const documents: PncpDocument[] = [];
  for (const raw of payload) {
    const parsed = rawDocumentSchema.safeParse(raw);
    if (!parsed.success || parsed.data.statusAtivo === false) continue;
    documents.push({
      sequence: parsed.data.sequencialDocumento,
      title: clean(parsed.data.titulo, 160),
      typeId: parsed.data.tipoDocumentoId ?? null,
      typeName: clean(parsed.data.tipoDocumentoNome, 80) || 'Documento',
    });
  }
  return documents;
}

/**
 * Muitos editais só dizem "os documentos de habilitação estão no Termo de Referência", e alguns órgãos
 * publicam o TR como "Outros Documentos". O título denuncia: "TR", "Termo de Referência", "Anexo I".
 */
const LOOKS_LIKE_REFERENCE_TERMS =
  /(^|[^a-z])tr([^a-z]|$)|termo.{0,6}refer|anexo.{0,3}(i|1|01)([^a-z0-9]|$)|habilita|projeto.{0,3}basico/;
/** Tipos que nunca trazem os requisitos: minuta de contrato, estudos e documentos internos. */
const NEVER_USEFUL = /minuta|estudo tecnico|formalizacao da demanda|mapa de risco|ato que autoriza/;

/**
 * Documentos que valem o download, em ordem de leitura: edital (ou aviso de contratação direta), termo de
 * referência e, se não houver TR com esse tipo, anexos cujo título pareça um.
 */
export function selectDocuments(documents: readonly PncpDocument[]): PncpDocument[] {
  const order = (document: PncpDocument) => (document.typeId === TYPE_REFERENCE_TERMS ? 1 : 0);
  const primary = documents
    .filter((document) => document.typeId !== null && PRIMARY_TYPES.has(document.typeId))
    .sort((a, b) => order(a) - order(b) || a.sequence - b.sequence)
    .slice(0, MAX_PRIMARY_DOCUMENTS);

  const hasReferenceTerms = primary.some((document) => document.typeId === TYPE_REFERENCE_TERMS);
  const extras = hasReferenceTerms
    ? []
    : documents.filter(
        (document) =>
          !primary.includes(document) &&
          !NEVER_USEFUL.test(fold(document.typeName)) &&
          LOOKS_LIKE_REFERENCE_TERMS.test(fold(document.title)),
      );

  const selected = [...primary, ...extras].slice(0, MAX_DOCUMENTS_PER_TENDER);
  // Sem nenhum documento dos tipos esperados, o primeiro publicado costuma ser o edital.
  if (selected.length === 0) {
    const fallback = documents.find((document) => !NEVER_USEFUL.test(fold(document.typeName)));
    return fallback ? [fallback] : [];
  }
  return selected;
}
