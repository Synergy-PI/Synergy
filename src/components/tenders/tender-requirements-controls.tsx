'use client';

import { useActionState, useEffect, useRef, startTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  requestTenderAiOrganization,
  requestTenderRequirements,
} from '@/actions/tender-requirements';
import { initialActionState } from '@/lib/action-state';
import { Alert } from '@/components/ui/alert';
import type { ButtonVariant } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';

const REFRESH_INTERVAL_MS = 4000;

type RequirementsAutoRunnerProps = {
  tenderId: string;
  /** Pedir a análise dos documentos assim que a tela abrir (ninguém pediu ainda). */
  requestAnalysis: boolean;
  /** Pedir à IA que organize os requisitos assim que a tela abrir. */
  requestAi: boolean;
  /** Há trabalho em andamento no servidor: a página é recarregada a cada poucos segundos. */
  polling: boolean;
};

/**
 * Dispara, sem clique, os pedidos que a tela de requisitos precisa e acompanha o andamento.
 * Os pedidos são Server Actions: o trabalho roda em segundo plano e o resultado é lido do banco.
 */
export function RequirementsAutoRunner({
  tenderId,
  requestAnalysis,
  requestAi,
  polling,
}: RequirementsAutoRunnerProps) {
  const router = useRouter();
  const [analysisState, analysisAction] = useActionState(
    requestTenderRequirements,
    initialActionState,
  );
  const [aiState, aiAction] = useActionState(requestTenderAiOrganization, initialActionState);
  // Um pedido de cada tipo por abertura da tela, mesmo que o componente renderize de novo.
  const requested = useRef({ analysis: false, ai: false });

  useEffect(() => {
    const send = (action: (formData: FormData) => void) => {
      const formData = new FormData();
      formData.set('tenderId', tenderId);
      startTransition(() => action(formData));
    };
    if (requestAnalysis && !requested.current.analysis) {
      requested.current.analysis = true;
      send(analysisAction);
    }
    if (requestAi && !requested.current.ai) {
      requested.current.ai = true;
      send(aiAction);
    }
  }, [tenderId, requestAnalysis, requestAi, analysisAction, aiAction]);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [polling, router]);

  const error =
    (analysisState.status === 'error' && analysisState.message) ||
    (aiState.status === 'error' && aiState.message) ||
    null;
  return error ? <Alert variant="error">{error}</Alert> : null;
}

type RequirementsActionButtonProps = {
  tenderId: string;
  /** `analysis` baixa e lê os documentos de novo; `ai` pede a organização por IA. */
  kind: 'analysis' | 'ai';
  variant?: ButtonVariant;
  children: ReactNode;
};

/** Botão para repetir, a pedido, a análise dos documentos ou a organização por IA. */
export function RequirementsActionButton({
  tenderId,
  kind,
  variant = 'outline',
  children,
}: RequirementsActionButtonProps) {
  const [state, action] = useActionState(
    kind === 'analysis' ? requestTenderRequirements : requestTenderAiOrganization,
    initialActionState,
  );
  return (
    <form data-testid={`tender-${kind}-form`} action={action} className="space-y-2">
      <input type="hidden" name="tenderId" value={tenderId} />
      <SubmitButton
        data-testid={`tender-${kind}-submit`}
        variant={variant}
        size="sm"
        pendingText="Enviando..."
      >
        {children}
      </SubmitButton>
      {state.status === 'error' && state.message ? (
        <p className="text-xs font-medium text-red-600" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
