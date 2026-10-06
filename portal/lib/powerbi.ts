// Aceita somente incorporacao autenticada do Power BI (Site ou portal).
// Publicar na web ignora a autenticacao do Portal e nao protege dados empresariais.
const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '');

export function montarPowerBiUrl(endereco: unknown, pagina: unknown): string {
  try {
    const url = new URL(texto(endereco));
    if (url.protocol !== 'https:' || url.hostname !== 'app.powerbi.com' || url.pathname !== '/reportEmbed' || url.username || url.password || !url.searchParams.get('reportId')) return '';
    const codigo = texto(pagina);
    if (codigo) url.searchParams.set('pageName', codigo);
    url.searchParams.set('navContentPaneEnabled', 'false');
    url.searchParams.set('filterPaneEnabled', 'false');
    return url.toString();
  } catch {
    return '';
  }
}
