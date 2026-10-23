// Identificadores sinteticos: digitos verificadores calculados, sem cadastro real.
export function cnpjExemplo(indice) {
  let digitos = `0000009${String(indice).padStart(5, '0')}`;
  for (const pesos of [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
    const resto = pesos.reduce((s, peso, i) => s + peso * Number(digitos[i]), 0) % 11;
    digitos += resto < 2 ? '0' : String(11 - resto);
  }
  return digitos;
}
export async function semearCadastros(api) {
  const { catalogs } = await api('/bootstrap');
  async function obter(tipo, corpo, chave) {
    const atual = catalogs[tipo].find(c => c[chave] === corpo[chave]);
    const registro = atual || { ...corpo, ...await api(`/catalogs/${tipo}`, 'POST', corpo) };
    if (!atual) catalogs[tipo].push(registro);
    return registro.id;
  }
  const locais = [];
  for (const city of ['CIDADE AURORA EXEMPLO', 'CIDADE HORIZONTE EXEMPLO', 'CIDADE VALE EXEMPLO']) locais.push(await obter('locations', { city, state: 'GO' }, 'city'));
  const fornecedores = [];
  for (let i = 0; i < 3; i++) fornecedores.push(await obter('suppliers', { tradeName: ['Oficina Aurora Exemplo', 'Autopecas Horizonte Exemplo', 'Servicos Vale Exemplo'][i], cnpj: cnpjExemplo(i + 1), city: ['CIDADE AURORA EXEMPLO', 'CIDADE HORIZONTE EXEMPLO', 'CIDADE VALE EXEMPLO'][i], state: 'GO' }, 'tradeName'));
  const itens = [];
  for (const name of ['FILTRO DE OLEO EXEMPLO', 'PASTILHA DE FREIO EXEMPLO', 'ALINHAMENTO EXEMPLO']) itens.push(await obter('items', { name }, 'name'));
  const modelos = [];
  for (const name of ['SEDAN 1.6 EXEMPLO', 'UTILITARIO 2.0 EXEMPLO']) modelos.push(await obter('models', { name }, 'name'));
  const unidade = await obter('units', { code: 'UN' }, 'code');
  const mappings = await api('/mappings');
  for (const [tipo, source, targetId] of [['items', 'Filtro demonstrativo', itens[0]], ['models', 'Sedan demonstrativo', modelos[0]], ['units', 'Unidade demonstrativa', unidade]]) {
    if (!mappings[tipo].some(m => m.sourceKey === source.toUpperCase())) await api(`/mappings/${tipo}`, 'POST', { source, targetId });
  }
  return { locais, fornecedores, itens, modelos, unidade };
}
