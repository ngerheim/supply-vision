// Confere invariantes de seguranca direto no banco real.
//
// Existe porque os testes automatizados recriam PBKDF2 e SHA-256 localmente:
// eles provam que os algoritmos estao certos, mas nao que o portal GRAVOU as
// coisas certas. Foi exatamente essa lacuna que deixou passar o bug do
// password_iterations, que travaria qualquer instalacao nova.
//
// Uso: node scripts/verificar-banco.cjs
// Saida: codigo 1 se algum invariante falhar.

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
const arquivo = fs.readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
if (!arquivo) { console.error('Banco nao encontrado.'); process.exit(1); }
const db = new DatabaseSync(path.join(dir, arquivo), { readOnly: true });

let ok = 0, falhou = 0, avisos = 0;

// Aviso e diferente de falha. Pendencia de limpeza nao e problema de
// seguranca: acumula quando ninguem usa o portal por dias, porque a limpeza
// roda no login. Tratar isso como falha faz o verificador virar ruido e
// ensina a ignorar o vermelho.
const avisa = (nome, fn) => {
  try {
    const r = fn();
    if (r === true) { ok++; console.log('  [OK]    ' + nome); }
    else { avisos++; console.log('  [AVISO] ' + nome + '  ->  ' + r); }
  } catch (e) { avisos++; console.log('  [AVISO] ' + nome + '  ->  ' + e.message); }
};
const verifica = (nome, fn) => {
  try {
    const r = fn();
    if (r === true) { ok++; console.log('  [OK]    ' + nome); }
    else { falhou++; console.log('  [FALHA] ' + nome + '  ->  ' + r); }
  } catch (e) { falhou++; console.log('  [FALHA] ' + nome + '  ->  ' + e.message); }
};

console.log('\n  INVARIANTES DO BANCO\n  --------------------');

verifica('Integridade do arquivo', () => {
  const r = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
  return r === 'ok' ? true : r;
});

verifica('Nenhuma coluna guarda senha em claro', () => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const suspeitas = cols.filter((c) => ['password', 'senha', 'plaintext', 'pwd'].includes(c));
  return suspeitas.length === 0 ? true : 'colunas suspeitas: ' + suspeitas.join(', ');
});

verifica('TODOS os hashes de senha no formato esperado', () => {
  // A versao anterior usava LIMIT 1: cinco usuarios podiam estar corrompidos
  // e o invariante passava assim mesmo.
  const ruins = db.prepare('SELECT email, password_hash h FROM users').all()
    .filter((u) => !/^[0-9a-f]{64}$/.test(u.h || ''));
  return ruins.length === 0 ? true : ruins.map((u) => u.email).join(', ');
});

verifica('Nenhum perfil fora de admin, editor ou viewer', () => {
  const ruins = db.prepare("SELECT email, role FROM users WHERE role NOT IN ('admin','editor','viewer')").all();
  return ruins.length === 0 ? true : ruins.map((u) => u.email + ' (' + u.role + ')').join(', ');
});

