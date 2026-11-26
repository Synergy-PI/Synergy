import type { Metadata } from 'next';
import Link from 'next/link';
import { Landmark } from 'lucide-react';
import { requireRole } from '@/lib/auth/dal';
import { listNiches } from '@/lib/data/niches';
import {
  listTenderModalities,
  listTenderSyncs,
  searchTenders,
  type TenderSyncItem,
} from '@/lib/data/tenders';
import { formatRelative } from '@/lib/format';
import {
  TENDER_PAGE_SIZES,
  pageForPageSize,
  parseTenderFilters,
  tenderFiltersQuery,
  type TenderSearchParams,
} from '@/lib/tenders/filters';
import { NICHE_TENDER_TERMS, getTenderMatcher } from '@/lib/tenders/niches';
import { UF_NAMES, inState, isUf, ofState, ufFromCity } from '@/lib/tenders/states';
import { isSyncRunning, syncAvailability } from '@/lib/tenders/sync-policy';
import { TenderFilters } from '@/components/tenders/tender-filters';
import { TenderPageSizeSelect } from '@/components/tenders/tender-page-size-select';
import { TenderPagination } from '@/components/tenders/tender-pagination';
import { TenderSyncPanel, type TenderSyncView } from '@/components/tenders/tender-sync-panel';
import { TenderTable } from '@/components/tenders/tender-table';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Licitações' };

type Props = { searchParams: Promise<TenderSearchParams> };

function toSyncView(sync: TenderSyncItem | undefined, now: Date): TenderSyncView {
  if (!sync) return { kind: 'never' };
  if (isSyncRunning(sync, now)) {
    return { kind: 'running', pagesDone: sync.pagesDone, totalPages: sync.totalPages };
  }
  const updatedLabel = sync.completedAt ? formatRelative(sync.completedAt, now) : null;
  if (sync.status === 'SUCCEEDED' && updatedLabel) {
    return {
      kind: 'ready',
      tenderCount: sync.tenderCount,
      updatedLabel,
      canRefresh: syncAvailability(sync, now) === 'available',
    };
  }
  return {
    kind: 'failed',
    // RUNNING sem sinal de vida: o servidor reiniciou no meio da busca.
    error: sync.status === 'FAILED' && sync.error ? sync.error : 'a busca foi interrompida.',
    updatedLabel,
  };
}

