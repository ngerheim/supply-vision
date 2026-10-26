import { ApiError, errorText } from './api.ts';

export const SITUACOES_SOLICITACAO = {
  aberta: 'Aguardando análise',
  em_analise: 'Em análise',
  devolvida: 'Devolvida para correção',
  cadastrado: 'Cadastrado',
  recusado: 'Recusado',
};
export const AVISO_MANUAL =
  'Os dados não puderam ser verificados na Receita; Suprimentos vai conferir';
export const AVISO_REVISAO_SOLICITACAO =
  'A solicitação foi alterada; recarregue';
export const rotuloSituacao = (status: string) =>
  SITUACOES_SOLICITACAO[status as keyof typeof SITUACOES_SOLICITACAO] || status;
export const mascaraCnpj = (valor: string) =>
  valor
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2}\.\d{3})(\d)/, '$1.$2')
    .replace(/(\.\d{3})(\d)/, '$1/$2')
    .replace(/(\/\d{4})(\d)/, '$1-$2');
export function erroDeRevisao(erro: unknown) {
  return erro instanceof ApiError && erro.details.status === 409
    ? AVISO_REVISAO_SOLICITACAO
    : errorText(erro);
}
export const corpoJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
export function dataHoraSolicitacao(valor: string) {
  return new Date(valor).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
}
