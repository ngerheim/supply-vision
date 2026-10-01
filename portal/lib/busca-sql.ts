import { textoBusca } from './busca.ts';

// INSTR evita o limite de 50 bytes dos padrões LIKE/GLOB do D1.
// https://developers.cloudflare.com/d1/platform/limits/
// As colunas vêm de listas internas; o texto sempre é um parâmetro vinculado.
export function padraoBuscaSql(query: string) {
  return textoBusca(query);
}

export function textoBuscaSql(column: string) {
  let expression = `lower(COALESCE(${column},''))`;
  for (const [characters, base] of [
    ['áàâãä', 'a'],
    ['éèêë', 'e'],
    ['íìîï', 'i'],
    ['óòôõö', 'o'],
    ['úùûü', 'u'],
    ['ç', 'c'],
  ]) {
    for (const character of characters + characters.toUpperCase())
      expression = `replace(${expression},'${character}','${base}')`;
  }
  return expression;
}
