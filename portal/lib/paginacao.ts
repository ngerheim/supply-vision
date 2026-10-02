// A URL aceita texto arbitrario; LIMIT/OFFSET precisam de inteiros seguros.
export function inteiroPositivo(value: string | null, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function paginaSolicitada(params: URLSearchParams, defaultSize = 50, maxSize = 200, minSize = 10) {
  return {
    page: inteiroPositivo(params.get('page'), 1),
    pageSize: Math.min(maxSize, Math.max(minSize, inteiroPositivo(params.get('pageSize'), defaultSize))),
  };
}
