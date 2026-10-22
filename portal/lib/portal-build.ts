import pacote from '../package.json' with { type: 'json' };

declare const __PORTAL_BUILD__: string;
// O compilador substitui o literal nos dois bundles. Testes de fonte usam
// um valor fixo; PORTAL_BUILD_COMMIT permite injetar o SHA na compilacao.
export const PORTAL_BUILD = typeof __PORTAL_BUILD__ === 'string' ? __PORTAL_BUILD__ : `${pacote.version}+ensaio`;
export const TELA_DESATUALIZADA = 'A tela está desatualizada. Recarregue a página.';
export const ehEscrita = (metodo = 'GET') => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo.toUpperCase());
export function buildDivergente(recebido: string | null, atual: string): boolean {
  return recebido !== null && recebido !== atual;
}
