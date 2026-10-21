// Somente o build e o banco ficticio do PREPARAR. Nenhum dado da instalacao.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';


const raiz = fs.realpathSync(process.env.SV_PREPARO_RAIZ || '');
if (fs.realpathSync(path.resolve(import.meta.dirname, '../..')) !== raiz || !/^\..+-preparo-[0-9a-f]{32}$/.test(path.basename(raiz))) throw new Error('Perfil da fumaca fora do preparo');
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
let servidor;
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
  Object.assign(process.env, { SUPPLY_VISION_PRIVADO: persistencia, MODO_ENSAIO: '1', PORTAL_CRIAR_BANCO: '1',
    INITIAL_ADMIN_PASSWORD: senha, PORTAL_API_TOKEN: 'fumaca-ficticia', RELATORIOS_PORTA: String(relatorios) });
  const { iniciarServidorNode } = await import('./servidor-node.mjs');
  servidor = await iniciarServidorNode({ outDir: path.join(projeto, 'dist'), host: '127.0.0.1', port: porta });
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
  try { await servidor?.encerrar(); } finally {
    fs.rmSync(persistencia, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    clearTimeout(prazoFinal);
  }
}
