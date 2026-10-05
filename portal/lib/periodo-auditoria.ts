import { dataDeNegocio } from './data-negocio.ts';
import { isIsoDate } from './domain.ts';
import { EntradaInvalida } from './limites-entrada.ts';

// Localiza o primeiro instante do dia no fuso do negócio. A busca também
// respeita dias históricos de 23/25 horas e meia-noite inexistente no DST.
export function inicioDiaNegocio(dia: string): string {
  if (!isIsoDate(dia)) throw new EntradaInvalida('Informe uma data válida para o histórico.');
  const utc = Date.parse(`${dia}T00:00:00.000Z`);
  let inicio = utc - 86_400_000, fim = utc + 86_400_000;
  while (inicio < fim) {
    const meio = Math.floor((inicio + fim) / 2);
    if (dataDeNegocio(new Date(meio)) < dia) inicio = meio + 1;
    else fim = meio;
  }
  return new Date(inicio).toISOString();
}

export function intervaloDatasNegocio(de: string | null, ate: string | null) {
  const inicio = de ? inicioDiaNegocio(de) : null;
  let fim: string | null = null;
  if (ate) {
    if (!isIsoDate(ate)) throw new EntradaInvalida('Informe uma data válida para o histórico.');
    const seguinte = new Date(`${ate}T00:00:00.000Z`);
    seguinte.setUTCDate(seguinte.getUTCDate() + 1);
    fim = inicioDiaNegocio(seguinte.toISOString().slice(0, 10));
  }
  if (de && ate && de > ate) throw new EntradaInvalida('A data final do histórico não pode ser anterior à inicial.');
  return { inicio, fim };
}
