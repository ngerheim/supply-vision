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
export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
  'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];
export const mascaraCep = (valor: string) =>
  String(valor).replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
export function mascaraTelefone(valor: string) {
  const d = String(valor).replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
export function formatarCnae(codigo?: string | null) {
  const d = (codigo || '').replace(/\D/g, '');
  return d.length === 7 ? `${d.slice(0, 4)}-${d[4]}/${d.slice(5)}` : d;
}
