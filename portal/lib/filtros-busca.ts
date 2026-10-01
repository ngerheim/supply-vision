import { EntradaInvalida, LIMITES_CAMPO } from './limites-entrada.ts';

export const CAMPOS_BUSCA = ['state', 'location', 'item', 'model', 'supplier'] as const;
export type FiltrosBusca = Record<typeof CAMPOS_BUSCA[number], string[]>;
export const filtrosVazios = (): FiltrosBusca => ({ state: [], location: [], item: [], model: [], supplier: [] });
// Uma data + até 80 valores: mantém a consulta abaixo dos 100 parâmetros do D1.
export const MAX_FILTROS_BUSCA = 80;

export function parametrosBusca(filters: FiltrosBusca) {
  const params = new URLSearchParams();
  for (const key of CAMPOS_BUSCA) for (const value of filters[key]) params.append(key, value);
  return params;
}

export function condicoesBusca(params: URLSearchParams) {
  const conditions: string[] = [], values: string[] = [];
  const columns = { state: 'l.state', location: 'l.id', item: 'ci.id', model: 'vm.id', supplier: 's.id' };
  for (const key of CAMPOS_BUSCA) {
    const selected = [...new Set(params.getAll(key).filter(Boolean))];
    if (selected.some(value => value.length > LIMITES_CAMPO.busca)) throw new EntradaInvalida('Filtro de busca muito longo.');
    if (values.length + selected.length > MAX_FILTROS_BUSCA) throw new EntradaInvalida(`Selecione no máximo ${MAX_FILTROS_BUSCA} opções entre os filtros.`);
    if (!selected.length) continue;
    conditions.push(`${columns[key]} IN (${selected.map(() => '?').join(',')})`);
    values.push(...selected.map(value => key === 'state' ? value.trim().toUpperCase() : value));
  }
  return { conditions, values };
}
