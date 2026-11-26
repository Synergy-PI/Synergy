import { z } from 'zod';

/** Chave de API do OpenRouter, como aparece no painel deles ("sk-or-v1-..."). */
export const aiKeySchema = z.object({
  apiKey: z
    .string({ error: 'Informe a chave de API' })
    .trim()
    .regex(
      /^sk-or-[A-Za-z0-9_-]{20,200}$/,
      'A chave do OpenRouter começa com "sk-or-". Copie-a inteira, sem espaços.',
    ),
});
