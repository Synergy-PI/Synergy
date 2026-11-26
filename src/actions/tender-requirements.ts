'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/dal';
import { aiKeySource } from '@/lib/ai/keys';
import { errorState, successState, type ActionState } from '@/lib/action-state';
import { getTenderAnalysisStatus } from '@/lib/data/tender-requirements';
import { limiters } from '@/lib/rate-limit';
import { requestTenderAiReview, requestTenderAnalysis } from '@/lib/tenders/analysis';
import {
  aiState,
  analysisState,
  canRequestAnalysis,
  hasRetryableFailure,
  parseAnalysisDocuments,
} from '@/lib/tenders/analysis-policy';
import { tenderIdSchema } from '@/lib/validations/tenders';

const retryMinutes = (retryAfterMs: number) => {
  const minutes = Math.ceil(retryAfterMs / 60_000);
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
};

async function authorize() {
  const user = await getCurrentUser();
  if (!user) return { error: errorState('Faça login para ver os requisitos das licitações.') };
  if (user.role !== 'STARTUP' && user.role !== 'ADMIN') {
    return { error: errorState('Apenas contas de startup acessam as licitações.') };
  }
  return { user };
}

function revalidateTender(tenderId: string) {
  revalidatePath(`/app/licitacoes/${tenderId}`);
  revalidatePath('/app/licitacoes');
}

/**
 * Coloca os documentos de uma licitação na fila de análise (ou adianta uma tentativa agendada).
 * A action retorna em seguida: o trabalho roda em segundo plano e a página acompanha pelo banco.
 */
export async function requestTenderRequirements(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user, error } = await authorize();
  if (!user) return error;

  const parsed = tenderIdSchema.safeParse({ tenderId: formData.get('tenderId') });
  if (!parsed.success) return errorState('Licitação inválida.');
  const { tenderId } = parsed.data;

  const tender = await getTenderAnalysisStatus(tenderId);
  if (!tender) return errorState('Esta licitação não está mais disponível.');
  const now = new Date();
  if (tender.closesAt <= now) return errorState('O prazo desta licitação já encerrou.');

  const snapshot = tender.analysis && {
    ...tender.analysis,
    incomplete: hasRetryableFailure(parseAnalysisDocuments(tender.analysis.documents)),
  };
  // Outro usuário (ou a fila automática) já cuidou disso: nada a fazer.
  if (!canRequestAnalysis(snapshot, now)) return successState();

  if (user.role !== 'ADMIN') {
    const limit = limiters.tenderAnalysis.check(user.id);
    if (!limit.allowed) {
      return errorState(
        `Você pediu a análise de muitos editais. Tente novamente em ${retryMinutes(limit.retryAfterMs)}.`,
      );
    }
  }

  await requestTenderAnalysis(tenderId);
  revalidateTender(tenderId);
  return successState();
}

/**
 * Pede à IA que organize os requisitos já extraídos (exigência ou procedimento, categoria, título e
 * destaque). Usa a chave do próprio usuário, se houver; senão, a do servidor.
 */
export async function requestTenderAiOrganization(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user, error } = await authorize();
  if (!user) return error;

  const parsed = tenderIdSchema.safeParse({ tenderId: formData.get('tenderId') });
  if (!parsed.success) return errorState('Licitação inválida.');
  const { tenderId } = parsed.data;

  const tender = await getTenderAnalysisStatus(tenderId);
  const analysis = tender?.analysis;
  if (!tender || !analysis) return errorState('Esta licitação ainda não foi analisada.');
  const now = new Date();
  if (
    analysisState({ ...analysis, incomplete: false }, now) !== 'ready' ||
    analysis._count.requirements === 0
  ) {
    return errorState('Ainda não há requisitos para a IA organizar.');
  }
  const current = aiState(analysis, now);
  // Já organizado ou em andamento: nada a fazer.
  if (current === 'ready' || current === 'working') return successState();

  const source = await aiKeySource(user.id);
  if (source === 'none') {
    return errorState('Cadastre sua chave do OpenRouter no perfil para usar a IA.');
  }
  if (source === 'shared' && user.role !== 'ADMIN') {
    const limit = limiters.tenderAiShared.check(user.id);
    if (!limit.allowed) {
      return errorState(
        `Você usou bastante a IA compartilhada. Tente novamente em ${retryMinutes(limit.retryAfterMs)} ou cadastre sua própria chave no perfil.`,
      );
    }
  }

  await requestTenderAiReview(tenderId, user.id);
  revalidateTender(tenderId);
  return successState();
}
