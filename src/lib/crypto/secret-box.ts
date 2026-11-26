// Cifragem de segredos guardados no banco (ex.: a chave de API do usuário).
// AES-256-GCM com chave derivada de SESSION_SECRET por HKDF: um vazamento só do banco não revela os
// segredos. Trocar o SESSION_SECRET invalida o que estiver salvo (o usuário informa a chave de novo).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { assertSecret } from '@/lib/auth/token';

const VERSION = 'v1';
const IV_BYTES = 12;

/** `purpose` separa as chaves de cada uso: um segredo cifrado para um fim não abre em outro. */
function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', assertSecret(secret), 'synergy', purpose, 32));
}

/** Devolve `v1.<iv>.<tag>.<dados>` em base64url. */
export function sealSecret(plaintext: string, purpose: string, secret: string | undefined): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(assertSecret(secret), purpose), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Devolve o texto original, ou `null` se o valor foi alterado, é de outra versão ou de outro segredo. */
export function openSecret(
  sealed: string,
  purpose: string,
  secret: string | undefined,
): string | null {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(assertSecret(secret), purpose),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
