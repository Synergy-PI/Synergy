import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret } from './secret-box';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!';
const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef';

describe('secret-box', () => {
  it('cifra e recupera o valor', () => {
    const sealed = sealSecret(KEY, 'ai-key', SECRET);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain(KEY);
    expect(openSecret(sealed, 'ai-key', SECRET)).toBe(KEY);
  });

  it('gera um resultado diferente a cada vez', () => {
    expect(sealSecret(KEY, 'ai-key', SECRET)).not.toBe(sealSecret(KEY, 'ai-key', SECRET));
  });

  it('não abre com outro segredo, outro uso ou valor adulterado', () => {
    const sealed = sealSecret(KEY, 'ai-key', SECRET);
    expect(openSecret(sealed, 'ai-key', `${SECRET}x`)).toBeNull();
    expect(openSecret(sealed, 'outro-uso', SECRET)).toBeNull();
    const parts = sealed.split('.');
    const tampered = [...parts.slice(0, 3), `${parts[3].slice(0, -2)}AA`].join('.');
    expect(openSecret(tampered, 'ai-key', SECRET)).toBeNull();
    expect(openSecret('v2.a.b.c', 'ai-key', SECRET)).toBeNull();
    expect(openSecret('lixo', 'ai-key', SECRET)).toBeNull();
  });

  it('exige um segredo forte para cifrar', () => {
    expect(() => sealSecret(KEY, 'ai-key', 'curto')).toThrow();
    expect(() => sealSecret(KEY, 'ai-key', undefined)).toThrow();
  });
});
