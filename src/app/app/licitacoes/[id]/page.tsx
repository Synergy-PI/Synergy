import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { aiKeySource } from '@/lib/ai/keys';
import { requireRole } from '@/lib/auth/dal';
import { getTenderWithRequirements } from '@/lib/data/tender-requirements';
import { formatCurrency, formatDateTime, formatRelative } from '@/lib/format';
import { pncpTenderUrl } from '@/lib/pncp/normalize';
import {
  aiState,
  analysisState,
  canRequestAnalysis,
  hasRetryableFailure,
  parseAnalysisDocuments,
} from '@/lib/tenders/analysis-policy';
import { buildRequirementsView, sanitizeListQuery } from '@/lib/tenders/requirements-view';
import { RequirementHighlights, RequirementsTable } from '@/components/tenders/requirements-table';
import {
  RequirementsActionButton,
  RequirementsAutoRunner,
} from '@/components/tenders/tender-requirements-controls';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Requisitos do edital' };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Partial<Record<'lista' | 'procedimento' | 'ia', string | string[]>>>;
};

export default async function TenderRequirementsPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [user, tender] = await Promise.all([
    requireRole(['STARTUP'], `/app/licitacoes/${id}`),
    getTenderWithRequirements(id),
  ]);
  if (!tender) notFound();

  const now = new Date();
  const listQuery = sanitizeListQuery(query.lista);
  const backHref = listQuery ? `/app/licitacoes?${listQuery}` : '/app/licitacoes';
  const showProcedural = query.procedimento === '1';
  const wantsAi = query.ia !== '0';
  /** Link para esta tela trocando uma das opções de exibição. */
  const viewHref = (changes: { procedimento?: boolean; ia?: boolean }) => {
    const next = new URLSearchParams();
    if (listQuery) next.set('lista', listQuery);
    if (changes.procedimento ?? showProcedural) next.set('procedimento', '1');
    if (!(changes.ia ?? wantsAi)) next.set('ia', '0');
    const text = next.toString();
    return `/app/licitacoes/${tender.id}${text ? `?${text}` : ''}`;
  };

  const analysis = tender.analysis;
  const documents = parseAnalysisDocuments(analysis?.documents);
  const snapshot = analysis && { ...analysis, incomplete: hasRetryableFailure(documents) };
  const open = tender.closesAt > now;
  const state = analysisState(snapshot, now);
  const canRetry = open && canRequestAnalysis(snapshot, now);
  const requirements = analysis?.requirements ?? [];
  const ready = state === 'ready';

  const ai = aiState(analysis, now);
  const aiSource = ready && requirements.length > 0 ? await aiKeySource(user.id) : 'none';
  const autoRequestAi = ready && requirements.length > 0 && ai === 'idle' && aiSource !== 'none';
  const view = buildRequirementsView(requirements, { useAi: wantsAi, showProcedural });

  const pncpUrl = pncpTenderUrl(tender.pncpId);
  const showUnit = tender.unitName && tender.unitName !== tender.agencyName;
  const readDocuments = documents.filter((document) => document.error === null);
  const failedDocuments = documents.filter((document) => document.error !== null);

  return (
    <div className="space-y-6">
      <Link
        data-testid="tender-back-link"
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar às licitações
      </Link>

      <header className="space-y-3">
        <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">
          Requisitos do edital
        </p>
        <h1 className="line-clamp-4 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {tender.object}
        </h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-slate-600">
          <span className="flex items-start gap-1.5">
            <Building2 className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
            <span>
              {tender.agencyName}
              {showUnit ? <span className="text-slate-400"> · {tender.unitName}</span> : null}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4 text-slate-400" aria-hidden />
            {tender.city ? `${tender.city}/${tender.uf}` : tender.uf}
          </span>
          <span className="flex items-center gap-1.5">
            <Wallet className="size-4 text-slate-400" aria-hidden />
            {tender.estimatedValue !== null
              ? `${formatCurrency(tender.estimatedValue)} (estimado)`
              : 'Valor não informado'}
          </span>
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-4 text-slate-400" aria-hidden />
            {open
              ? `Propostas até ${formatDateTime(tender.closesAt)}`
              : `Encerrada ${formatRelative(tender.closesAt, now)}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand">{tender.modalityName}</Badge>
          {tender.isPriceRegistration ? <Badge variant="outline">Registro de preços</Badge> : null}
          {pncpUrl ? (
            <a
              href={pncpUrl}
              data-testid="tender-pncp-link"
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Ver edital no PNCP
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
          {tender.sourceUrl ? (
            <a
              href={tender.sourceUrl}
              data-testid="tender-source-link"
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Sistema de envio de propostas
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </header>

      <RequirementsAutoRunner
        tenderId={tender.id}
        requestAnalysis={open && state === 'none'}
        requestAi={autoRequestAi && wantsAi}
        polling={
          open &&
          (state === 'none' ||
            state === 'queued' ||
            state === 'running' ||
            (ready && (ai === 'working' || (autoRequestAi && wantsAi))))
        }
      />

      {state === 'none' || state === 'queued' || state === 'running' ? (
        <div
          role="status"
          data-testid="tender-analysis-progress"
          className="rounded-xl border border-slate-200 bg-white p-5 text-sm"
        >
          <p className="flex items-center gap-2 font-medium text-slate-900">
            <Loader2 className="size-4 animate-spin text-brand-600" aria-hidden />
            {!open
              ? 'Esta licitação já encerrou e não foi analisada.'
              : state === 'running'
                ? 'Baixando e lendo os documentos no PNCP'
                : 'O edital está na fila de análise'}
          </p>
          {open ? (
            <p className="mt-1 text-slate-600">
              Baixar o edital do PNCP costuma levar de 20 segundos a alguns minutos. Esta página se
              atualiza sozinha e o resultado fica salvo: você pode continuar navegando e voltar
              depois.
            </p>
          ) : null}
        </div>
      ) : null}

      {state === 'retrying' && analysis ? (
        <Alert variant="warning" title="O PNCP não entregou os documentos agora">
          <p>
            {analysis.error} Nova tentativa automática {formatRelative(analysis.nextAttemptAt, now)}
            .
          </p>
          {canRetry ? (
            <div className="mt-3">
              <RequirementsActionButton tenderId={tender.id} kind="analysis">
                Tentar agora
              </RequirementsActionButton>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {state === 'unavailable' && analysis ? (
        <Alert variant="warning" title="Não foi possível ler o edital desta licitação">
          <p>{analysis.error} Consulte o documento direto no PNCP.</p>
          {canRetry ? (
            <div className="mt-3">
              <RequirementsActionButton tenderId={tender.id} kind="analysis">
                Tentar de novo
              </RequirementsActionButton>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {ready && failedDocuments.length > 0 ? (
        <Alert variant="warning" title="O resultado pode estar incompleto">
          <p>
            Não foi possível ler: {failedDocuments.map((document) => document.type).join(', ')}.{' '}
            {failedDocuments[0].error}
          </p>
          {canRetry ? (
            <div className="mt-3">
              <RequirementsActionButton tenderId={tender.id} kind="analysis">
                Tentar de novo
              </RequirementsActionButton>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {ready && requirements.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Não localizamos a seção de habilitação"
          description="Lemos os documentos publicados, mas eles não seguem um formato que a triagem reconheça. Consulte o edital no PNCP."
        />
      ) : null}

      {ready && requirements.length > 0 ? (
        <>
          {ai === 'ready' && view.aiApplied ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <Badge variant="brand">
                <Sparkles className="size-3" aria-hidden />
                Organizado por IA
              </Badge>
              A IA separou as exigências das regras de procedimento e marcou os destaques. O texto
              de cada linha continua sendo o do edital.
              <Link
                data-testid="requirements-without-ai"
                href={viewHref({ ia: false })}
                className="font-medium text-brand-700 hover:underline"
              >
                Ver sem a IA
              </Link>
            </p>
          ) : null}
          {ai === 'ready' && !wantsAi ? (
            <p className="text-sm text-slate-600">
              Mostrando a triagem por regras, sem a IA.{' '}
              <Link
                data-testid="requirements-with-ai"
                href={viewHref({ ia: true })}
                className="font-medium text-brand-700 hover:underline"
              >
                Ver com a IA
              </Link>
            </p>
          ) : null}
          {ai === 'working' || (ai === 'idle' && autoRequestAi && wantsAi) ? (
            <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="size-4 animate-spin text-brand-600" aria-hidden />A IA está
              organizando os requisitos (cerca de 15 segundos). A triagem por regras já está abaixo.
            </p>
          ) : null}
          {ai === 'failed' && analysis ? (
            <Alert variant="warning" title="A IA não conseguiu organizar os requisitos">
              <p>{analysis.aiError} A triagem por regras continua disponível abaixo.</p>
              {aiSource !== 'none' ? (
                <div className="mt-3">
                  <RequirementsActionButton tenderId={tender.id} kind="ai">
                    Tentar de novo
                  </RequirementsActionButton>
                </div>
              ) : null}
            </Alert>
          ) : null}
          {(ai === 'idle' || ai === 'failed') && aiSource === 'none' ? (
            <Alert variant="info">
              Quer separar as exigências das regras de procedimento e ver primeiro as que mais
              restringem? Cadastre sua chave do OpenRouter no{' '}
              <Link
                data-testid="requirements-ai-setup"
                href="/app/perfil#ia"
                className="font-medium underline"
              >
                perfil
              </Link>{' '}
              (há modelos gratuitos).
            </Alert>
          ) : null}

          {view.highlights.length > 0 ? <RequirementHighlights items={view.highlights} /> : null}

          <section className="space-y-3" aria-label="Requisitos de habilitação">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <p className="text-sm text-slate-600" data-testid="requirements-count">
                <span className="font-semibold text-slate-900">{view.requirementCount}</span>{' '}
                {view.requirementCount === 1 ? 'exigência' : 'exigências'}
                {readDocuments.length > 0
                  ? ` em ${readDocuments
                      .map((document) =>
                        document.pages > 1
                          ? `${document.type} (${document.pages} páginas)`
                          : document.type,
                      )
                      .join(' e ')}`
                  : ''}
                {analysis?.completedAt
                  ? ` · analisado ${formatRelative(analysis.completedAt, now)}`
                  : ''}
              </p>
              {view.proceduralCount > 0 ? (
                <Link
                  data-testid="requirements-toggle-procedural"
                  href={viewHref({ procedimento: !showProcedural })}
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  {showProcedural
                    ? 'Ocultar regras de procedimento'
                    : `Mostrar ${view.proceduralCount} ${view.proceduralCount === 1 ? 'regra' : 'regras'} de procedimento`}
                </Link>
              ) : null}
            </div>

            {view.groups.length > 0 ? (
              <RequirementsTable groups={view.groups} />
            ) : (
              <EmptyState
                icon={FileText}
                title="Só há regras de procedimento"
                description="As cláusulas localizadas descrevem como a habilitação é conduzida, e não exigências à empresa. O edital pode remeter a um anexo que não foi publicado no PNCP."
              />
            )}

            <p className="text-xs text-slate-500">
              Triagem automática dos documentos publicados no PNCP: confira o edital antes de
              decidir participar.
              {analysis?.aiModel && view.aiApplied ? ` Modelo de IA: ${analysis.aiModel}.` : ''}
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
