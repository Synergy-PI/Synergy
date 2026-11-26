// Análise dos documentos das licitações em segundo plano: PNCP -> texto -> requisitos -> banco.
//
// Baixar um edital do PNCP leva de segundos a minutos e falha com frequência (medido em nov/2026:
// mediana de 17 s por licitação, 27% dos arquivos falham na primeira tentativa). Por isso o usuário
// nunca espera por esse trabalho: a análise é pedida, entra em uma fila no banco (`TenderAnalysis`) e a
// página só lê o que já está gravado. O que vem depois do download é rápido (~0,7 s por licitação).
//
// São duas filas, cada uma com um item por vez:
//  - documentos: uma conexão por vez ao PNCP, com novas tentativas espaçadas (ver analysis-policy.ts);
//  - IA (opcional): organiza os requisitos já extraídos, com a chave de quem pediu ou a do servidor.
//
// Limitação conhecida (a mesma da sincronização): quem processa é este processo. As filas ficam no banco
// e são retomadas quando o servidor inicia (src/instrumentation.ts), mas só valem para uma instância.
import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { resolveAiKey } from '@/lib/ai/keys';
import { AiError, chatJson } from '@/lib/ai/openrouter';
import { listNicheMatchedTenderIds } from '@/lib/data/tenders';
import { PncpError } from '@/lib/pncp/client';
import { selectDocuments, type PncpDocument } from '@/lib/pncp/documents';
import { downloadDocument, fetchDocumentList } from '@/lib/pncp/documents-client';
import { parsePncpId, type PncpTenderRef } from '@/lib/pncp/normalize';
import { prisma } from '@/lib/prisma';
import {
  ANALYSIS_HEARTBEAT_TIMEOUT_MS,
  retryDelayMs,
  type AnalysisDocument,
} from './analysis-policy';
import { extractDocumentText } from './document-text';
import { extractRequirements, type ExtractedRequirement } from './requirements';
import { AI_SYSTEM_PROMPT, buildAiRequest, parseAiResponse } from './requirements-ai';
import type { Uf } from './states';
import { fold } from './text';

/** Prioridade dos pedidos feitos por um usuário: passam à frente da fila automática. */
const USER_PRIORITY = 1;
/** Pausa entre licitações para não pressionar a API pública. */
const PAUSE_BETWEEN_TENDERS_MS = 500;
const DOWNLOAD_ATTEMPTS = 2;
const DOWNLOAD_RETRY_DELAY_MS = 4_000;
/** Os modelos gratuitos do OpenRouter aceitam 20 chamadas por minuto. */
const AI_MIN_INTERVAL_MS = 3_200;
/** Teto de espera do temporizador que acorda a fila para a próxima tentativa. */
const MAX_WAKE_DELAY_MS = 30 * 60 * 1000;

type Runtime = {
  documentsRunning: boolean;
  aiRunning: boolean;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  lastAiCallAt: number;
};

