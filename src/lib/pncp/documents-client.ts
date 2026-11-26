// Listagem e download dos documentos oficiais de uma contratação, pela API oficial de integração do PNCP.
//
// Medido em nov/2026 com 65 licitações do Paraná: listar leva ~0,4 s; baixar leva de segundos a minutos
// (mediana de 86 KB/s) e 27% dos arquivos falham na primeira tentativa (HTTP 422 ou tempo esgotado). Por
// isso o download nunca acontece durante uma requisição do usuário: ver src/lib/tenders/analysis.ts.
import { PncpError } from './client';
import {
  buildDocumentListUrl,
  buildDocumentUrl,
  parseDocumentList,
  type PncpDocument,
} from './documents';
import type { PncpTenderRef } from './normalize';

const DEFAULT_USER_AGENT = 'tenders-sync/1.0';
const LIST_TIMEOUT_MS = 60_000;
/** O maior edital da amostra (16 MB) levou 3,6 minutos. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/** Arquivos maiores que isto são recusados: um edital com texto raramente passa de 15 MB. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

const userAgent = () => process.env.PNCP_USER_AGENT || DEFAULT_USER_AGENT;

function networkError(error: unknown): PncpError {
  const timedOut = error instanceof Error && error.name === 'TimeoutError';
  return new PncpError(
    timedOut ? 'O PNCP demorou demais para responder.' : 'Não foi possível conectar ao PNCP.',
    true,
  );
}

/** Documentos publicados para a contratação. Faz uma única tentativa (ver `retryable`). */
export async function fetchDocumentList(
  ref: PncpTenderRef,
  fetchImpl: typeof fetch = fetch,
): Promise<PncpDocument[]> {
  let response: Response;
  try {
    response = await fetchImpl(buildDocumentListUrl(ref), {
      headers: { Accept: 'application/json', 'User-Agent': userAgent() },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
  } catch (error) {
    throw networkError(error);
  }
  // 204/404: a contratação não tem documentos publicados.
  if (response.status === 204 || response.status === 404) return [];
  if (response.status === 429 || response.status >= 500) {
    throw new PncpError(`O PNCP está indisponível no momento (HTTP ${response.status}).`, true);
  }
  if (!response.ok) {
    throw new PncpError(
      `O PNCP recusou a consulta dos documentos (HTTP ${response.status}).`,
      false,
    );
  }
  try {
    return parseDocumentList(await response.json());
  } catch {
    throw new PncpError('O PNCP retornou uma lista de documentos ilegível.', true);
  }
}

/** O PNCP responde 422 tanto para arquivo excluído (definitivo) quanto para falha ao ler o arquivo (passageira). */
async function unprocessableError(response: Response): Promise<PncpError> {
  let message = '';
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'message' in body) message = String(body.message);
  } catch {
    // Corpo fora do formato esperado: tratado como falha passageira.
  }
  return /exclu[ií]d/i.test(message)
    ? new PncpError('O órgão excluiu este arquivo do PNCP.', false)
    : new PncpError('O PNCP não conseguiu entregar o arquivo agora.', true);
}

/**
 * Baixa um documento da contratação. Faz uma única tentativa; quem chama decide se repete.
 * O conteúdo vem de terceiros: é tratado apenas como bytes a serem lidos, nunca executado.
 */
export async function downloadDocument(
  ref: PncpTenderRef,
  sequence: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(buildDocumentUrl(ref, sequence), {
      headers: { 'User-Agent': userAgent() },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw networkError(error);
  }
  if (response.status === 422) throw await unprocessableError(response);
  if (response.status === 404 || response.status === 410) {
    throw new PncpError('O arquivo não está mais disponível no PNCP.', false);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new PncpError(`O PNCP está indisponível no momento (HTTP ${response.status}).`, true);
  }
  if (!response.ok || !response.body) {
    throw new PncpError(`O PNCP recusou o download (HTTP ${response.status}).`, false);
  }
  if (Number(response.headers.get('content-length') ?? 0) > MAX_DOCUMENT_BYTES) {
    await response.body.cancel();
    throw new PncpError('O arquivo é grande demais para ser analisado.', false);
  }

  // Lê aos poucos para interromper assim que passar do limite, mesmo sem Content-Length.
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOCUMENT_BYTES) {
        await reader.cancel();
        throw new PncpError('O arquivo é grande demais para ser analisado.', false);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PncpError) throw error;
    throw networkError(error);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
