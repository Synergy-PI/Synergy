'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/dal';
import { deleteUserAiKey, saveUserAiKey } from '@/lib/ai/keys';
import { checkApiKey } from '@/lib/ai/openrouter';
import { errorState, successState, validationError, type ActionState } from '@/lib/action-state';
import { limiters } from '@/lib/rate-limit';
import { aiKeySchema } from '@/lib/validations/ai-key';

async function authorize() {
  const user = await getCurrentUser();
  if (!user) return { error: errorState('Faça login para configurar a IA.') };
  if (user.role !== 'STARTUP' && user.role !== 'ADMIN') {
    return {
      error: errorState('A IA é usada nas licitações, disponíveis para contas de startup.'),
    };
  }
  return { user };
}

/**
 * Salva a chave do OpenRouter do usuário, cifrada. A chave é conferida no OpenRouter antes de gravar e
 * nunca volta ao navegador: o perfil só mostra os últimos 4 caracteres.
 */
export async function saveAiKey(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, error } = await authorize();
  if (!user) return error;

  // O valor não é devolvido em `values`: uma chave não deve voltar para a página.
  const parsed = aiKeySchema.safeParse({ apiKey: formData.get('apiKey') });
  if (!parsed.success) return validationError(parsed.error);

  const limit = limiters.aiKey.check(user.id);
  if (!limit.allowed) return errorState('Muitas tentativas. Aguarde alguns minutos.');

  const check = await checkApiKey(parsed.data.apiKey);
  if (check.status === 'invalid') {
    return errorState('O OpenRouter não reconheceu esta chave. Confira se ela está ativa.');
  }

  await saveUserAiKey(user.id, parsed.data.apiKey);
  revalidatePath('/app/perfil');
  if (check.status === 'unknown') {
    return successState(
      'Chave salva. Não foi possível confirmá-la no OpenRouter agora; ela será testada no primeiro uso.',
    );
  }
  return successState(
    check.dailyLimit
      ? `Chave salva. Sua conta permite ${check.dailyLimit.toLocaleString('pt-BR')} chamadas gratuitas por dia.`
      : 'Chave salva.',
  );
}

/** Assinatura de `useActionState`: os argumentos não são usados. */
export async function removeAiKey(): Promise<ActionState> {
  const { user, error } = await authorize();
  if (!user) return error;

  await deleteUserAiKey(user.id);
  revalidatePath('/app/perfil');
  return successState('Chave removida.');
}
