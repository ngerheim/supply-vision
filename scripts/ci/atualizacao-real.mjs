// H2 usa o atualizador real da base e do destino, sem dispensar build ou suites.
// O negativo verifica continuidade sem trocar HEAD/dados; os positivos verificam
// troca e reserva reutilizada. TEMP isola os dados; artefatos nao incluem bancos.
// Apoio exclusivo da integracao H2: exige uma instalacao descartavel em TEMP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export function raizFixture(raiz) {
  const real = fs.realpathSync.native(raiz);
  const temp = fs.realpathSync.native(os.tmpdir());
  const relativa = path.relative(temp, real);
  assert.ok(relativa && !relativa.startsWith('..') && !path.isAbsolute(relativa));
  assert.match(path.basename(path.dirname(real)), /^sv-h2-[0-9a-f]{32}$/);
  assert.equal(path.basename(real), 'instalacao');
  return real;
}
function arquivos(pasta) {
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap(e => {
    const p = path.join(pasta, e.name);
    // Nao seguir links para fora da fixture; npm file: guarda junctions locais.
    if (e.isSymbolicLink()) return [p];
    return e.isDirectory() ? arquivos(p) : [p];
  });
}
function arquivoBanco(raiz) {
  const candidatos = arquivos(path.join(raiz, 'privado/portal/banco')).filter(p => p.endsWith('.sqlite') && path.basename(p) !== 'metadata.sqlite');
  assert.equal(candidatos.length, 1, 'Exige exatamente um banco na fixture');
  return candidatos[0];
}
function banco(raiz, gravar = false) {
  const db = new DatabaseSync(arquivoBanco(raiz), { readOnly: !gravar });
  db.exec('PRAGMA busy_timeout=5000');
  return db;
}
export function versoesEsperadas(raiz) {
  const versoes = new Set();
  for (const p of arquivos(path.join(raiz, 'portal/lib')).filter(p => p.endsWith('.ts'))) {
    const fonte = fs.readFileSync(p, 'utf8');
    for (const m of fonte.matchAll(/schema_migrations\s+WHERE\s+version\s*=\s*(\d+)/g)) versoes.add(Number(m[1]));
    for (const m of fonte.matchAll(/INTO\s+schema_migrations\s*\([^)]*\)\s*VALUES\s*\(\s*(\d+)/g)) versoes.add(Number(m[1]));
  }
  assert.ok(versoes.size, 'Nenhuma migracao encontrada no codigo de destino');
  return [...versoes].sort((a, b) => a - b);
}
export function conferirBanco(db, antes, versoes) {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const [tabela, dados] of Object.entries(antes)) {
    const cols = dados.colunas.map(c => `"${c}"`).join(',');
    assert.deepEqual(JSON.parse(JSON.stringify(db.prepare(`SELECT ${cols} FROM "${tabela}" ORDER BY id`).all())), dados.linhas, `Dados alterados: ${tabela}`);
  }
  const aplicadas = db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version);
  for (const v of versoes) assert.ok(aplicadas.includes(v), `Migracao ${v} nao aplicada`);
}
function dados(db) {
  return Object.fromEntries(['users', 'suppliers', 'tickets', 'ticket_events'].map(t => [t, {
    colunas: db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name),
    linhas: db.prepare(`SELECT * FROM "${t}" ORDER BY id`).all(),
  }]));
}
function manifesto(raiz) {
  // Exclui estado dinamico (logs, heartbeats, sessoes, caches). Inclui TODOS
  // os artefatos e configuracoes estaveis, nao apenas tamanho/data de arquivos.
  const pastas = ['scripts', 'portal/dist', 'portal/node_modules', 'alertas/.venv',
    'privado/comum', 'privado/portal/configuracao', 'privado/alertas/config', 'privado/alertas/parametros'];
  return Object.fromEntries(pastas.flatMap(p => arquivos(path.join(raiz, p))).sort().map(p => [path.relative(raiz, p),
    fs.lstatSync(p).isSymbolicLink() ? `link:${fs.readlinkSync(p)}` : crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
}
export function intervalosConsumidores(raiz) {
  // Ler o codigo da instalacao em execucao, inclusive a base anterior da PR.
  // Nao aceitar silenciosamente um intervalo desconhecido se o runner mudar.
  const email = fs.readFileSync(path.join(raiz, 'portal/scripts/processar-emails.mjs'), 'utf8').match(/if \(observar\).*setTimeout\(resolve,\s*([\d_]+)\)/);
  const relatorios = fs.readFileSync(path.join(raiz, 'portal/scripts/processar-relatorios.mjs'), 'utf8').match(/Date\.now\(\) - ultimoPulso >= ([\d_]+)/);
  assert.ok(email && relatorios, 'Intervalos dos consumidores desconhecidos; reveja o monitor H2');
  return { emails: Number(email[1].replaceAll('_', '')), relatorios: Number(relatorios[1].replaceAll('_', '')) };
}
export function avaliarConsumidor(pid, heartbeat, intervaloMs, agora = Date.now(), testarVivo = id => process.kill(id, 0)) {
  assert.ok(Number.isFinite(intervaloMs) && intervaloMs > 0, 'Intervalo do consumidor invalido');
  let vivo = false, erro = null;
  if (Number.isInteger(pid) && pid > 0) {
    try { testarVivo(pid); vivo = true; } catch (e) { erro = e.code || e.message; }
  }
  const idade = agora - Date.parse(heartbeat);
  // Tres ciclos e o busy_timeout SQLite (5 s) toleram a carga do build/suites.
  // Processo morto reprova imediatamente, mesmo com heartbeat ainda recente.
  const limiteMs = 3 * intervaloMs + 5000;
  return { pid, vivo, heartbeat: heartbeat ?? null, idadeMs: Number.isFinite(idade) ? idade : null,
    intervaloMs, limiteMs, erro, disponivel: vivo && Number.isFinite(idade) && idade >= -5000 && idade <= limiteMs };
}
export function pidsConsumidores(texto) {
  return Object.fromEntries(['emails', 'relatorios'].map(nome => {
    const inicios = [...texto.matchAll(new RegExp(` ${nome} iniciado \\(PID (\\d+)\\)\\.`, 'g'))];
    return [nome, inicios.length ? Number(inicios.at(-1)[1]) : null];
  }));
}
export function conferirAmostras(amostras, negativo = false, pidsAntes = amostras[0]?.pidsConsumidores) {
  assert.ok(amostras.some(a => a.fase === 'PREPARAR'), 'PREPARAR nao observado');
  assert.ok(pidsAntes?.emails > 0 && pidsAntes?.relatorios > 0, 'PIDs iniciais dos consumidores ausentes');
  for (const a of amostras) {
    if (negativo || a.fase !== 'TROCAR') assert.ok(a.health && a.supervisor && a.consumidores, `Operacao caiu fora de TROCAR: ${JSON.stringify(a)}`);
    if (negativo || a.fase === 'PREPARAR') assert.deepEqual(a.pidsConsumidores, pidsAntes, `Consumidores reiniciaram no PREPARAR: ${JSON.stringify(a)}`);
  }
  if (!negativo) {
    assert.deepEqual([...new Set(amostras.map(a => a.fase))], ['PREPARAR', 'TROCAR', 'CONCLUIR']);
    assert.ok(amostras.some(a => !a.health), 'Nenhuma parada observada');
    const ultimo = amostras.at(-1);
    assert.ok(ultimo.health && ultimo.supervisor && ultimo.consumidores, 'Operacao nao voltou');
  }
}
async function monitorar(raiz, pasta, negativo) {
  const log = path.join(raiz, 'privado/operacao/atualizacao-tempos.log');
  const offset = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').length : 0;
  const amostras = [];
  const pidsAntes = JSON.parse(fs.readFileSync(path.join(pasta, 'consumidores-antes.json'), 'utf8').replace(/^\uFEFF/, ''));
  const intervalos = intervalosConsumidores(raiz);
  let fase = 'PREPARAR';
  do {
    const texto = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(offset) : '';
    const fases = [...texto.matchAll(/\] (PREPARAR|TROCAR|CONCLUIR):[^\n]*inicio\./g)].map(m => m[1]);
    if (fases.length) fase = fases.at(-1);
    let health = false;
    try { const r = await fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(2000) }); health = r.ok && (await r.json()).status === 'ok'; } catch { /* parada medida */ }
    let supervisor = false, consumidores = false, pid = null, erro = null, detalhesConsumidores = {};
    let pids = {};
    try {
      const st = JSON.parse(fs.readFileSync(path.join(raiz, 'privado/operacao/status.json'), 'utf8').replace(/^\uFEFF/, ''));
      const ident = JSON.parse(fs.readFileSync(path.join(raiz, 'privado/operacao/supervisor.pid.json'), 'utf8').replace(/^\uFEFF/, ''));
      process.kill(ident.pid, 0); pid = ident.pid;
      supervisor = st.ensaio === true && Date.now() - Date.parse(st.atualizado) < 30_000 && st.portal && st.emails && st.relatorios;
      pids = pidsConsumidores(fs.readFileSync(path.join(raiz, 'privado/operacao/supervisor.log'), 'utf8'));
      const db = banco(raiz);
      try { for (const [nome, t] of [['emails', 'email_runner'], ['relatorios', 'report_runner']]) {
        const r = db.prepare(`SELECT heartbeat_at FROM ${t} WHERE id=1`).get();
        detalhesConsumidores[nome] = avaliarConsumidor(pids[nome], r?.heartbeat_at, intervalos[nome]);
      }
      consumidores = Object.values(detalhesConsumidores).every(c => c.disponivel);
      } finally { db.close(); }
    } catch (e) { erro = `${e.code || e.name}: ${e.message}`; }
    // A fase pode mudar enquanto o pedido HTTP aguarda a parada.
    const recentes = fs.existsSync(log) ? [...fs.readFileSync(log, 'utf8').slice(offset).matchAll(/\] (PREPARAR|TROCAR|CONCLUIR):[^\n]*inicio\./g)] : [];
    if (recentes.length) fase = recentes.at(-1)[1];
    const a = { instante: Date.now(), fase, health, supervisor: !!supervisor, consumidores: !!consumidores, pid,
      pidsConsumidores: pids, detalhesConsumidores, erro };
    amostras.push(a);
    fs.appendFileSync(path.join(pasta, 'amostras.jsonl'), `${JSON.stringify(a)}\n`);
    if (amostras.length === 1) {
      conferirAmostras(amostras, true, pidsAntes);
      fs.writeFileSync(path.join(pasta, 'monitor-pronto'), 'ok');
    }
    if (fs.existsSync(path.join(pasta, 'monitor-parar'))) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (true);
  const fasesRegistradas = [...fs.readFileSync(log, 'utf8').slice(offset).matchAll(/\] (PREPARAR|TROCAR|CONCLUIR):[^\n]*inicio\./g)].map(m => m[1]);
  const transicoes = fasesRegistradas.filter((f, i) => f !== fasesRegistradas[i - 1]);
  assert.deepEqual(transicoes, negativo ? ['PREPARAR'] : ['PREPARAR', 'TROCAR', 'CONCLUIR'], 'Ordem das fases no log invalida');
  const preparar = amostras.filter(a => a.fase === 'PREPARAR');
  const continuidade = { antes: pidsAntes, fimPreparar: preparar.at(-1)?.pidsConsumidores,
    maioresIdadesMs: Object.fromEntries(['emails', 'relatorios'].map(nome => [nome,
      Math.max(...preparar.map(a => a.detalhesConsumidores[nome]?.idadeMs ?? -1))])) };
  fs.writeFileSync(path.join(pasta, 'continuidade-preparar.json'), JSON.stringify(continuidade, null, 2));
  console.log(`Continuidade PREPARAR: ${JSON.stringify(continuidade)}`);
  conferirAmostras(amostras, negativo, pidsAntes);
  if (negativo) assert.equal(new Set(amostras.map(a => a.pid)).size, 1, 'Supervisor reiniciou no negativo');
  fs.writeFileSync(path.join(pasta, 'monitor-aprovado'), 'ok');
  const paradas = amostras.filter(a => !a.health);
  console.log(`Parada observada (amostragem 500 ms, HTTP ate 2 s): ${paradas.length ? ((paradas.at(-1).instante - paradas[0].instante) / 1000).toFixed(2) : '0'} s; amostras=${amostras.length}`);
}
export function semearBanco(db) {
  db.prepare("UPDATE users SET email='admin@h2.test' WHERE role='admin'").run();
  db.prepare('INSERT INTO suppliers(id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('h2-fornecedor', 'Fornecedor ficticio H2', 'H2', '00000000000191', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  db.prepare('INSERT INTO tickets(id,code,supplier_name,scope,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('h2-chamado', 'SUP-0042', 'Fornecedor ficticio H2', 'Dado a preservar', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
}
async function executar() {
  const [modo, entrada, destino, extra] = process.argv.slice(2);
  const raiz = raizFixture(entrada);
  if (modo === 'monitor') return monitorar(raiz, destino, extra === 'negativo');
  const db = banco(raiz, ['semente', 'pendencia'].includes(modo));
  try {
    if (modo === 'semente') {
      semearBanco(db);
    } else if (modo === 'pendencia') {
      // O runtime base ja memorizou initialize(). A proxima partida deve
      // realmente executar a migracao 7, mesmo numa PR sem SQL novo.
      db.exec('DROP INDEX IF EXISTS idx_imports_created_global; DROP INDEX IF EXISTS idx_report_jobs_created_global; DELETE FROM schema_migrations WHERE version=7');
      console.log('Fixture: migracao 7 pendente; dados de negocio mantidos.');
    } else if (modo === 'snapshot') fs.writeFileSync(destino, JSON.stringify({ dados: dados(db), manifesto: manifesto(raiz), arquivoBanco: path.relative(raiz, arquivoBanco(raiz)) }));
    else if (modo === 'verificar' || modo === 'negativo') {
      const antes = JSON.parse(fs.readFileSync(destino, 'utf8'));
      assert.equal(path.relative(raiz, arquivoBanco(raiz)), antes.arquivoBanco, 'Caminho do banco alterado');
      conferirBanco(db, antes.dados, versoesEsperadas(raiz));
      if (modo === 'verificar') {
        for (const indice of ['idx_imports_created_global', 'idx_report_jobs_created_global']) {
          assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND name=?").get(indice), `Indice da migracao 7 ausente: ${indice}`);
        }
      }
      if (modo === 'negativo') assert.deepEqual(manifesto(raiz), antes.manifesto, 'Instalacao alterada no PREPARAR reprovado');
      console.log('Dados ficticios preservados; integridade, chaves estrangeiras e migracoes OK.');
    } else throw new Error(`Modo desconhecido: ${modo}`);
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  executar().catch(e => { console.error(e); process.exitCode = 1; });
}
