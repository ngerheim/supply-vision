import { EntradaInvalida, LIMITES_CAMPO } from './limites-entrada.ts';

export const CAMPOS_BUSCA = ['state', 'location', 'item', 'model', 'supplier'] as const;
export type FiltrosBusca = Record<typeof CAMPOS_BUSCA[number], string[]>;
export const filtrosVazios = (): FiltrosBusca => ({ state: [], location: [], item: [], model: [], supplier: [] });
// Uma data e ate 80 valores por consulta limitam o trabalho de cada filtro.
export const MAX_FILTROS_BUSCA = 80;

export function parametrosBusca(filters: FiltrosBusca) {
  const params = new URLSearchParams();
  for (const key of CAMPOS_BUSCA) for (const value of filters[key]) params.append(key, value);
  return params;
}

// Outro CNPJ do acordo (alias) atende a cidade da condicao: todas as cidades
// do acordo ou a cidade listada para ele. Mesma regra da planilha e do Alertas.
export const outroCnpjAtendeSql = (alias: string, cidade: string) => `(${alias}.todas_cidades=1 OR EXISTS (SELECT 1 FROM agreement_cnpj_locations acl
  WHERE acl.agreement_id=${alias}.agreement_id AND acl.supplier_id=${alias}.supplier_id AND acl.location_id=${cidade}))`;

// cidadeDaCondicao: coluna com a cidade de cada preco (Buscar). Sem ela, o
// filtro vale para o acordo inteiro (lista de Acordos).
export function condicoesBusca(params: URLSearchParams, ignorarCampo?: typeof CAMPOS_BUSCA[number], cidadeDaCondicao?: string) {
  const conditions: string[] = [], values: string[] = [];
  let totalSelecionado = 0;
  const columns = { state: 'l.state', location: 'l.id', item: 'ci.id', model: 'vm.id', supplier: 's.id' };
  for (const key of CAMPOS_BUSCA) {
    const selected = [...new Set(params.getAll(key).filter(Boolean))];
    if (selected.some(value => value.length > LIMITES_CAMPO.busca)) throw new EntradaInvalida('Filtro de busca muito longo.');
    totalSelecionado += selected.length;
    if (totalSelecionado > MAX_FILTROS_BUSCA) throw new EntradaInvalida(`Selecione no máximo ${MAX_FILTROS_BUSCA} opções entre os filtros.`);
    if (!selected.length || key === ignorarCampo) continue;
    const marcadores = selected.map(() => '?').join(',');
    // Fornecedor: o principal do acordo ou qualquer um dos outros CNPJs dele.
    if (key === 'supplier') {
      conditions.push(`(s.id IN (${marcadores}) OR EXISTS (SELECT 1 FROM agreement_cnpjs acf WHERE acf.agreement_id=a.id AND acf.supplier_id IN (${marcadores})${cidadeDaCondicao ? ` AND ${outroCnpjAtendeSql('acf', cidadeDaCondicao)}` : ''}))`);
      values.push(...selected, ...selected);
      continue;
    }
    conditions.push(`${columns[key]} IN (${marcadores})`);
    values.push(...selected.map(value => key === 'state' ? value.trim().toUpperCase() : value));
  }
  return { conditions, values };
}
