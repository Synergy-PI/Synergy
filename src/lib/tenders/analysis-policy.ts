// Regras da análise dos documentos de uma licitação: tentativas, esperas e o que o usuário pode pedir.
// Módulo puro (sem banco) para facilitar testes unitários.
import type { TenderAiStatus, TenderAnalysisStatus } from '@/generated/prisma/enums';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Tentativas de baixar os documentos antes de desistir de uma licitação. */
export const ANALYSIS_MAX_ATTEMPTS = 5;
/**
 * Espera antes de cada nova tentativa. O PNCP costuma voltar a entregar um arquivo minutos depois de
 * falhar; insistir em seguida só repete o erro.
 */
const RETRY_DELAYS_MS = [2 * MINUTE, 15 * MINUTE, HOUR, 6 * HOUR];

/** Espera até a próxima tentativa, ou `null` quando as tentativas acabaram. */
export function retryDelayMs(attemptsMade: number): number | null {
  if (attemptsMade >= ANALYSIS_MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[Math.max(0, Math.min(attemptsMade, RETRY_DELAYS_MS.length) - 1)];
}

/**
 * O processamento renova o sinal de vida antes de cada download (que espera até 5 minutos). Sem sinal
 * por este tempo, a execução foi interrompida (ex.: o servidor reiniciou) e a análise volta para a fila.
 */
export const ANALYSIS_HEARTBEAT_TIMEOUT_MS = 7 * MINUTE;
/** A chamada à IA espera até 2 minutos. */
export const AI_HEARTBEAT_TIMEOUT_MS = 4 * MINUTE;
/** Depois deste tempo, uma licitação sem documento legível pode ser analisada de novo a pedido. */
const UNAVAILABLE_RETRY_AFTER_MS = 6 * HOUR;

/** Um documento da licitação e o que aconteceu ao tentar lê-lo (gravado em `TenderAnalysis.documents`). */
export type AnalysisDocument = {
  /** Tipo no PNCP ("Edital", "Termo de Referência"...). */
  type: string;
  title: string;
  /** Formato lido ("PDF", "DOCX"...); `null` se não foi possível ler. */
  kind: string | null;
  pages: number;
  /** Páginas com texto; a diferença para `pages` são páginas escaneadas. */
  textPages: number;
  /** Motivo de não ter sido lido, em português. */
  error: string | null;
  /** A falha é passageira (PNCP fora do ar, tempo esgotado): vale tentar de novo. */
  retryable: boolean;
};

/** Lê o JSON gravado no banco; entradas fora do formato são ignoradas. */
export function parseAnalysisDocuments(value: unknown): AnalysisDocument[] {
  if (!Array.isArray(value)) return [];
  const documents: AnalysisDocument[] = [];
  for (const raw of value as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.type !== 'string') continue;
    documents.push({
      type: item.type,
      title: typeof item.title === 'string' ? item.title : '',
      kind: typeof item.kind === 'string' ? item.kind : null,
      pages: typeof item.pages === 'number' ? item.pages : 0,
      textPages: typeof item.textPages === 'number' ? item.textPages : 0,
      error: typeof item.error === 'string' ? item.error : null,
      retryable: item.retryable === true,
    });
  }
  return documents;
}

/** Algum documento não veio por falha passageira: o resultado pode estar incompleto. */
export function hasRetryableFailure(documents: readonly AnalysisDocument[]): boolean {
  return documents.some((document) => document.error !== null && document.retryable);
}

export type AnalysisSnapshot = {
  status: TenderAnalysisStatus;
  attempts: number;
  heartbeatAt: Date | null;
  completedAt: Date | null;
  /** Algum documento não veio por falha passageira do PNCP: o resultado pode estar incompleto. */
  incomplete: boolean;
};

export type AnalysisState =
  /** Ninguém pediu a análise ainda. */
  | 'none'
  | 'queued'
  | 'running'
  /** Falhou e aguarda a próxima tentativa automática. */
  | 'retrying'
  | 'ready'
  | 'unavailable';

export function analysisState(
  analysis: AnalysisSnapshot | null,
  now: Date = new Date(),
): AnalysisState {
  if (!analysis) return 'none';
  switch (analysis.status) {
    case 'SUCCEEDED':
      return 'ready';
    case 'UNAVAILABLE':
      return 'unavailable';
    case 'RUNNING': {
      const alive =
        analysis.heartbeatAt !== null &&
        now.getTime() - analysis.heartbeatAt.getTime() < ANALYSIS_HEARTBEAT_TIMEOUT_MS;
      // Execução interrompida: será retomada pela fila.
      return alive ? 'running' : 'queued';
    }
    case 'PENDING':
      return analysis.attempts > 0 ? 'retrying' : 'queued';
  }
}

/** O usuário pode pedir (ou apressar) a análise agora? */
export function canRequestAnalysis(
  analysis: AnalysisSnapshot | null,
  now: Date = new Date(),
): boolean {
  switch (analysisState(analysis, now)) {
    case 'none':
    case 'retrying':
      return true;
    case 'ready':
      return analysis?.incomplete === true;
    case 'unavailable':
      return (
        !analysis?.completedAt ||
        now.getTime() - analysis.completedAt.getTime() >= UNAVAILABLE_RETRY_AFTER_MS
      );
    default:
      return false;
  }
}

export type AiSnapshot = { aiStatus: TenderAiStatus; aiHeartbeatAt: Date | null };

export type AiState = 'idle' | 'working' | 'ready' | 'failed';

export function aiState(analysis: AiSnapshot | null, now: Date = new Date()): AiState {
  if (!analysis) return 'idle';
  switch (analysis.aiStatus) {
    case 'SUCCEEDED':
      return 'ready';
    case 'FAILED':
      return 'failed';
    case 'NONE':
      return 'idle';
    case 'PENDING':
    case 'RUNNING': {
      const alive =
        analysis.aiHeartbeatAt !== null &&
        now.getTime() - analysis.aiHeartbeatAt.getTime() < AI_HEARTBEAT_TIMEOUT_MS;
      // Pedido que ficou sem resposta (ex.: o servidor reiniciou): pode ser feito de novo.
      return alive ? 'working' : 'idle';
    }
  }
}
