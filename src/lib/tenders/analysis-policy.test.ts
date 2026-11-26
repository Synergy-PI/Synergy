import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_MAX_ATTEMPTS,
  aiState,
  analysisState,
  canRequestAnalysis,
  hasRetryableFailure,
  parseAnalysisDocuments,
  retryDelayMs,
  type AnalysisSnapshot,
} from './analysis-policy';

const now = new Date('2026-11-22T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const snapshot = (overrides: Partial<AnalysisSnapshot>): AnalysisSnapshot => ({
  status: 'PENDING',
  attempts: 0,
  heartbeatAt: null,
  completedAt: null,
  incomplete: false,
  ...overrides,
});

describe('retryDelayMs', () => {
  it('espera cada vez mais e desiste no limite de tentativas', () => {
    expect(retryDelayMs(1)).toBe(2 * 60_000);
    expect(retryDelayMs(2)).toBe(15 * 60_000);
    expect(retryDelayMs(3)).toBe(60 * 60_000);
    expect(retryDelayMs(4)).toBe(6 * 60 * 60_000);
    expect(retryDelayMs(ANALYSIS_MAX_ATTEMPTS)).toBeNull();
    expect(retryDelayMs(ANALYSIS_MAX_ATTEMPTS + 3)).toBeNull();
  });
});

describe('analysisState', () => {
  it('distingue fila, nova tentativa e execução', () => {
    expect(analysisState(null, now)).toBe('none');
    expect(analysisState(snapshot({}), now)).toBe('queued');
    expect(analysisState(snapshot({ attempts: 2 }), now)).toBe('retrying');
    expect(analysisState(snapshot({ status: 'RUNNING', heartbeatAt: ago(1) }), now)).toBe(
      'running',
    );
    expect(analysisState(snapshot({ status: 'SUCCEEDED' }), now)).toBe('ready');
    expect(analysisState(snapshot({ status: 'UNAVAILABLE' }), now)).toBe('unavailable');
  });

  it('trata como fila a execução que ficou sem sinal de vida', () => {
    expect(analysisState(snapshot({ status: 'RUNNING', heartbeatAt: ago(8) }), now)).toBe('queued');
    expect(analysisState(snapshot({ status: 'RUNNING', heartbeatAt: null }), now)).toBe('queued');
  });
});

describe('canRequestAnalysis', () => {
  it('permite pedir quando não há análise e apressar uma nova tentativa', () => {
    expect(canRequestAnalysis(null, now)).toBe(true);
    expect(canRequestAnalysis(snapshot({ attempts: 1 }), now)).toBe(true);
  });

  it('não repete o que está na fila, em execução ou pronto e completo', () => {
    expect(canRequestAnalysis(snapshot({}), now)).toBe(false);
    expect(canRequestAnalysis(snapshot({ status: 'RUNNING', heartbeatAt: ago(1) }), now)).toBe(
      false,
    );
    expect(canRequestAnalysis(snapshot({ status: 'SUCCEEDED' }), now)).toBe(false);
  });

  it('permite refazer um resultado incompleto', () => {
    expect(canRequestAnalysis(snapshot({ status: 'SUCCEEDED', incomplete: true }), now)).toBe(true);
  });

  it('só refaz o que ficou indisponível depois de algumas horas', () => {
    const unavailable = (minutes: number) =>
      snapshot({ status: 'UNAVAILABLE', completedAt: ago(minutes) });
    expect(canRequestAnalysis(unavailable(30), now)).toBe(false);
    expect(canRequestAnalysis(unavailable(6 * 60), now)).toBe(true);
  });
});

describe('aiState', () => {
  it('acompanha a situação da IA', () => {
    expect(aiState(null, now)).toBe('idle');
    expect(aiState({ aiStatus: 'NONE', aiHeartbeatAt: null }, now)).toBe('idle');
    expect(aiState({ aiStatus: 'PENDING', aiHeartbeatAt: ago(1) }, now)).toBe('working');
    expect(aiState({ aiStatus: 'RUNNING', aiHeartbeatAt: ago(2) }, now)).toBe('working');
    expect(aiState({ aiStatus: 'SUCCEEDED', aiHeartbeatAt: ago(50) }, now)).toBe('ready');
    expect(aiState({ aiStatus: 'FAILED', aiHeartbeatAt: ago(50) }, now)).toBe('failed');
  });

  it('libera um novo pedido quando o anterior ficou sem resposta', () => {
    expect(aiState({ aiStatus: 'RUNNING', aiHeartbeatAt: ago(5) }, now)).toBe('idle');
    expect(aiState({ aiStatus: 'PENDING', aiHeartbeatAt: null }, now)).toBe('idle');
  });
});

describe('parseAnalysisDocuments', () => {
  it('lê os documentos gravados e ignora o que estiver fora do formato', () => {
    const documents = parseAnalysisDocuments([
      { type: 'Edital', title: 'PE 10', kind: 'PDF', pages: 62, textPages: 62 },
      {
        type: 'Termo de Referência',
        error: 'O PNCP não conseguiu entregar o arquivo agora.',
        retryable: true,
      },
      { title: 'sem tipo' },
      'texto solto',
    ]);
    expect(documents).toEqual([
      {
        type: 'Edital',
        title: 'PE 10',
        kind: 'PDF',
        pages: 62,
        textPages: 62,
        error: null,
        retryable: false,
      },
      {
        type: 'Termo de Referência',
        title: '',
        kind: null,
        pages: 0,
        textPages: 0,
        error: 'O PNCP não conseguiu entregar o arquivo agora.',
        retryable: true,
      },
    ]);
    expect(hasRetryableFailure(documents)).toBe(true);
    expect(hasRetryableFailure(documents.slice(0, 1))).toBe(false);
    expect(parseAnalysisDocuments(null)).toEqual([]);
  });
});
