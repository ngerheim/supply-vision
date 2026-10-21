import fs from 'node:fs';
import path from 'node:path';
import { startProdServer } from 'vinext/server/prod-server';
import { CABECALHOS_SEGURANCA } from '../lib/cabecalhos-seguranca.ts';
import { conexao } from './ip-conexao.mjs';

export async function iniciarServidorNode({ outDir = path.resolve(import.meta.dirname, '../dist'), host = '127.0.0.1', port = 3000, pararArquivo = null, pai = null } = {}) {
  const { server } = await startProdServer({ outDir, host, port });
  const emitir = server.emit.bind(server);
  const cliente = fs.realpathSync(path.join(outDir, 'client'));
  // Somente assets do build podem sair pelo servidor estatico, inclusive diante de symlinks.
  server.emit = function(evento, ...args) {
    if (evento !== 'request') return emitir(evento, ...args);
    const [req, res] = args;
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
    return conexao.run(req.socket.remoteAddress || 'local', () => emitir(evento, ...args));
  };
  let encerramento;
  function encerrar() {
    if (encerramento) return encerramento;
    clearInterval(vigilancia);
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
