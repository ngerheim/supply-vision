export function textoBusca(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return text.normalize('NFD').replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ');
}

export function correspondeBusca(value: unknown, query: string): boolean {
  return textoBusca(value).includes(textoBusca(query));
}