// Guardado em globalThis para sobreviver ao hot reload em desenvolvimento.
const globalRuntime = globalThis as unknown as { __synergyTenderAnalysis?: Runtime };
const runtime: Runtime = (globalRuntime.__synergyTenderAnalysis ??= {
  documentsRunning: false,
  aiRunning: false,
  wakeTimer: null,
  lastAiCallAt: 0,
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

/**
 * Coloca a licitação na fila de análise com prioridade de usuário (ou adianta uma tentativa agendada).
 * Quem chama já verificou se o pedido é permitido (ver `canRequestAnalysis`).
 */
export async function requestTenderAnalysis(tenderId: string): Promise<void> {
  const queued = { status: 'PENDING' as const, priority: USER_PRIORITY, nextAttemptAt: new Date() };
  await prisma.tenderAnalysis.upsert({
    where: { tenderId },
    create: { tenderId, ...queued },
    update: queued,
  });
  kickDocumentWorker();
}

/**
 * Depois de sincronizar um estado, enfileira as licitações que casam com algum nicho e ainda não têm
 * análise. Devolve quantas entraram na fila.
 */
export async function enqueueNicheTenderAnalyses(uf: Uf): Promise<number> {
  const ids = await listNicheMatchedTenderIds(uf);
  if (ids.length === 0) return 0;
  const { count } = await prisma.tenderAnalysis.createMany({
    data: ids.map((tenderId) => ({ tenderId })),
    skipDuplicates: true,
  });
  kickDocumentWorker();
  return count;
}

/** Pede a organização dos requisitos por IA, usando a chave de `userId` (ou a do servidor). */
export async function requestTenderAiReview(tenderId: string, userId: string): Promise<void> {
  await prisma.tenderAnalysis.update({
    where: { tenderId },
    data: {
      aiStatus: 'PENDING',
      aiRequestedById: userId,
      aiError: null,
      aiHeartbeatAt: new Date(),
    },
  });
  kickAiWorker();
}

/** Retoma as filas depois que o servidor inicia (ou reinicia). */
export function resumeTenderAnalysisWorkers(): void {
  kickDocumentWorker();
  kickAiWorker();
}

// ---------------------------------------------------------------------------
// Fila de documentos
// ---------------------------------------------------------------------------

function kickDocumentWorker(): void {
  if (runtime.documentsRunning) return;
  runtime.documentsRunning = true;
  if (runtime.wakeTimer) clearTimeout(runtime.wakeTimer);
  runtime.wakeTimer = null;
  void runDocumentQueue()
    .catch((error) => console.error('[requisitos] a fila de documentos parou', error))
    .finally(() => {
      runtime.documentsRunning = false;
    });
}

type ClaimedAnalysis = { tenderId: string; attempts: number; pncpId: string };

/** Próxima análise pronta para rodar: pedidos de usuários primeiro, depois a mais antiga. */
async function claimNextAnalysis(): Promise<ClaimedAnalysis | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - ANALYSIS_HEARTBEAT_TIMEOUT_MS);
  const next = await prisma.tenderAnalysis.findFirst({
    where: {
      // Licitação encerrada não precisa mais de análise (ela some na próxima sincronização).
      tender: { closesAt: { gt: now } },
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        // Execução interrompida (ex.: o servidor reiniciou no meio).
        { status: 'RUNNING', OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleBefore } }] },
      ],
    },
    orderBy: [{ priority: 'desc' }, { nextAttemptAt: 'asc' }],
    select: { tenderId: true, attempts: true, tender: { select: { pncpId: true } } },
  });
  if (!next) return null;
  await prisma.tenderAnalysis.update({
    where: { tenderId: next.tenderId },
    data: { status: 'RUNNING', heartbeatAt: now },
  });
  return { tenderId: next.tenderId, attempts: next.attempts, pncpId: next.tender.pncpId };
}

/** Sem nada para fazer agora: agenda o despertar para a próxima tentativa marcada. */
async function scheduleWake(): Promise<void> {
  const now = new Date();
  const next = await prisma.tenderAnalysis.findFirst({
    where: { status: 'PENDING', tender: { closesAt: { gt: now } } },
    orderBy: { nextAttemptAt: 'asc' },
    select: { nextAttemptAt: true },
  });
  if (!next) return;
  const delay = Math.min(
    Math.max(next.nextAttemptAt.getTime() - now.getTime(), 1_000),
    MAX_WAKE_DELAY_MS,
  );
  runtime.wakeTimer = setTimeout(kickDocumentWorker, delay);
  // O temporizador não deve impedir o processo de encerrar.
  runtime.wakeTimer.unref?.();
}

async function runDocumentQueue(): Promise<void> {
  for (;;) {
    const next = await claimNextAnalysis();
    if (!next) {
      await scheduleWake();
      return;
    }
    try {
      await analyzeTender(next);
    } catch (error) {
      // A licitação pode ter sido removida por uma sincronização no meio do trabalho.
      console.error(`[requisitos] análise de ${next.pncpId} falhou`, error);
      await finishAnalysis(next, {
        kind: 'retry',
        message: 'Erro inesperado ao analisar os documentos.',
      }).catch(() => undefined);
    }
    await sleep(PAUSE_BETWEEN_TENDERS_MS);
  }
}

async function downloadWithRetry(ref: PncpTenderRef, sequence: number): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadDocument(ref, sequence);
    } catch (error) {
      const canRetry = error instanceof PncpError && error.retryable && attempt < DOWNLOAD_ATTEMPTS;
      if (!canRetry) throw error;
      await sleep(DOWNLOAD_RETRY_DELAY_MS);
    }
  }
}

type DocumentOutcome = {
  document: AnalysisDocument;
  requirements: ExtractedRequirement[];
  /** Impressão digital do arquivo baixado; `null` se o download falhou. */
  digest: string | null;
};

