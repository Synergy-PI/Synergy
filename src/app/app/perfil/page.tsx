import type { Metadata } from 'next';
import { aiKeySource, getUserAiKeyInfo } from '@/lib/ai/keys';
import { requireUser } from '@/lib/auth/dal';
import { listNiches } from '@/lib/data/niches';
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/format';
import { roleLabels } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { PlanBadge } from '@/components/ui/plan-badge';
import { AiKeyForm } from './ai-key-form';
import {
  AccountForm,
  InvestorProfileForm,
  ProfessionalProfileForm,
  StartupProfileForm,
} from './profile-forms';

export const metadata: Metadata = { title: 'Meu perfil' };

export default async function ProfilePage() {
  const user = await requireUser('/app/perfil');

  const [startup, investor, professional, niches] = await Promise.all([
    user.startup
      ? prisma.startupProfile.findUnique({
          where: { id: user.startup.id },
          select: {
            name: true,
            pitch: true,
            description: true,
            website: true,
            city: true,
            stage: true,
            nicheId: true,
          },
        })
      : null,
    user.investor
      ? prisma.investorProfile.findUnique({
          where: { id: user.investor.id },
          select: { company: true, thesis: true, ticketMin: true, ticketMax: true, linkedin: true },
        })
      : null,
    user.professional
      ? prisma.professionalProfile.findUnique({
          where: { id: user.professional.id },
          select: {
            headline: true,
            bio: true,
            skills: true,
            linkedin: true,
            portfolio: true,
            availableForFreelance: true,
          },
        })
      : null,
    user.startup ? listNiches() : Promise.resolve([]),
  ]);

  // A IA organiza os requisitos das licitações, que são vistas por startups (e administradores).
  const usesTenders = user.role === 'STARTUP' || user.role === 'ADMIN';
  const [aiKey, aiSource] = usesTenders
    ? await Promise.all([getUserAiKeyInfo(user.id), aiKeySource(user.id)])
    : [null, 'none' as const];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Conta"
        title="Meu perfil"
        description={`Membro desde ${formatDate(user.createdAt)}.`}
        actions={
          <>
            <Badge variant="brand">{roleLabels[user.role]}</Badge>
            <PlanBadge plan={user.plan} />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Dados da conta</CardTitle>
            <CardDescription>Como você aparece para a comunidade.</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountForm name={user.name} email={user.email} />
          </CardContent>
        </Card>

        {startup ? (
          <Card>
            <CardHeader>
              <CardTitle>Perfil da startup</CardTitle>
              <CardDescription>
                Essas informações aparecem nas suas vagas e inscrições em eventos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StartupProfileForm profile={startup} niches={niches} />
            </CardContent>
          </Card>
        ) : null}

        {investor ? (
          <Card>
            <CardHeader>
              <CardTitle>Perfil de investidor anjo</CardTitle>
              <CardDescription>
                Ajuda as startups a entenderem sua tese antes de abordá-lo em eventos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InvestorProfileForm profile={investor} />
            </CardContent>
          </Card>
        ) : null}

        {usesTenders ? (
          <Card id="ia" className="scroll-mt-6 lg:col-start-2">
            <CardHeader>
              <CardTitle>Inteligência artificial nas licitações</CardTitle>
              <CardDescription>
                Com uma chave do OpenRouter, a IA organiza os requisitos de cada edital que você
                abrir: separa as exigências das regras de procedimento e destaca as que mais
                restringem a participação.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AiKeyForm
                saved={
                  aiKey ? { last4: aiKey.last4, updatedLabel: formatDate(aiKey.updatedAt) } : null
                }
              />
              <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
                <li>
                  Sua chave é usada em uma chamada por edital, quando você abre os requisitos de uma
                  licitação que a IA ainda não organizou. O resultado fica salvo e aparece para as
                  outras startups.
                </li>
                <li>
                  Os modelos gratuitos do OpenRouter permitem 50 chamadas por dia (1.000 para contas
                  que já compraram US$ 10 em créditos).
                </li>
                <li>
                  {aiSource === 'shared'
                    ? 'Sem chave própria, você usa a chave compartilhada do Synergy, limitada a 15 editais por hora.'
                    : aiSource === 'own'
                      ? 'Se você remover a chave, os requisitos continuam disponíveis pela triagem por regras.'
                      : 'Sem chave, os requisitos continuam disponíveis pela triagem por regras, sem a organização da IA.'}
                </li>
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {professional ? (
          <Card>
            <CardHeader>
              <CardTitle>Perfil profissional</CardTitle>
              <CardDescription>
                Mostre suas habilidades para as startups que estão contratando.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfessionalProfileForm profile={professional} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
