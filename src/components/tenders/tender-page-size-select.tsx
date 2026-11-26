'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/input';

type TenderPageSizeSelectProps = {
  value: number;
  /** Cada opção já traz o link (interno, montado no servidor) que mantém os filtros atuais. */
  options: Array<{ size: number; href: string }>;
};

/** Seletor de itens por página da tabela de licitações: navega assim que a opção muda. */
export function TenderPageSizeSelect({ value, options }: TenderPageSizeSelectProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Mostra a opção escolhida enquanto a nova página carrega; depois volta a valer o valor do servidor.
  const [shownValue, setShownValue] = useOptimistic(value);

  return (
    <label className="flex items-center gap-2 text-sm whitespace-nowrap text-slate-600">
      Itens por página
      <Select
        data-testid="tenders-page-size"
        // O `!` vence a altura e a largura padrão dos controles de formulário.
        className="h-8! w-auto! py-0"
        value={shownValue}
        disabled={pending}
        onChange={(event) => {
          const option = options.find((item) => String(item.size) === event.target.value);
          if (!option) return;
          startTransition(() => {
            setShownValue(option.size);
            router.push(option.href);
          });
        }}
      >
        {options.map((option) => (
          <option key={option.size} value={option.size}>
            {option.size}
          </option>
        ))}
      </Select>
    </label>
  );
}