async function readDocument(
  ref: PncpTenderRef,
  source: PncpDocument,
  /** Arquivos já lidos nesta análise: o mesmo arquivo publicado duas vezes é ignorado. */
  readDigests: ReadonlySet<string>,
): Promise<DocumentOutcome | null> {
  const base = { type: source.typeName, title: source.title, pages: 0, textPages: 0 };
  let bytes: Uint8Array;
  try {
    bytes = await downloadWithRetry(ref, source.sequence);
  } catch (error) {
    const known = error instanceof PncpError;
    return {
      document: {
        ...base,
        kind: null,
        error: known ? error.message : 'Não foi possível baixar o arquivo.',
        retryable: known ? error.retryable : true,
      },
      requirements: [],
      digest: null,
    };
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (readDigests.has(digest)) return null;

  try {
    const text = await extractDocumentText(bytes);
    if (!text.kind) {
      return {
        document: {
          ...base,
          kind: null,
          error: 'Formato de arquivo não suportado.',
          retryable: false,
        },
        requirements: [],
        digest,
      };
    }
    const document = {
      ...base,
      kind: text.kind,
      pages: text.pageCount,
      textPages: text.textPages,
      retryable: false,
    };
    if (text.textPages === 0) {
      return {
        document: {
          ...document,
          error: 'O documento é uma imagem escaneada, sem texto para ler.',
        },
        requirements: [],
        digest,
      };
    }
    return {
      document: { ...document, error: null },
      requirements: extractRequirements(text.pages, { paragraphs: text.paragraphs }),
      digest,
    };
  } catch {
    // Arquivo corrompido ou protegido: não adianta baixar de novo.
    return {
      document: { ...base, kind: null, error: 'Não foi possível ler o arquivo.', retryable: false },
      requirements: [],
      digest,
    };
  }
}

type AnalysisResult =
  | { kind: 'done'; documents: AnalysisDocument[]; requirements: StoredRequirement[] }
  | { kind: 'unavailable'; message: string; documents?: AnalysisDocument[] }
  | { kind: 'retry'; message: string; documents?: AnalysisDocument[] };

type StoredRequirement = ExtractedRequirement & { documentType: string };

async function analyzeTender(claimed: ClaimedAnalysis): Promise<void> {
  const ref = parsePncpId(claimed.pncpId);
  if (!ref) {
    await finishAnalysis(claimed, {
      kind: 'unavailable',
      message: 'Licitação sem número de controle do PNCP.',
    });
    return;
  }

  let published: PncpDocument[];
  try {
    published = await fetchDocumentList(ref);
  } catch (error) {
    const known = error instanceof PncpError;
    await finishAnalysis(claimed, {
      kind: known && !error.retryable ? 'unavailable' : 'retry',
      message: known ? error.message : 'Não foi possível consultar os documentos no PNCP.',
    });
    return;
  }
  const selected = selectDocuments(published);
  if (selected.length === 0) {
    await finishAnalysis(claimed, {
      kind: 'unavailable',
      message: 'O órgão não publicou o edital desta licitação no PNCP.',
    });
    return;
  }

  const documents: AnalysisDocument[] = [];
  const requirements: StoredRequirement[] = [];
  const seen = new Set<string>();
  const readDigests = new Set<string>();
  for (const source of selected) {
    await prisma.tenderAnalysis.update({
      where: { tenderId: claimed.tenderId },
      data: { heartbeatAt: new Date() },
    });
    const outcome = await readDocument(ref, source, readDigests);
    if (!outcome) continue;
    if (outcome.digest) readDigests.add(outcome.digest);
    documents.push(outcome.document);
    for (const requirement of outcome.requirements) {
      // O termo de referência costuma repetir cláusulas do edital.
      const key = fold(requirement.text)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (seen.has(key)) continue;
      seen.add(key);
      requirements.push({ ...requirement, documentType: source.typeName });
    }
  }

  if (requirements.length > 0) {
    await finishAnalysis(claimed, { kind: 'done', documents, requirements });
    return;
  }
  // Nada encontrado: se algum documento falhou por instabilidade do PNCP, vale tentar de novo.
  const transient = documents.find((document) => document.error && document.retryable);
  if (transient?.error) {
    await finishAnalysis(claimed, { kind: 'retry', message: transient.error, documents });
    return;
  }
  const readable = documents.some((document) => document.error === null);
  if (readable) {
    // Lemos os documentos, mas não havia seção de habilitação reconhecível.
    await finishAnalysis(claimed, { kind: 'done', documents, requirements: [] });
    return;
  }
  await finishAnalysis(claimed, {
    kind: 'unavailable',
    message: documents[0]?.error ?? 'Não foi possível ler os documentos desta licitação.',
    documents,
  });
}

async function finishAnalysis(claimed: ClaimedAnalysis, result: AnalysisResult): Promise<void> {
  const now = new Date();
  const attempts = claimed.attempts + 1;
  const documents = (result.documents ?? []) as unknown as Prisma.InputJsonValue;

  if (result.kind === 'retry') {
    const delay = retryDelayMs(attempts);
    await prisma.tenderAnalysis.update({
      where: { tenderId: claimed.tenderId },
      data:
        delay === null
          ? {
              status: 'UNAVAILABLE',
              attempts,
              completedAt: now,
              error: `${result.message} Tentamos ${attempts} vezes.`.slice(0, 300),
              documents,
            }
          : {
              status: 'PENDING',
              attempts,
              // Novas tentativas voltam ao fim da fila.
              priority: 0,
              nextAttemptAt: new Date(now.getTime() + delay),
              error: result.message.slice(0, 300),
              documents,
            },
    });
    return;
  }

  if (result.kind === 'unavailable') {
    await prisma.tenderAnalysis.update({
      where: { tenderId: claimed.tenderId },
      data: {
        status: 'UNAVAILABLE',
        attempts,
        completedAt: now,
        error: result.message.slice(0, 300),
        documents,
      },
    });
    return;
  }

  // Substitui os requisitos anteriores (e, com eles, uma eventual organização por IA).
  await prisma.$transaction([
    prisma.tenderRequirement.deleteMany({ where: { tenderId: claimed.tenderId } }),
    prisma.tenderRequirement.createMany({
      data: result.requirements.map((requirement, position) => ({
        tenderId: claimed.tenderId,
        position,
        category: requirement.category,
        procedural: requirement.procedural,
        label: requirement.label.slice(0, 24) || null,
        text: requirement.text,
        documentType: requirement.documentType.slice(0, 80),
        page: requirement.page,
      })),
    }),
    prisma.tenderAnalysis.update({
      where: { tenderId: claimed.tenderId },
      data: {
        status: 'SUCCEEDED',
        attempts,
        completedAt: now,
        error: null,
        documents,
        requirementCount: result.requirements.filter((item) => !item.procedural).length,
        aiStatus: 'NONE',
        aiModel: null,
        aiError: null,
        aiCompletedAt: null,
      },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Fila da IA
// ---------------------------------------------------------------------------

function kickAiWorker(): void {
  if (runtime.aiRunning) return;
  runtime.aiRunning = true;
  void runAiQueue()
    .catch((error) => console.error('[requisitos] a fila da IA parou', error))
    .finally(() => {
      runtime.aiRunning = false;
    });
}

async function runAiQueue(): Promise<void> {
  for (;;) {
    const next = await prisma.tenderAnalysis.findFirst({
      where: { aiStatus: 'PENDING', status: 'SUCCEEDED' },
      orderBy: { updatedAt: 'asc' },
      select: {
        tenderId: true,
        aiRequestedById: true,
        tender: { select: { object: true, pncpId: true } },
      },
    });
    if (!next) return;
    await prisma.tenderAnalysis.update({
      where: { tenderId: next.tenderId },
      data: { aiStatus: 'RUNNING', aiHeartbeatAt: new Date() },
    });
    try {
      await reviewWithAi(next.tenderId, next.aiRequestedById, next.tender.object);
    } catch (error) {
      if (!(error instanceof AiError)) {
        console.error(`[requisitos] IA de ${next.tender.pncpId} falhou`, error);
      }
      const message =
        error instanceof AiError ? error.message : 'Erro inesperado ao organizar os requisitos.';
      await prisma.tenderAnalysis
        .update({
          where: { tenderId: next.tenderId },
          data: { aiStatus: 'FAILED', aiError: message.slice(0, 300) },
        })
        .catch(() => undefined);
    }
  }
}

async function reviewWithAi(
  tenderId: string,
  requestedById: string | null,
  tenderObject: string,
): Promise<void> {
  const key = await resolveAiKey(requestedById);
  if (!key) throw new AiError('invalid_key', 'Nenhuma chave de IA está configurada.');

  const clauses = await prisma.tenderRequirement.findMany({
    where: { tenderId },
    orderBy: { position: 'asc' },
    select: { position: true, page: true, text: true },
  });
  if (clauses.length === 0) throw new AiError('bad_response', 'Não há requisitos para organizar.');

  const wait = runtime.lastAiCallAt + AI_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  runtime.lastAiCallAt = Date.now();

  const request = buildAiRequest(tenderObject, clauses);
  const answer = await chatJson({
    apiKey: key.apiKey,
    system: AI_SYSTEM_PROMPT,
    user: request.userContent,
  });
  const review = parseAiResponse(answer.content, clauses);
  if (!review.ok) throw new AiError('bad_response', `${review.reason} Tente de novo.`);

  await prisma.$transaction([
    ...review.items.map((item) =>
      prisma.tenderRequirement.update({
        where: { tenderId_position: { tenderId, position: item.position } },
        data: {
          aiCategory: item.category,
          aiProcedural: item.procedural,
          aiTitle: item.title,
          aiHighlight: item.highlight,
        },
      }),
    ),
    prisma.tenderAnalysis.update({
      where: { tenderId },
      data: {
        aiStatus: 'SUCCEEDED',
        aiModel: answer.model.slice(0, 190),
        aiError: null,
        aiCompletedAt: new Date(),
      },
    }),
  ]);
}