export default async function TendersPage({ searchParams }: Props) {
  const [user, params, niches, syncs] = await Promise.all([
    requireRole(['STARTUP'], '/app/licitacoes'),
    searchParams,
    listNiches(),
    listTenderSyncs(),
  ]);
  const now = new Date();

  // Só nichos com termos de busca definidos podem filtrar as licitações.
  const selectableNiches = niches.filter((niche) => getTenderMatcher(niche.slug) !== null);
  const ownNiche = niches.find((niche) => niche.id === user.startup?.nicheId) ?? null;
  const ownUf = ufFromCity(user.startup?.city);

  const filters = parseTenderFilters(params, {
    defaultNicheSlug: ownNiche?.slug ?? null,
    defaultUf: ownUf,
    nicheSlugs: selectableNiches.map((niche) => niche.slug),
  });
  const niche = selectableNiches.find((item) => item.slug === filters.nicheSlug) ?? null;

  const [result, modalities] = await Promise.all([
    searchTenders(filters, now),
    listTenderModalities(filters.uf, now),
  ]);

  const syncedUfs = syncs.map((sync) => sync.uf).filter(isUf);
  const hasTendersInScope = modalities.length > 0;
  const pageHref = (page: number) => `/app/licitacoes?${tenderFiltersQuery(filters, { page })}`;
  // O resultado traz a página efetiva (a pedida pode passar do fim): é dela que partem os links.
  const shown = { ...filters, page: result.page };
  const pageSizeOptions = TENDER_PAGE_SIZES.map((pageSize) => ({
    size: pageSize,
    href: `/app/licitacoes?${tenderFiltersQuery(shown, { pageSize, page: pageForPageSize(shown, pageSize) })}`,
  }));
  const lastItem = result.firstItem + result.items.length - 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Oportunidades"
        title={niche ? `Licitações para ${niche.name}` : 'Licitações abertas'}
        description="Editais com propostas abertas no Portal Nacional de Contratações Públicas (PNCP). Contratos públicos são receita — e receita pesa na decisão de quem investe."
      />

      {user.startup && !ownNiche ? (
        <Alert variant="info">
          Defina o nicho da sua startup para ver primeiro as licitações mais aderentes.{' '}
          <Link
            data-testid="tenders-profile-link"
            href="/app/perfil"
            className="font-medium underline"
          >
            Editar perfil
          </Link>
        </Alert>
      ) : null}

      <TenderFilters
        filters={filters}
        niches={selectableNiches}
        ownNicheSlug={ownNiche?.slug ?? null}
        modalities={modalities}
        syncedUfs={syncedUfs}
      />

      {filters.uf ? (
        <TenderSyncPanel
          uf={filters.uf}
          view={toSyncView(
            syncs.find((sync) => sync.uf === filters.uf),
            now,
          )}
        />
      ) : syncedUfs.length > 0 ? (
        <p className="text-sm text-slate-600" data-testid="tenders-synced-states">
          Estados sincronizados: {syncedUfs.map((uf) => UF_NAMES[uf]).join(', ')}. Escolha um estado
          no filtro para atualizá-lo ou para buscar as licitações de outro.
          {user.startup && !ownUf
            ? ' Para abrir direto no seu estado, informe a cidade no perfil como "Cidade/UF".'
            : ''}
        </p>
      ) : (
        <EmptyState
          icon={Landmark}
          title="Nenhum estado sincronizado ainda"
          description='Escolha um estado no filtro acima e clique em "Filtrar" para buscar as licitações dele no PNCP.'
        />
      )}

      {niche ? (
        <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-900">
            Como escolhemos as licitações de {niche.name}?
          </summary>
          <div className="mt-3 space-y-2">
            <p>
              Procuramos no objeto de cada edital as expressões abaixo. Também entram os editais que
              contratam uma solução de tecnologia (software, plataforma, aplicativo...) e citam o
              setor. É uma triagem por palavras: confira o edital antes de decidir participar.
            </p>
            <ul className="flex flex-wrap gap-1.5" aria-label={`Expressões de ${niche.name}`}>
              {NICHE_TENDER_TERMS[niche.slug]?.specific.map((term) => (
                <li
                  key={term}
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                >
                  {term}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {result.total > 0 ? (
        <section className="space-y-4" aria-label="Licitações encontradas">
          <p className="text-sm text-slate-600" data-testid="tenders-result-count">
            <span className="font-semibold text-slate-900">
              {result.total.toLocaleString('pt-BR')}
              {result.truncated ? '+' : ''}
            </span>{' '}
            {result.total === 1 ? 'licitação aberta' : 'licitações abertas'}
            {niche ? ` com aderência a ${niche.name}` : ''}
            {filters.uf ? ` ${inState(filters.uf)}` : ''}
            {filters.q ? ` para "${filters.q}"` : ''}.
          </p>

          <TenderTable tenders={result.items} now={now} listQuery={tenderFiltersQuery(shown)} />

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <TenderPageSizeSelect value={filters.pageSize} options={pageSizeOptions} />
              <p className="text-sm text-slate-600" data-testid="tenders-page-range">
                Mostrando {result.firstItem.toLocaleString('pt-BR')}–
                {lastItem.toLocaleString('pt-BR')} de {result.total.toLocaleString('pt-BR')}
                {result.truncated ? '+' : ''}
              </p>
            </div>
            {result.pageCount > 1 ? (
              <TenderPagination
                page={result.page}
                pageCount={result.pageCount}
                hrefFor={pageHref}
              />
            ) : null}
          </div>
        </section>
      ) : hasTendersInScope ? (
        <EmptyState
          icon={Landmark}
          title="Nenhuma licitação encontrada"
          description={
            niche
              ? `Nenhum edital aberto${filters.uf ? ` ${inState(filters.uf)}` : ''} casa com os termos de ${niche.name} e os filtros escolhidos.`
              : 'Tente outros termos ou limpe os filtros.'
          }
          action={
            niche ? (
              <Link
                data-testid="tenders-show-all"
                href={`/app/licitacoes?${tenderFiltersQuery(filters, { nicheSlug: null, sort: 'prazo', page: 1 })}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                Ver todas as licitações{filters.uf ? ` ${ofState(filters.uf)}` : ''}
              </Link>
            ) : undefined
          }
        />
      ) : null}
    </div>
  );
}
