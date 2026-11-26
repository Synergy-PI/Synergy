import { z } from 'zod';
import { UFS } from '@/lib/tenders/states';

export const tenderSyncSchema = z.object({
  uf: z.enum(UFS, { error: 'Escolha um estado válido' }),
});

export type TenderSyncInput = z.infer<typeof tenderSyncSchema>;

/** Identificador de uma licitação no nosso banco (cuid). */
export const tenderIdSchema = z.object({
  tenderId: z
    .string({ error: 'Licitação inválida' })
    .regex(/^[a-z0-9]{20,32}$/, 'Licitação inválida'),
});
