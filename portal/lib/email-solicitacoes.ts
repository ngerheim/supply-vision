import { montarCasca, escapar } from './email-visual.ts';

export const situacaoSolicitacao: Record<string, string> = {
  aberta: 'aberta', em_analise: 'em análise', devolvida: 'devolvida para correção',
  cadastrado: 'cadastrado', recusado: 'recusado',
};
export const linkSolicitacao = (id: string) => `/?aba=chamados&solicitacao=${encodeURIComponent(id)}`;
export type DadosEmailSolicitacao = {
  solicitacaoId: string; codigo: string; fornecedor: string; cnpj: string; situacao: string; mensagem: string;
};

export function montarEmailSolicitacao(dados: DadosEmailSolicitacao, baseUrl: string) {
  const situacao = situacaoSolicitacao[dados.situacao] || dados.situacao;
  const assunto = `[Supply Vision] ${dados.codigo}: ${situacao}`;
  const url = `${baseUrl.trim().replace(/\/+$/, '')}${linkSolicitacao(dados.solicitacaoId)}`;
  const cnpj = dados.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const linhas = [`Fornecedor: ${dados.fornecedor}`, `CNPJ: ${cnpj}`, `Situação: ${situacao}`,
    ...(dados.mensagem ? [dados.mensagem] : [])];
  const texto = [assunto, '', ...linhas, '', `Abrir no Portal: ${url}`].join('\n');
  const html = montarCasca(`${dados.codigo}: ${situacao}`, dados.fornecedor,
    linhas.map(linha => `<p>${escapar(linha)}</p>`).join(''), { texto: 'Abrir no Portal', url });
  return { assunto, texto, html, url };
}
