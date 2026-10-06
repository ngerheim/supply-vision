import { isIsoDate } from './domain.ts';
import { EntradaInvalida } from './limites-entrada.ts';

export const exibirDataBrasileira = (iso: string) => iso.split('-').reverse().join('/');
export function dataBrasileiraParaIso(valor: string): string {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(valor))
    throw new EntradaInvalida('Informe as datas no formato DD/MM/AAAA.');
  const iso = valor.split('/').reverse().join('-');
  if (!isIsoDate(iso)) throw new EntradaInvalida('Informe uma data válida no formato DD/MM/AAAA.');
  return iso;
}
export function mascararDataBrasileira(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 8);
  return [digitos.slice(0, 2), digitos.slice(2, 4), digitos.slice(4)].filter(Boolean).join('/');
}
