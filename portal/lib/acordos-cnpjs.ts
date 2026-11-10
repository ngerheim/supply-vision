// Acordo com varios CNPJs: o fornecedor principal (agreements.supplier_id)
// atende todas as cidades do acordo; os demais CNPJs ficam em agreement_cnpjs
// e atendem todas as cidades (todas_cidades=1) ou so as listadas em
// agreement_cnpj_locations (tabelas em lib/database.ts). Itens, versoes e importacoes continuam um so por
// acordo: corrigir o acordo corrige todos os CNPJs.

import { stringList, textValue } from './api-compartilhada.ts';
import { LIMITE_LISTA } from './limites-entrada.ts';

// Todos os CNPJs de cada acordo: o principal e os adicionais. Junte com
// ATENDE_CIDADE_SQL para ficar so com quem atende a cidade da condicao.
export const CNPJS_DO_ACORDO_SQL = `(SELECT id AS agreement_id, supplier_id, 1 AS todas FROM agreements
  UNION ALL SELECT agreement_id, supplier_id, todas_cidades FROM agreement_cnpjs)`;
export const atendeCidadeSql = (cnpj: string, local: string) => `(${cnpj}.todas=1 OR EXISTS (SELECT 1 FROM agreement_cnpj_locations acl
  WHERE acl.agreement_id=${cnpj}.agreement_id AND acl.supplier_id=${cnpj}.supplier_id AND acl.location_id=${local}))`;

export type CnpjAcordo = { supplierId: string; todasCidades: boolean; locationIds: string[] };

// Entrada da tela. undefined = o pedido nao mexe nos CNPJs (cliente antigo).
export function validarCnpjsAcordo(valor: unknown, principal: string, cidadesDoAcordo: string[]): { value?: CnpjAcordo[]; error?: string } {
  if (valor === undefined) return {};
  if (!Array.isArray(valor)) return { error: 'Lista de outros CNPJs inválida.' };
  if (valor.length > LIMITE_LISTA) return { error: `O acordo tem ${valor.length} outros CNPJs, acima do limite de ${LIMITE_LISTA}.` };
  const cidades = new Set(cidadesDoAcordo), vistos = new Set<string>(), lista: CnpjAcordo[] = [];
  for (const bruto of valor) {
    const linha = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const supplierId = textValue(linha.supplierId);
    if (!supplierId) return { error: 'Escolha o fornecedor de cada CNPJ adicional.' };
    if (supplierId === principal) return { error: 'O fornecedor principal não precisa ser incluído entre os outros CNPJs.' };
    if (vistos.has(supplierId)) return { error: 'O mesmo CNPJ aparece duas vezes entre os outros CNPJs.' };
    vistos.add(supplierId);
    const todasCidades = linha.todasCidades !== false;
    const locationIds = todasCidades ? [] : Array.from(new Set(stringList(linha.locationIds)));
    if (!todasCidades && !locationIds.length) return { error: 'Cada CNPJ adicional precisa atender pelo menos uma cidade do acordo.' };
    if (locationIds.some(l => !cidades.has(l))) return { error: 'Um CNPJ adicional está marcado numa cidade que não pertence ao acordo.' };
    lista.push({ supplierId, todasCidades, locationIds });
  }
  return { value: lista };
}

// Texto legivel para o Historico: "Fornecedor X — todas as cidades; Y — BH/MG".
export function descreverCnpjs(lista: { supplier: string; todasCidades: boolean; cidades: string[] }[]) {
  if (!lista.length) return 'Nenhum';
  return lista.map(c => `${c.supplier} — ${c.todasCidades ? 'todas as cidades' : c.cidades.join(', ')}`).join('; ');
}

type ItemComparado = { locationId: string; catalogItemId: string; modelId: string; unitId: string; price: number; brands: string | null;
  item: string; model: string; city: string; state: string; unit: string };
export type DiferencaUniao = { tipo: 'so_neste' | 'so_no_outro' | 'preco' | 'marcas'; item: string; model: string; city: string; state: string; unit: string;
  precoNeste: number | null; precoNoOutro: number | null; marcasNeste: string | null; marcasNoOutro: string | null };

// Unir so e seguro quando as condicoes vigentes dos dois acordos sao as
// mesmas: mesma cidade, item, modelo e medida, com o mesmo preco e as mesmas
// marcas. Qualquer diferenca vai para a lista e a uniao espera a correcao.
export function compararCondicoes(neste: ItemComparado[], noOutro: ItemComparado[]): DiferencaUniao[] {
  const chave = (i: ItemComparado) => [i.locationId, i.catalogItemId, i.modelId, i.unitId].join('|');
  const marcas = (v: string | null) => (v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  const outro = new Map(noOutro.map(i => [chave(i), i])), diferencas: DiferencaUniao[] = [];
  const base = (i: ItemComparado) => ({ item: i.item, model: i.model, city: i.city, state: i.state, unit: i.unit });
  for (const a of neste) {
    const b = outro.get(chave(a));
    outro.delete(chave(a));
    if (!b) diferencas.push({ tipo: 'so_neste', ...base(a), precoNeste: a.price, precoNoOutro: null, marcasNeste: a.brands, marcasNoOutro: null });
    else if (Math.round(a.price * 100) !== Math.round(b.price * 100)) diferencas.push({ tipo: 'preco', ...base(a), precoNeste: a.price, precoNoOutro: b.price, marcasNeste: a.brands, marcasNoOutro: b.brands });
    else if (marcas(a.brands) !== marcas(b.brands)) diferencas.push({ tipo: 'marcas', ...base(a), precoNeste: a.price, precoNoOutro: b.price, marcasNeste: a.brands, marcasNoOutro: b.brands });
  }
  for (const b of outro.values()) diferencas.push({ tipo: 'so_no_outro', ...base(b), precoNeste: null, precoNoOutro: b.price, marcasNeste: null, marcasNoOutro: b.brands });
  return diferencas.sort((x, y) => `${x.item}|${x.model}|${x.state}|${x.city}`.localeCompare(`${y.item}|${y.model}|${y.state}|${y.city}`, 'pt-BR'));
}
