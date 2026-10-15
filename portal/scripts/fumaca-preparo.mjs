// Somente o build e o banco ficticio do PREPARAR. Nenhum dado da instalacao.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { randomBytes } from 'node:crypto';


const raiz = fs.realpathSync(process.env.SV_PREPARO_RAIZ || '');
// Wrangler consulta os.homedir() mesmo sem telemetria; o perfil descartavel
// precisa estar instalado antes de carregar Wrangler ou qualquer dependencia dele.
if (fs.realpathSync(path.resolve(import.meta.dirname, '../..')) !== raiz || !/^\..+-preparo-[0-9a-f]{32}$/.test(path.basename(raiz))) throw new Error('Perfil da fumaca fora do preparo');
const perfil = path.join(raiz, '.cache/perfil-fumaca');
fs.mkdirSync(perfil, { recursive: true });
os.homedir = () => perfil;
process.env.APPDATA = path.join(perfil, 'AppData/Roaming');
process.env.LOCALAPPDATA = path.join(perfil, 'AppData/Local');
syncBuiltinESMExports();
const { criarServidorSqlite } = await import('./sqlite-local.mjs');
const projeto = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const porta = Number(process.argv[2]), relatorios = Number(process.argv[3]);
if (path.dirname(projeto) !== raiz || !path.basename(raiz).match(/^\..+-preparo-[0-9a-f]{32}$/)) throw new Error('Fumaca exige worktree de preparo');
const registros = path.join(raiz, '.cache/preparo-portas');
if (![porta, relatorios].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535 && ![3000, 3001].includes(p)) || porta === relatorios || !fs.readdirSync(registros).some(f => {
  const j = JSON.parse(fs.readFileSync(path.join(registros, f), 'utf8').replace(/^\uFEFF/, ''));
  return j.portas?.includes(porta) && j.portas?.includes(relatorios);
})) throw new Error('Portas nao reservadas pelo preparo');
const persistencia = fs.mkdtempSync(path.join(raiz, '.cache/fumaca-'));
const senha = 'fumaca-ficticia-123456';
let worker, sqlite;
const prazoFinal = setTimeout(() => { console.error('Fumaca excedeu 20 s.');process.exit(1); }, 20_000);prazoFinal.unref();
const limite = AbortSignal.timeout(17_000);
function consultar(rota, corpo, signal = limite) {
  return new Promise((resolve, reject) => {
    const texto = corpo ? JSON.stringify(corpo) : '';
    const req = http.request({ host: '127.0.0.1', port: porta, path: rota, method: corpo ? 'POST' : 'GET', signal,
      headers: corpo ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto) } : {} }, res => {
      let dados = '';
      res.setEncoding('utf8');res.on('data', parte => { dados += parte; });
      res.on('error', reject);res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, dados }));
    });
    req.on('error', reject);req.end(texto);
  });
}
try {
  const token = randomBytes(32).toString('hex');
  sqlite = criarServidorSqlite({ persistencia, token });
  await new Promise((resolve, reject) => { sqlite.once('error', reject);sqlite.listen(0, '127.0.0.1', resolve); });
  const { unstable_startWorker } = await import('wrangler');
  const vars = { INITIAL_ADMIN_PASSWORD: senha, PORTAL_API_TOKEN: 'fumaca-ficticia', RELATORIOS_PORTA: String(relatorios),
    PORTAL_SQLITE_PORTA: String(sqlite.address().port), PORTAL_SQLITE_TOKEN: token };
  // API do mesmo Wrangler do Portal, com inspetor e watcher desligados.
  // Assim todos os listeners Node sao registrados pela guarda do PREPARAR.
  worker = await unstable_startWorker({ config: path.join(projeto, 'dist/server/wrangler.json'),
    bindings: Object.fromEntries(Object.entries(vars).map(([nome, value]) => [nome, { type: 'plain_text', value }])),
    dev: { server: { hostname: '127.0.0.1', port: porta }, inspector: false, watch: false, remote: false,
      persist: persistencia, logLevel: 'error', registry: undefined } });
  await Promise.race([worker.ready, new Promise((_, reject) => limite.addEventListener('abort', () => reject(limite.reason), { once: true }))]);
  while (true) {
    limite.throwIfAborted();
    try {
      const r = await consultar('/api/health', null, AbortSignal.any([limite, AbortSignal.timeout(1500)]));
      if (r.status === 200 && JSON.parse(r.dados).status === 'ok') break;
    } catch { limite.throwIfAborted(); }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const login = await consultar('/api/login', { email: 'admin@portal.local', password: senha });
  if (login.status !== 200 || !login.headers['set-cookie']?.some(c => c.includes('acordos_session='))) throw new Error('Login ficticio reprovado');
  console.log('Fumaca aprovada: health e login ficticio no Portal compilado.');
} finally {
  try { await worker?.dispose(); } finally {
    sqlite?.encerrar();
    fs.rmSync(persistencia, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    clearTimeout(prazoFinal);
  }
}
