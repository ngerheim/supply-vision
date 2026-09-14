import { pathToFileURL } from 'node:url';

export async function verificarSaude(base = 'http://127.0.0.1:3000') {
  const origem = new URL(base).origin;
  const obter = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store' });
    if (r.status !== 200) throw new Error(`${new URL(url).pathname}: HTTP ${r.status}`);
    return r;
  };
  const health = await (await obter(`${origem}/api/health`)).json();
  if (health.app !== 'portal-suprimentos' || health.status !== 'ok') throw new Error('Identidade ou saude da API invalida');
  const pagina = await obter(`${origem}/`);
  if (!pagina.headers.get('content-type')?.includes('text/html')) throw new Error('Pagina nao e HTML');
  const html = await pagina.text();
  const urls = [...new Set([...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(m => new URL(m[1], origem).href))];
  if (!urls.some(u => new URL(u).pathname.endsWith('.css')) || !urls.some(u => new URL(u).pathname.endsWith('.js'))) throw new Error('Pagina sem referencias a CSS/JavaScript');
  await Promise.all(urls.map(async url => {
    if (new URL(url).origin !== origem) throw new Error('Arquivo essencial fora do portal');
    const r = await obter(url);
    const tipo = r.headers.get('content-type') || '';
    if (new URL(url).pathname.endsWith('.css') ? !tipo.includes('text/css') : !/(javascript|ecmascript)/i.test(tipo)) throw new Error(`Tipo invalido: ${url}`);
    if (!(await r.arrayBuffer()).byteLength) throw new Error(`Arquivo vazio: ${url}`);
  }));
  return `${urls.length} arquivos CSS/JavaScript e API saudaveis`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await verificarSaude(process.argv[2])); }
  catch (erro) { console.error(erro.message); process.exitCode = 1; }
}