// Duas coisas diferentes que a versao anterior misturava.
//
// Sessao vencida AINDA ACEITA e falha de seguranca: alguem entraria com
// credencial expirada. Sessao vencida ainda GRAVADA e so pendencia de
// limpeza -- ela nao autentica ninguem, porque currentUser filtra por
// expires_at. A limpeza roda no login, entao dias sem acesso acumulam
// registros sem que nada esteja errado.
//
// Confirmado na pratica: o portal ficou de 4 a 8 de setembro sem login e
// acumulou 19 sessoes vencidas. A versao anterior chamava isso de falha.
verifica('A consulta de autenticacao filtra sessao vencida', () => {
  // Verifica a REGRA, nao o estado: sessao vencida gravada e inofensiva desde
  // que a consulta de autenticacao a ignore. Uma condicao SQL do tipo
  // "vencida E nao vencida" daria zero sempre e nao provaria nada.
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'lib', 'database.ts'), 'utf8');
  const consulta = fonte.match(/FROM sessions s JOIN users u[^`]*/);
  if (!consulta) return 'nao encontrei a consulta de sessao em lib/database.ts';
  return /s\.expires_at\s*>\s*\?/.test(consulta[0])
    ? true
    : 'a consulta de sessao NAO filtra por expires_at: sessao vencida autenticaria';
});

avisa('Sessoes vencidas aguardando limpeza', () => {
  const n = db.prepare("SELECT COUNT(*) n FROM sessions WHERE datetime(expires_at) < datetime('now')").get().n;
  return n === 0 ? true : n + ' sessao(oes) vencida(s) gravada(s); serao apagadas no proximo login';
});

verifica('Toda sessao tem data de expiracao valida', () => {
  // datetime() devolve NULL para texto que nao e data: pega campo vazio,
  // malformado ou preenchido com lixo.
  const ruins = db.prepare(
    "SELECT COUNT(*) n FROM sessions WHERE expires_at IS NULL OR trim(expires_at)='' OR datetime(expires_at) IS NULL"
  ).get().n;
  return ruins === 0 ? true : ruins + ' sessao(oes) com expires_at invalido: nunca expirariam';
});

verifica('Toda sessao registra a ultima atividade de forma valida', () => {
  const ruins = db.prepare(
    "SELECT COUNT(*) n FROM sessions WHERE last_seen_at IS NULL OR trim(last_seen_at)='' OR datetime(last_seen_at) IS NULL"
  ).get().n;
  if (ruins > 0) return ruins + ' sessao(oes) sem last_seen_at valido: a expiracao por inatividade nao se aplica a elas';
  // Data no futuro adiaria a expiracao indefinidamente. A folga de 5 min cobre
  // relogio do sistema ligeiramente adiantado.
  const futuras = db.prepare(
    "SELECT COUNT(*) n FROM sessions WHERE datetime(last_seen_at) > datetime('now','+5 minute')"
  ).get().n;
  return futuras === 0 ? true : futuras + ' sessao(oes) com last_seen_at no futuro';
});

avisa('Tentativas de login antigas aguardando limpeza', () => {
  const n = db.prepare("SELECT COUNT(*) n FROM login_attempts WHERE datetime(created_at) < datetime('now','-48 hour')").get().n;
  if (n === 0) return true;
  const ultimo = db.prepare("SELECT MAX(created_at) m FROM audit_logs WHERE action='LOGIN'").get().m;
  return n + ' tentativa(s) com mais de 48h. Ultimo login: ' + (ultimo || 'nenhum') +
    ' -- a limpeza roda no login, entao dias sem acesso acumulam registros.';
});

verifica('Datas de criacao validas em usuarios e tentativas', () => {
  const u = db.prepare("SELECT COUNT(*) n FROM users WHERE created_at IS NULL OR datetime(created_at) IS NULL").get().n;
  const l = db.prepare("SELECT COUNT(*) n FROM login_attempts WHERE created_at IS NULL OR datetime(created_at) IS NULL").get().n;
  if (u === 0 && l === 0) return true;
  return 'datas invalidas: ' + u + ' usuario(s), ' + l + ' tentativa(s)';
});

verifica('Todo usuario tem salt e iteracoes coerentes', () => {
  const ruins = db.prepare(
    `SELECT email, password_iterations FROM users
     WHERE password_salt IS NULL OR password_salt = ''
        OR password_iterations IS NULL OR password_iterations < 120000`
  ).all();
  return ruins.length === 0 ? true : ruins.map((u) => u.email).join(', ');
});

verifica('Iteracoes gravadas sao valores conhecidos', () => {
  const valores = db.prepare('SELECT DISTINCT password_iterations n FROM users').all().map((r) => r.n);
  const invalidos = valores.filter((v) => v !== 120000 && v !== 600000);
  return invalidos.length === 0 ? true : 'valores inesperados: ' + invalidos.join(', ');
});

verifica('Tokens de sessao guardados como hash', () => {
  const sessoes = db.prepare('SELECT token FROM sessions').all();
  if (!sessoes.length) return true;
  const fora = sessoes.filter((s) => !/^[0-9a-f]{64}$/.test(s.token));
  return fora.length === 0 ? true : fora.length + ' sessao(oes) fora do formato de hash';
});

verifica('Existe ao menos um administrador ativo', () => {
  const n = db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n;
  return n > 0 ? true : 'nenhum administrador ativo: ninguem conseguiria gerenciar o portal';
});

verifica('Conta semente desativada', () => {
  const u = db.prepare("SELECT active FROM users WHERE email='admin@portal.local'").get();
  if (!u) return true;
  return u.active === 0 ? true : 'admin@portal.local ainda esta ativa';
});

const migrados = db.prepare('SELECT password_iterations n, COUNT(*) c FROM users GROUP BY 1').all();
console.log('\n  Distribuicao do custo das senhas:');
for (const m of migrados) console.log('    ' + String(m.n).padStart(7) + ' iteracoes: ' + m.c + ' usuario(s)');

db.close();
console.log('\n  ' + ok + ' invariante(s) ok, ' + avisos + ' aviso(s), ' + falhou + ' falha(s)\n');
if (avisos > 0) console.log('  Avisos nao sao falhas: indicam pendencia de limpeza, nao risco.\n');
process.exit(falhou > 0 ? 1 : 0);
