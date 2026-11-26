// Cálculo dos botões de um paginador numerado. Módulo puro, com testes.

/**
 * Páginas exibidas no paginador: sempre a primeira, a última e as vizinhas da atual; `null` marca um
 * salto ("…"). Um salto de uma única página mostra a própria página, que ocupa o mesmo espaço.
 * Ex.: página 5 de 20 → [1, null, 4, 5, 6, null, 20].
 */
export function paginationItems(
  page: number,
  pageCount: number,
  siblings = 1,
): Array<number | null> {
  const pages = new Set([1, pageCount]);
  for (let candidate = page - siblings; candidate <= page + siblings; candidate++) {
    if (candidate >= 1 && candidate <= pageCount) pages.add(candidate);
  }

  const items: Array<number | null> = [];
  let previous = 0;
  for (const current of [...pages].sort((a, b) => a - b)) {
    if (current - previous === 2) items.push(previous + 1);
    else if (current - previous > 2) items.push(null);
    items.push(current);
    previous = current;
  }
  return items;
}
