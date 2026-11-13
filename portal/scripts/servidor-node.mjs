import fs from 'node:fs';
import path from 'node:path';
import { startProdServer } from 'vinext/server/prod-server';
import { CABECALHOS_SEGURANCA } from '../lib/cabecalhos-seguranca.ts';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { conexao } from './ip-conexao.mjs';

// Diagnostico de lentidao no log do Portal: pedido de API que passou de 2 s
// (metodo, caminho sem a busca, status e tempo; nada de corpo ou usuario) e
// fila principal travada por mais de 1 s no ultimo minuto. O health do
// supervisor tem prazo de 5 s; estes registros mostram quem o atrasou.
export const PEDIDO_LENTO_MS = 2000, FILA_TRAVADA_MS = 1000;
export function registrarPedidoLento(metodo, url, status, ms, registrar = console.log) {
  if (ms < PEDIDO_LENTO_MS) return false;
  let caminho = '?';
  try { caminho = new URL(url, 'http://localhost').pathname; } catch { /* caminho ilegivel fica '?' */ }
  registrar(`[portal] pedido lento: ${metodo} ${caminho.slice(0, 200)} ${status} ${Math.round(ms)} ms`);
  return true;
}

export async function iniciarServidorNode({ outDir = path.resolve(import.meta.dirname, '../dist'), host = '127.0.0.1', port = 3000, pararArquivo = null, pai = null } = {}) {
  const { build } = JSON.parse(fs.readFileSync(path.join(outDir, 'portal-build.json'), 'utf8'));
  const { server } = await startProdServer({ outDir, host, port });
  const emitir = server.emit.bind(server);
  const cliente = fs.realpathSync(path.join(outDir, 'client'));
  // Somente assets do build podem sair pelo servidor estatico, inclusive diante de symlinks.
  server.emit = function(evento, ...args) {
    if (evento !== 'request') return emitir(evento, ...args);
    const [req, res] = args;
    if (/^\/api(?:\/|$)/.test(new URL(req.url, 'http://localhost').pathname)) res.setHeader('x-portal-build', build);
    delete req.headers['content-security-policy'];
    delete req.headers['content-security-policy-report-only'];
    for (const [nome, valor] of Object.entries(CABECALHOS_SEGURANCA)) res.setHeader(nome, valor);
    let alvo;
    try {
      const url = new URL(req.url, 'http://localhost');
      const nome = decodeURIComponent(url.pathname);
      if (nome.includes('\\') || nome.includes('\0') || /(?:^|\/)(?:\.[^/]+|privado|node_modules|scripts|drizzle|dados-origem)(?:\/|$)/i.test(nome) || /\.(?:md|json|ts|tsx|ps1|cmd|sqlite[^/]*|env|map)$/i.test(nome)) throw new Error('Arquivo reservado');
      alvo = path.resolve(cliente, '.' + nome);
      if (!alvo.startsWith(cliente + path.sep) && alvo !== cliente) throw new Error('Fora do build');
      if (fs.existsSync(alvo)) {
        const real = fs.realpathSync(alvo);
        if (real !== cliente && !real.startsWith(cliente + path.sep)) throw new Error('Fora do build');
      }
    } catch {
      res.writeHead(404, { 'x-content-type-options': 'nosniff' });res.end();return true;
    }
    const inicio = performance.now();
    res.once('finish', () => registrarPedidoLento(req.method, req.url, res.statusCode, performance.now() - inicio));
    return conexao.run(req.socket.remoteAddress || 'local', () => emitir(evento, ...args));
  };
  const atraso = monitorEventLoopDelay({ resolution: 50 });
  atraso.enable();
  const medidor = setInterval(() => {
    const maximo = atraso.max / 1e6;
    if (maximo > FILA_TRAVADA_MS) console.log(`[portal] fila principal travada por ate ${Math.round(maximo)} ms no ultimo minuto`);
    atraso.reset();
  }, 60_000);
  medidor.unref();
  let encerramento;
  function encerrar() {
    if (encerramento) return encerramento;
    clearInterval(vigilancia);
    clearInterval(medidor);
    atraso.disable();
    encerramento = new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
      // O bundle e o launcher compartilham a mesma conexao, sem transporte HTTP.
      globalThis[Symbol.for('supply-vision:banco')]?.fechar();
      // Mantem a conexao fechada: uma requisicao pendente nao pode reabri-la.
    });
    return encerramento;
  }
  const vigilancia = pararArquivo || pai ? setInterval(() => {
    let paiSaiu = false;
    if (pai) { try { process.kill(pai, 0); } catch (erro) { paiSaiu = erro.code === 'ESRCH'; } }
    if ((pararArquivo && fs.existsSync(pararArquivo)) || paiSaiu) void encerrar();
  }, 250) : null;
  return { server, encerrar };
}
