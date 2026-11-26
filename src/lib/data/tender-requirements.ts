import 'server-only';
import { prisma } from '@/lib/prisma';

const analysisSelect = {
  status: true,
  attempts: true,
  nextAttemptAt: true,
  heartbeatAt: true,
  completedAt: true,
  error: true,
  documents: true,
  requirementCount: true,
  aiStatus: true,
  aiModel: true,
  aiError: true,
  aiHeartbeatAt: true,
  aiCompletedAt: true,
} as const;

/** Licitação com a análise dos documentos e os requisitos gravados, para a tela de requisitos. */
export async function getTenderWithRequirements(id: string) {
  const tender = await prisma.tender.findUnique({
    where: { id },
    select: {
      id: true,
      pncpId: true,
      object: true,
      agencyName: true,
      unitName: true,
      city: true,
      uf: true,
      modalityName: true,
      number: true,
      estimatedValue: true,
      isPriceRegistration: true,
      closesAt: true,
      sourceUrl: true,
      analysis: {
        select: {
          ...analysisSelect,
          requirements: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              position: true,
              category: true,
              procedural: true,
              label: true,
              text: true,
              documentType: true,
              page: true,
              aiCategory: true,
              aiProcedural: true,
              aiTitle: true,
              aiHighlight: true,
            },
          },
        },
      },
    },
  });
  if (!tender) return null;
  return { ...tender, estimatedValue: tender.estimatedValue?.toNumber() ?? null };
}

export type TenderWithRequirements = NonNullable<
  Awaited<ReturnType<typeof getTenderWithRequirements>>
>;

/** Situação da análise de uma licitação, para as actions decidirem se um pedido é permitido. */
export async function getTenderAnalysisStatus(id: string) {
  return prisma.tender.findUnique({
    where: { id },
    select: {
      id: true,
      closesAt: true,
      analysis: { select: { ...analysisSelect, _count: { select: { requirements: true } } } },
    },
  });
}
