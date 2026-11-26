import { describe, expect, it } from 'vitest';
import { paginationItems } from './pagination';

describe('paginationItems', () => {
  it('mostra todas as páginas quando são poucas', () => {
    expect(paginationItems(1, 1)).toEqual([1]);
    expect(paginationItems(2, 3)).toEqual([1, 2, 3]);
    expect(paginationItems(1, 4)).toEqual([1, 2, 3, 4]);
  });

  it('marca os saltos com null e mantém a primeira e a última página', () => {
    expect(paginationItems(1, 20)).toEqual([1, 2, null, 20]);
    expect(paginationItems(5, 20)).toEqual([1, null, 4, 5, 6, null, 20]);
    expect(paginationItems(20, 20)).toEqual([1, null, 19, 20]);
  });

  it('mostra a página em vez do salto quando falta só uma', () => {
    expect(paginationItems(3, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(paginationItems(4, 20)).toEqual([1, 2, 3, 4, 5, null, 20]);
    expect(paginationItems(17, 20)).toEqual([1, null, 16, 17, 18, 19, 20]);
  });

  it('aceita mais vizinhas', () => {
    expect(paginationItems(10, 20, 2)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
  });
});
