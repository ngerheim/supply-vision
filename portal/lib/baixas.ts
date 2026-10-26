export const SITUACOES_BAIXA = {
  aberta: 'Aguardando baixa',
  baixada: 'Baixada',
  recusada: 'Recusada',
};
// O hifen pertence apenas ao formato antigo, na posicao de exibicao.
export function normalizarPlaca(valor: string): string | null {
  const placa = valor.trim().toUpperCase();
  if (!/^(?:[A-Z]{3}-?\d{4}|[A-Z]{3}\d[A-Z]\d{2})$/.test(placa)) return null;
  return placa.replace('-', '');
}
export function exibirPlaca(placa: string): string {
  return /^[A-Z]{3}\d{4}$/.test(placa)
    ? `${placa.slice(0, 3)}-${placa.slice(3)}`
    : placa;
}
export const linkBaixa = (id: string) =>
  `/?aba=chamados&baixa=${encodeURIComponent(id)}`;
