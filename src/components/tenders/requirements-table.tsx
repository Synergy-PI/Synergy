import { requirementCategoryLabels } from '@/lib/labels';
import type { RequirementGroup, RequirementItem } from '@/lib/tenders/requirements-view';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const headClasses =
  'px-3 py-2.5 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase first:pl-4 last:pr-4';
const cellClasses = 'px-3 py-3 align-top first:pl-4 last:pr-4';

/** Onde a cláusula está, para o usuário conferir no documento oficial. */
function Source({ item }: { item: RequirementItem }) {
  return (
    <>
      {item.documentType}
      <span className="block text-slate-400">p. {item.page}</span>
    </>
  );
}

/**
 * Requisitos de habilitação de um edital, agrupados por categoria. O texto de cada linha é o do
 * documento oficial; o título em negrito, quando existe, é o resumo escrito pela IA.
 */
export function RequirementsTable({ groups }: { groups: RequirementGroup[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
      <table data-testid="requirements-table" className="w-full text-sm">
        <caption className="sr-only">Requisitos de habilitação do edital</caption>
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th scope="col" className={cn(headClasses, 'w-16 sm:w-20')}>
              Item
            </th>
            <th scope="col" className={headClasses}>
              Exigência
            </th>
            <th scope="col" className={cn(headClasses, 'hidden w-40 sm:table-cell')}>
              Onde está
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.category} className="divide-y divide-slate-100">
            <tr className="bg-brand-50">
              <th
                scope="colgroup"
                colSpan={3}
                className="px-4 py-2 text-left text-xs font-semibold text-brand-800"
              >
                {requirementCategoryLabels[group.category]} · {group.items.length}
              </th>
            </tr>
            {group.items.map((item) => (
              <tr
                key={item.id}
                data-testid={`requirement-${item.id}`}
                className={item.procedural ? 'text-slate-500' : undefined}
              >
                <td className={cn(cellClasses, 'text-xs whitespace-nowrap text-slate-500')}>
                  {item.label ?? '—'}
                </td>
                <td className={cellClasses}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {item.highlight ? <Badge variant="warning">Destaque</Badge> : null}
                    {item.procedural ? <Badge variant="outline">Procedimento</Badge> : null}
                    {item.title ? (
                      <span className="font-semibold text-slate-900">{item.title}</span>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      'whitespace-pre-line',
                      item.title || item.highlight || item.procedural ? 'mt-1' : null,
                      item.title ? 'text-slate-600' : 'text-slate-900',
                      item.procedural ? 'text-slate-500' : null,
                    )}
                  >
                    {item.text}
                  </p>
                  {/* Em telas estreitas, a origem desce para baixo do texto. */}
                  <p className="mt-1 text-xs text-slate-500 sm:hidden">
                    {item.documentType}, p. {item.page}
                  </p>
                </td>
                <td className={cn(cellClasses, 'hidden text-xs text-slate-600 sm:table-cell')}>
                  <Source item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** Quantos destaques o quadro mostra; os demais continuam marcados na tabela. */
const MAX_HIGHLIGHTS = 8;

/** As exigências que mais restringem a participação, segundo a IA: a leitura rápida da tela. */
export function RequirementHighlights({ items }: { items: RequirementItem[] }) {
  const shown = items.slice(0, MAX_HIGHLIGHTS);
  const hidden = items.length - shown.length;
  return (
    <section
      aria-label="Exigências em destaque"
      className="rounded-xl border border-amber-200 bg-amber-50 p-4"
    >
      <h2 className="text-sm font-semibold text-amber-900">
        {items.length === 1
          ? '1 exigência merece atenção'
          : `${items.length} exigências merecem atenção`}
      </h2>
      <p className="mt-0.5 text-xs text-amber-800">
        São as que costumam impedir uma empresa pequena de participar. Confira o texto completo na
        tabela.
      </p>
      <ul className="mt-3 space-y-2 text-sm text-slate-900">
        {shown.map((item) => (
          <li key={item.id} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>
              <span className={item.title ? undefined : 'line-clamp-3'}>
                {item.title ?? item.text}
              </span>{' '}
              <span className="text-xs whitespace-nowrap text-slate-500">
                ({item.documentType}, p. {item.page})
              </span>
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="mt-3 text-xs text-amber-800">
          {hidden === 1
            ? 'Mais 1 exigência em destaque na tabela abaixo.'
            : `Mais ${hidden} exigências em destaque na tabela abaixo.`}
        </p>
      ) : null}
    </section>
  );
}
