import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { paginationItems } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

type TenderPaginationProps = {
  page: number;
  pageCount: number;
  /** Link da página informada, mantendo os filtros atuais. */
  hrefFor: (page: number) => string;
};

const disabledClasses = 'pointer-events-none opacity-50';

/** Paginador numerado da tabela de licitações. */
export function TenderPagination({ page, pageCount, hrefFor }: TenderPaginationProps) {
  const stepClasses = buttonVariants({ variant: 'outline', size: 'sm' });

  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Paginação das licitações">
      {page > 1 ? (
        <Link data-testid="tenders-previous-page" href={hrefFor(page - 1)} className={stepClasses}>
          <ChevronLeft className="size-4" aria-hidden />
          Anterior
        </Link>
      ) : (
        <span className={cn(stepClasses, disabledClasses)} aria-disabled="true">
          <ChevronLeft className="size-4" aria-hidden />
          Anterior
        </span>
      )}

      {paginationItems(page, pageCount).map((item, index) =>
        item === null ? (
          // A posição identifica o salto: há no máximo um antes e um depois da página atual.
          <span key={`gap-${index}`} className="px-1 text-sm text-slate-400" aria-hidden>
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            aria-current="page"
            className={buttonVariants({
              variant: 'primary',
              size: 'sm',
              className: 'min-w-8 px-2',
            })}
          >
            <span className="sr-only">Página </span>
            {item.toLocaleString('pt-BR')}
          </span>
        ) : (
          <Link
            key={item}
            data-testid={`tenders-page-${item}`}
            href={hrefFor(item)}
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'min-w-8 px-2' })}
          >
            <span className="sr-only">Página </span>
            {item.toLocaleString('pt-BR')}
          </Link>
        ),
      )}

      {page < pageCount ? (
        <Link data-testid="tenders-next-page" href={hrefFor(page + 1)} className={stepClasses}>
          Próxima
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(stepClasses, disabledClasses)} aria-disabled="true">
          Próxima
          <ChevronRight className="size-4" aria-hidden />
        </span>
      )}
    </nav>
  );
}
