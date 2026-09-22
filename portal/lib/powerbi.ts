// Monta o endereco do relatorio de Manutencao a partir do portal.env.
//
// O link de "Publicar na web" e publico por natureza: quem o tiver ve o
// relatorio sem login. O que o Portal controla e onde ele aparece. Ele ja foi
// embutido na compilacao e ficava no JavaScript da pagina, servido sem login,
// ao alcance de qualquer pessoa na rede. Agora o Worker o recebe em tempo de
// execucao (scripts/iniciar-portal.mjs) e a API so o entrega depois do login.
//
// Aceita apenas https://app.powerbi.com: qualquer outro endereco no portal.env
// deixa a aba indisponivel em vez de emoldurar uma pagina desconhecida. Se o
// relatorio for republicado com outra estrutura de paginas, PBI_PAGINA deixa
// de casar e a aba abre na primeira pagina, sem erro visivel -- e o primeiro
// lugar a conferir se alguem reclamar que abriu a tabela errada.
const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '');

export function montarPowerBiUrl(endereco: unknown, pagina: unknown): string {
  try {
    const url = new URL(texto(endereco));
    if (url.protocol !== 'https:' || url.hostname !== 'app.powerbi.com') return '';
    const codigo = texto(pagina);
    if (codigo) url.searchParams.set('pageName', codigo);
    url.searchParams.set('navContentPaneEnabled', 'false');
    url.searchParams.set('filterPaneEnabled', 'false');
    return url.toString();
  } catch {
    return '';
  }
}
