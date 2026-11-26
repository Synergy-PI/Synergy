'use client';

import { useActionState, useState } from 'react';
import { removeAiKey, saveAiKey } from '@/actions/ai-key';
import { initialActionState } from '@/lib/action-state';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';

type AiKeyFormProps = {
  /** Últimos 4 caracteres e data da chave salva; `null` se o usuário não tem chave própria. */
  saved: { last4: string; updatedLabel: string } | null;
};

/**
 * Chave de API do OpenRouter do próprio usuário. A chave salva nunca volta para o navegador: só os
 * últimos 4 caracteres são mostrados, para que o usuário a reconheça.
 */
export function AiKeyForm({ saved }: AiKeyFormProps) {
  const [saveState, saveAction] = useActionState(saveAiKey, initialActionState);
  const [removeState, removeAction] = useActionState(removeAiKey, initialActionState);
  // A mensagem exibida é a do último formulário enviado (salvar ou remover).
  const [last, setLast] = useState<'save' | 'remove'>('save');

  return (
    <div className="space-y-4">
      <FormMessage state={last === 'save' ? saveState : removeState} />

      {saved ? (
        <div
          data-testid="ai-key-saved"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
        >
          <p className="text-slate-700">
            Chave salva: <span className="font-mono text-slate-900">sk-or-…{saved.last4}</span>
            <span className="text-slate-500"> · atualizada em {saved.updatedLabel}</span>
          </p>
          <form
            data-testid="ai-key-remove-form"
            action={removeAction}
            onSubmit={() => setLast('remove')}
          >
            <SubmitButton
              data-testid="ai-key-remove"
              variant="ghost"
              size="sm"
              pendingText="Removendo..."
            >
              Remover
            </SubmitButton>
          </form>
        </div>
      ) : null}

      <form
        data-testid="ai-key-form"
        action={saveAction}
        onSubmit={() => setLast('save')}
        className="space-y-4"
        noValidate
      >
        <Field
          label={saved ? 'Trocar a chave' : 'Chave de API do OpenRouter'}
          htmlFor="ai-key"
          error={saveState.fieldErrors?.apiKey}
          hint="Crie uma em openrouter.ai/keys. Ela é guardada cifrada e não é exibida de novo."
        >
          <Input
            data-testid="ai-key-input"
            id="ai-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-or-v1-..."
            required
          />
        </Field>
        <SubmitButton data-testid="ai-key-submit" pendingText="Conferindo a chave...">
          {saved ? 'Trocar chave' : 'Salvar chave'}
        </SubmitButton>
      </form>
    </div>
  );
}
