// Preload EXCLUSIVO das suites do PREPARAR; fora dele nao muda o processo.
// Falha antes do I/O: nunca dispensa as barreiras de restauracao/parada.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import sqlite from 'node:sqlite';
import { syncBuiltinESMExports, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, load } from './isolamento-sqlite-hooks.mjs';

if (process.env.SV_PREPARO_RAIZ) instalarIsolamento();
function instalarIsolamento() {
  const realpath = fs.realpathSync.native;
  const existe = fs.existsSync;
  const ler = fs.readFileSync;
  const gravar = fs.writeFileSync;
  const listar = fs.readdirSync;
  const raiz = realpath(process.env.SV_PREPARO_RAIZ);
  if (realpath(path.resolve(import.meta.dirname, '../..')) !== raiz || !/^\..+-preparo-[0-9a-f]{32}$/.test(path.basename(raiz))) throw new Error('PREPARAR isolamento: raiz descartavel invalida.');
  function exigirCaminho(valor, leitura = false) {
    if (typeof valor === 'number' || valor === ':memory:') return;
    const caminho = path.resolve(valor instanceof URL ? fileURLToPath(valor) : Buffer.isBuffer(valor) ? valor.toString() : valor);
    // Somente estado do processo, usado pelo teste de encerramento Linux.
    if (leitura && process.platform === 'linux' && /^\/proc\/\d+\/stat$/.test(caminho)) return;
    let ancestral = caminho;
    while (!existe(ancestral)) ancestral = path.dirname(ancestral);
    const real = path.resolve(realpath(ancestral), path.relative(ancestral, caminho));
    const relativo = path.relative(raiz, real);
    if (relativo.startsWith('..') || path.isAbsolute(relativo)) throw new Error('PREPARAR isolamento: arquivo fora do worktree.');
  }
  for (const k of ['SUPPLY_VISION_PRIVADO', 'TEMP', 'TMP', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'WRANGLER_LOG_PATH', 'MINIFLARE_REGISTRY_PATH']) if (process.env[k]) exigirCaminho(process.env[k]);
  const registro = path.join(raiz, '.cache/preparo-portas');
  fs.mkdirSync(registro, { recursive: true });
  const proprias = new Set();
  function registrar(porta) {
    proprias.add(porta);
    gravar(path.join(registro, `${process.pid}.json`), JSON.stringify({ pid: process.pid, portas: [...proprias] }));
  }
  function exigirPorta(porta, host = 'localhost') {
    if (!['127.0.0.1', '::1', 'localhost'].includes(host) || [3000, 3001].includes(Number(porta))) throw new Error('PREPARAR isolamento: endpoint de producao/rede bloqueado.');
    for (const nome of listar(registro)) {
      try {
        const j = JSON.parse(ler(path.join(registro, nome), 'utf8').replace(/^\uFEFF/, ''));
        process.kill(j.pid, 0);
        if (j.portas.includes(Number(porta))) return;
      } catch { /* registro incompleto ou dono encerrado */ }
    }
    throw new Error('PREPARAR isolamento: porta nao pertence a fixture.');
  }
  const listen = Reflect.get(net.Server.prototype, 'listen');
  net.Server.prototype.listen = function (...args) {
    const op = typeof args[0] === 'object' ? args[0] : { port: args[0] };
    if (op.port !== undefined && Number(op.port) !== 0) exigirPorta(op.port, op.host);
    this.prependOnceListener('listening', () => { const a = this.address(); if (a?.port) registrar(a.port); });
    return listen.apply(this, args);
  };
  const connect = Reflect.get(net.Socket.prototype, 'connect');
  net.Socket.prototype.connect = function (...args) {
    // Node pode entregar argumentos ja normalizados como [options, callback].
    const a = Array.isArray(args[0]) ? args[0] : args;
    const op = typeof a[0] === 'object' ? a[0] : { port: a[0], host: typeof a[1] === 'string' ? a[1] : undefined };
    if (op.path) exigirCaminho(op.path); else exigirPorta(op.port, op.host);
    return connect.apply(this, args);
  };
  // Tambem protege fs/promises, exports nomeados e SQLite nativo, que nao
  // passam por fs.open. Symlinks sao resolvidos antes da autorizacao.
  const leituras = ['readFile', 'readdir', 'stat', 'lstat', 'access', 'createReadStream'];
  const escritas = ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'unlink', 'rmdir', 'truncate', 'chmod', 'open', 'createWriteStream'];
  for (const nome of [...leituras, ...escritas, 'rename', 'copyFile', 'cp', 'link', 'symlink']) {
    const leitura = leituras.includes(nome);
    for (const objeto of [fs, fs.promises]) for (const chave of objeto === fs ? [nome, `${nome}Sync`] : [nome]) {
      if (typeof objeto[chave] !== 'function') continue;
      const original = objeto[chave];
      objeto[chave] = function (...args) {
        exigirCaminho(args[0], leitura);
        if (['rename', 'copyFile', 'cp', 'link', 'symlink'].includes(nome)) exigirCaminho(args[1]);
        return original.apply(this, args);
      };
    }
  }
  const DatabaseSync = sqlite.DatabaseSync;
  sqlite.DatabaseSync = class extends DatabaseSync {
    constructor(arquivo, options = {}) { exigirCaminho(arquivo); super(arquivo, options); }
  };
  syncBuiltinESMExports();
  registerHooks({ resolve, load });
  // Filhos CLI, workers e consumidores conservam a mesma guarda.
  const preload = `--import=${JSON.stringify(import.meta.url)}`;
  if (!process.env.NODE_OPTIONS?.includes(import.meta.url)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} ${preload}`.trim();
}
