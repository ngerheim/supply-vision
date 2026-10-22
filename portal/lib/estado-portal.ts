import { buildDivergente, PORTAL_BUILD } from './portal-build.ts';

export type EstadoPortal = { indisponivel: boolean; versaoNova: boolean };
export type SinalPortal = { polling?: boolean; falhaRede?: boolean; status?: number; build?: string | null; codigo?: unknown };
export const ESTADO_INICIAL: EstadoPortal = { indisponivel: false, versaoNova: false };
export const AVISO_INDISPONIVEL = 'Portal em atualização ou indisponível. Aguarde...';
export const AVISO_VERSAO = 'O Portal foi atualizado. Recarregue para continuar. Alterações não salvas nesta tela serão perdidas.';

// Reducao pura: so uma resposta boa do polling remove a indisponibilidade;
// a necessidade de recarga permanece ate o documento ser recarregado.
export function detectarEstadoPortal(estado: EstadoPortal, sinal: SinalPortal, carregado: string): EstadoPortal {
  const versaoNova = estado.versaoNova
    || buildDivergente(sinal.build ?? null, carregado)
    || (sinal.status === 409 && sinal.codigo === 'build_desatualizado');
  let indisponivel = estado.indisponivel;
  if (sinal.polling) {
    if (sinal.falhaRede || sinal.status === 502 || sinal.status === 503) indisponivel = true;
    else if (sinal.status !== undefined && sinal.status >= 200 && sinal.status < 300) indisponivel = false;
  }
  return indisponivel === estado.indisponivel && versaoNova === estado.versaoNova ? estado : { indisponivel, versaoNova };
}

// null suspende consultas de abas ocultas enquanto o Portal esta disponivel.
export function proximoIntervalo(estado: EstadoPortal, oculta: boolean): number | null {
  if (estado.indisponivel) return 5000;
  return oculta ? null : 15000;
}

let estado = ESTADO_INICIAL;
const ouvintes = new Set<() => void>();
export const obterEstadoPortal = () => estado;
export function assinarEstadoPortal(ouvinte: () => void) { ouvintes.add(ouvinte); return () => { ouvintes.delete(ouvinte); }; }
export function sinalizarPortal(sinal: SinalPortal) {
  if (typeof window === 'undefined') return;
  const proximo = detectarEstadoPortal(estado, sinal, PORTAL_BUILD);
  if (proximo === estado) return;
  estado = proximo;
  ouvintes.forEach(ouvinte => ouvinte());
}
