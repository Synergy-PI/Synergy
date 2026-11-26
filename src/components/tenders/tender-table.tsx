import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { TenderListItem } from '@/lib/data/tenders';
import { formatCurrency, formatDateTimeShort, formatRelative } from '@/lib/format';
import { pncpTenderUrl } from '@/lib/pncp/normalize';
import { analysisState } from '@/lib/tenders/analysis-policy';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const CLOSING_SOON_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_TERMS = 4;

const headClasses =
  'px-3 py-2.5 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase first:pl-4 last:pr-4';
const cellClasses = 'px-3 py-3 align-top first:pl-4 last:pr-4';
const linkClasses =
  'inline-flex items-center gap-1 font-medium whitespace-nowrap text-brand-700 hover:underline';

type TenderTableProps = {
  tenders: TenderListItem[];
  now: Date;
  /** Filtros atuais da listagem, para a tela de requisitos saber para onde voltar. */
  listQuery: string;
};

/**
 * Licitações abertas em tabela, uma por linha. Clicar no objeto abre os requisitos do edital. Em telas
 * estreitas o órgão e a modalidade descem para a célula do objeto e a tabela rola na horizontal.
 */
export function TenderTable({ tenders, now, listQuery }: TenderTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
      <table data-testid="tenders-table" className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Licitações com propostas abertas</caption>
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th scope="col" className={headClasses}>
              Objeto
            </th>
            <th scope="col" className={cn(headClasses, 'hidden w-48 lg:table-cell')}>
              Órgão
            </th>
            <th scope="col" className={cn(headClasses, 'hidden w-32 lg:table-cell')}>
              Modalidade
            </th>
            <th scope="col" className={cn(headClasses, 'w-32 text-right')}>
              Valor estimado
            </th>
            <th scope="col" className={cn(headClasses, 'w-36')}>
              Encerramento
            </th>
            <th scope="col" className={cn(headClasses, 'w-40')}>
              Links
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tenders.map((tender) => (
            <TenderRow key={tender.id} tender={tender} now={now} listQuery={listQuery} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Situação dos requisitos do edital, para o usuário saber o que encontra ao clicar. */
function RequirementsStatus({ tender, now }: { tender: TenderListItem; now: Date }) {
  const analysis = tender.analysis;
  switch (analysisState(analysis && { ...analysis, incomplete: false }, now)) {
    case 'ready':
      return analysis && analysis.requirementCount > 0 ? (
        <Badge variant="success">
          {analysis.requirementCount}{' '}
          {analysis.requirementCount === 1 ? 'requisito pronto' : 'requisitos prontos'}
        </Badge>
      ) : (
        <Badge variant="outline">Requisitos não localizados</Badge>
      );
    case 'queued':
    case 'running':
    case 'retrying':
      return <Badge>Analisando o edital</Badge>;
    case 'unavailable':
      return <Badge variant="outline">Edital não pôde ser lido</Badge>;
    default:
      return <span className="text-xs font-medium text-brand-700">Ver requisitos</span>;
  }
}

/** Uma licitação: objeto com o motivo da aderência ao nicho (quando houver) e os links oficiais. */
function TenderRow({
  tender,
  now,
  listQuery,
}: Omit<TenderTableProps, 'tenders'> & { tender: TenderListItem }) {
  const pncpUrl = pncpTenderUrl(tender.pncpId);
  const requirementsHref = `/app/licitacoes/${tender.id}${listQuery ? `?lista=${encodeURIComponent(listQuery)}` : ''}`;
  const closingSoon = tender.closesAt.getTime() - now.getTime() < CLOSING_SOON_MS;
  const showUnit = tender.unitName && tender.unitName !== tender.agencyName;
  const place = tender.city ? `${tender.city}/${tender.uf}` : tender.uf;

  return (
    <tr data-testid={`tender-row-${tender.id}`} className="transition-colors hover:bg-slate-50">
      {/* A célula inteira leva aos requisitos: o link do objeto se estende sobre ela. */}
      <td className={cn(cellClasses, 'relative')}>
        {tender.match ? (
          <Badge
            variant={tender.match.strength === 'strong' ? 'success' : 'default'}
            className="mb-1.5"
          >
            {tender.match.strength === 'strong' ? 'Alta aderência' : 'Possível aderência'}
          </Badge>
        ) : null}
        <Link
          data-testid={`tender-requirements-link-${tender.id}`}
          href={requirementsHref}
          title={tender.object}
          className="line-clamp-3 font-medium text-slate-900 after:absolute after:inset-0 hover:text-brand-700 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand-600"
        >
          {tender.object}
        </Link>
        <p className="mt-1 text-xs text-slate-500 lg:hidden">
          {tender.agencyName} · {place} · {tender.modalityName}
          {tender.isPriceRegistration ? ' · Registro de preços' : ''}
        </p>
        {tender.match ? (
          <ul
            className="mt-1.5 flex flex-wrap gap-1"
            aria-label="Termos do nicho encontrados no objeto"
          >
            {tender.match.terms.slice(0, MAX_TERMS).map((term) => (
              <li
                key={term}
                className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
              >
                {term}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
          <RequirementsStatus tender={tender} now={now} />
          <span>
            {tender.number ? `Nº ${tender.number} · ` : ''}
            {tender.pncpId}
          </span>
        </p>
      </td>

      <td className={cn(cellClasses, 'hidden lg:table-cell')}>
        <p className="line-clamp-3 text-slate-700" title={tender.agencyName}>
          {tender.agencyName}
        </p>
        {showUnit ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{tender.unitName}</p>
        ) : null}
        <p className="mt-0.5 text-xs text-slate-500">{place}</p>
      </td>

      <td className={cn(cellClasses, 'hidden text-slate-700 lg:table-cell')}>
        {tender.modalityName}
        {tender.isPriceRegistration ? (
          <span className="mt-0.5 block text-xs text-slate-500">Registro de preços</span>
        ) : null}
      </td>

      <td className={cn(cellClasses, 'text-right whitespace-nowrap tabular-nums')}>
        {tender.estimatedValue !== null ? (
          <span className="text-slate-900">{formatCurrency(tender.estimatedValue)}</span>
        ) : (
          <span className="text-xs text-slate-400">Não informado</span>
        )}
      </td>

      <td className={cellClasses}>
        <span className="whitespace-nowrap text-slate-900 tabular-nums">
          {formatDateTimeShort(tender.closesAt)}
        </span>
        <span
          className={cn(
            'mt-0.5 block text-xs',
            closingSoon ? 'font-medium text-amber-700' : 'text-slate-500',
          )}
        >
          {formatRelative(tender.closesAt, now)}
        </span>
      </td>

      <td className={cellClasses}>
        <div className="flex flex-col items-start gap-1.5">
          {pncpUrl ? (
            <a
              href={pncpUrl}
              data-testid={`tender-pncp-link-${tender.id}`}
              target="_blank"
              rel="noreferrer"
              title="Ver edital no PNCP"
              className={linkClasses}
            >
              Ver edital
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
          {tender.sourceUrl ? (
            <a
              href={tender.sourceUrl}
              data-testid={`tender-source-link-${tender.id}`}
              target="_blank"
              rel="noreferrer"
              title="Sistema de envio de propostas"
              className={linkClasses}
            >
              Envio de propostas
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
