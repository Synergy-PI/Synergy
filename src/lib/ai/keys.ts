// Chaves de API do OpenRouter: a do servidor (variável de ambiente) e a de cada usuário (perfil).
// A chave do usuário é guardada cifrada e só é aberta aqui, no momento de chamar a IA.
import 'server-only';
import { openSecret, sealSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';

const PURPOSE = 'user-ai-key';

/** De onde vem a chave usada para um usuário: a dele, a compartilhada do servidor, ou nenhuma. */
export type AiKeySource = 'own' | 'shared' | 'none';

/** Chave compartilhada, configurada por quem hospeda o Synergy. Opcional. */
function serverAiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

export async function saveUserAiKey(userId: string, apiKey: string): Promise<void> {
  const data = {
    ciphertext: sealSecret(apiKey, PURPOSE, process.env.SESSION_SECRET),
    last4: apiKey.slice(-4),
  };
  await prisma.userAiKey.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

export async function deleteUserAiKey(userId: string): Promise<void> {
  await prisma.userAiKey.deleteMany({ where: { userId } });
}

/** O que o perfil pode mostrar sobre a chave salva: nunca a chave em si. */
export async function getUserAiKeyInfo(userId: string) {
  return prisma.userAiKey.findUnique({
    where: { userId },
    select: { last4: true, updatedAt: true },
  });
}

/** Sem abrir a chave: serve para decidir o que a interface oferece. */
export async function aiKeySource(userId: string): Promise<AiKeySource> {
  const own = await prisma.userAiKey.findUnique({ where: { userId }, select: { userId: true } });
  if (own) return 'own';
  return serverAiKey() ? 'shared' : 'none';
}

/**
 * Chave para uma chamada pedida por `userId`: a do próprio usuário, se existir e puder ser aberta;
 * senão a do servidor. `null` quando não há nenhuma.
 */
export async function resolveAiKey(
  userId: string | null,
): Promise<{ apiKey: string; source: Exclude<AiKeySource, 'none'> } | null> {
  if (userId) {
    const own = await prisma.userAiKey.findUnique({
      where: { userId },
      select: { ciphertext: true },
    });
    const apiKey = own ? openSecret(own.ciphertext, PURPOSE, process.env.SESSION_SECRET) : null;
    if (apiKey) return { apiKey, source: 'own' };
  }
  const shared = serverAiKey();
  return shared ? { apiKey: shared, source: 'shared' } : null;
}
