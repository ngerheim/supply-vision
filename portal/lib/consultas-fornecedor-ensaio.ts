// Identificadores calculados para fixtures, sem dados de empresas reais.
export function cnpjFicticio(semente: number) {
  let valor = `973${String(semente).padStart(5, '0')}0001`;
  for (const tamanho of [12, 13]) {
    let peso = tamanho - 7, soma = 0;
    for (const digito of valor) { soma += Number(digito) * peso; peso = peso === 2 ? 9 : peso - 1; }
    const resto = soma % 11;
    valor += resto < 2 ? '0' : String(11 - resto);
  }
  return valor;
}
export const CNPJS_ENSAIO = {
  ativa: cnpjFicticio(1), baixada: cnpjFicticio(2), inexistente: cnpjFicticio(3), ativaAlternativa: cnpjFicticio(7),
  principalFora: cnpjFicticio(4), ambasFora: cnpjFicticio(5), inapta: cnpjFicticio(6),
};
let alternativaConsultada = false;

export async function provedorConsultaEnsaio(url: URL): Promise<unknown> {
  const codigo = url.pathname.split('/').at(-1)!;
  if (url.pathname.includes('/cep/')) return { cep: codigo, street: 'Rua Fictícia', neighborhood: 'Bairro Fictício', city: 'Cidade Fictícia', state: 'SP' };
  if (codigo === CNPJS_ENSAIO.ambasFora || (codigo === CNPJS_ENSAIO.principalFora && url.hostname === 'brasilapi.com.br')) throw new Error('Provedor ficticio indisponivel');
  if (codigo === CNPJS_ENSAIO.inexistente) return { status: 'ERROR', message: 'CNPJ ficticio inexistente' };
  const situacao = codigo === CNPJS_ENSAIO.baixada ? 'BAIXADA' : codigo === CNPJS_ENSAIO.inapta || (codigo === CNPJS_ENSAIO.ativaAlternativa && alternativaConsultada) ? 'INAPTA' : 'ATIVA';
  if (codigo === CNPJS_ENSAIO.ativaAlternativa) alternativaConsultada = true;
  const endereco = { logradouro: 'Rua Fictícia', numero: '10', complemento: '', bairro: 'Bairro Fictício', uf: 'SP', cep: '00000000' };
  return url.hostname === 'brasilapi.com.br'
    ? { ...endereco, cnpj: codigo, razao_social: 'FORNECEDOR FICTÍCIO', nome_fantasia: 'FANTASIA FICTÍCIA', descricao_situacao_cadastral: situacao, cnae_fiscal: 4520001, cnae_fiscal_descricao: 'Atividade fictícia', municipio: 'Cidade Fictícia' }
    : { ...endereco, cnpj: codigo, nome: 'FORNECEDOR FICTÍCIO', fantasia: 'FANTASIA FICTÍCIA', situacao, atividade_principal: [{ code: '45.20-0-01', text: 'Atividade fictícia' }], municipio: 'Cidade Fictícia' };
}
