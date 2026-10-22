export type NotificacaoCentral = { id: string; tipo: string; texto: string; link: string; criada_em: string; lida_em: string | null };
const INICIAL = { usuario: null as string | null, naoLidas: 0 };
let estado = INICIAL;
const ouvintes = new Set<() => void>();
export const obterCentral = () => estado;
export const centralInicial = () => INICIAL;
export function assinarCentral(ouvinte: () => void) { ouvintes.add(ouvinte); return () => { ouvintes.delete(ouvinte); }; }
export function definirUsuarioCentral(usuario: string | null) {
  if (estado.usuario === usuario) return;
  estado = { usuario, naoLidas: 0 };
  ouvintes.forEach(fn => fn());
}
export function atualizarContagemCentral(usuario: string, naoLidas: number) {
  if (estado.usuario !== usuario || estado.naoLidas === naoLidas) return;
  estado = { usuario, naoLidas };
  ouvintes.forEach(fn => fn());
}
