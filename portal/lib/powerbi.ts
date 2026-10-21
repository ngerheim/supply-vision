// Aceita os modos Site ou portal e Publicar na web configurados pela operacao.
const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '');

export function montarPowerBiUrl(endereco: unknown, pagina: unknown): string {
  try {
    const url = new URL(texto(endereco));
    if (url.protocol !== 'https:' || url.hostname !== 'app.powerbi.com' || url.username || url.password) return '';
    const identificador = url.pathname === '/view' ? 'r' : url.pathname === '/reportEmbed' ? 'reportId' : '';
    if (!identificador || !url.searchParams.get(identificador)?.trim()) return '';
    const codigo = texto(pagina);
    if (codigo) url.searchParams.set('pageName', codigo);
    url.searchParams.set('navContentPaneEnabled', 'false');
    url.searchParams.set('filterPaneEnabled', 'false');
    return url.toString();
  } catch {
    return '';
  }
}
