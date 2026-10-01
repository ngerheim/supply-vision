import { EntradaInvalida } from './limites-entrada.ts';

export function paginacao(params: URLSearchParams) {
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? 25);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000 ||
    ![25, 50, 100].includes(pageSize)
  ) {
    throw new EntradaInvalida(
      'Página inválida. Escolha 25, 50 ou 100 registros por página.',
    );
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginaEfetiva(page: number, pageSize: number, total: number) {
  return Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
}
