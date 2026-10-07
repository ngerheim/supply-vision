import { travarRestauracao } from './trava-restauracao.mjs';
import { redigirLog } from './redigir-log.mjs';
import { validacaoAtiva } from './operacao-validacao.mjs';
// Ponte local: o Worker só enfileira pedidos; este processo executa Python.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { abrirBancoLocal } from './banco-local.mjs';
import { privado, lerConfigBruta } from './configuracao.mjs';
import { validarPedidoRelatorio } from '../lib/relatorios.ts';
import { VALIDADE_HISTORICO_MS, arquivoHistoricoExpirado } from '../lib/retencao-relatorios.ts';

const produto = path.resolve(import.meta.dirname, '../..');
let filhoAtivo = null;
const pastaAlertas = path.join(produto, 'alertas');
export function identificadorExecucao(jobId, data = new Date()) {
  const dois = (numero) => String(numero).padStart(2, '0');
  const dia = `${data.getFullYear()}${dois(data.getMonth() + 1)}${dois(data.getDate())}`;
  const hora = `${dois(data.getHours())}${dois(data.getMinutes())}${dois(data.getSeconds())}`;
  return `${dia}_${hora}_${jobId.replace(/[^a-zA-Z0-9]/g, '')}`;
}
export function comandoRelatorio(job) {
  const pedido = validarPedidoRelatorio({
    action: job.action,
    from: job.from_date,
    to: job.to_date,
    recipient: job.recipient,
    dryRun: !!job.dry_run,
    requestKey: job.request_key,
  });
  const brasileira = (valor) => valor.split('-').reverse().join('/');
  if (pedido.action === 'recorte')
    return [
      'panorama/executar.py',
      '--inicio',
      brasileira(pedido.from),
      '--fim',
      brasileira(pedido.to),
    ];
  if (pedido.action === 'limpeza')
    return ['processo/limpeza.py', ...(pedido.dryRun ? ['--dry-run'] : [])];
  return [
    'processo/pipeline.py',
    ...(pedido.action === 'paralelo' ? ['--sem-envio'] : []),
  ];
}
export function reservarRelatorio(db) {
  if (validacaoAtiva(db)) return null;
  // Leitura antes da transação de escrita: o ciclo roda a cada 3 s e a fila
  // quase sempre está vazia. Abrir BEGIN IMMEDIATE à toa disputava o arquivo
  // com o portal (miniflare/D1), que não espera o lock e responde 500.
  if (!db.prepare("SELECT 1 FROM report_jobs WHERE status='queued' LIMIT 1").get()) return null;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM report_jobs WHERE status='running'").get()) {
      db.exec('COMMIT');
      return null;
    }
    const job = db
      .prepare(
        "SELECT * FROM report_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1",
      )
      .get();
    if (
      job &&
      !db
        .prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND active=1")
        .get(job.created_by)
    ) {
      db.prepare(
        "UPDATE report_jobs SET status='review',log=log||? WHERE id=?",
      ).run(
        '\nO solicitante perdeu a permissão de administrador. Outro administrador deve revisar este pedido.',
        job.id,
      );
      db.exec('COMMIT');
      return null;
    }
    if (job)
      db.prepare(
        "UPDATE report_jobs SET status='running',started_at=? WHERE id=? AND status='queued'",
      ).run(new Date().toISOString(), job.id);
    db.exec('COMMIT');
    return job || null;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}
export function revisarPedidosInterrompidos(db, restaurado = false) {
  // Reinicio normal preserva pedidos que ainda nao iniciaram. Na restauracao,
  // os pedidos da copia podem ja ter sido executados depois do backup.
  db.exec('BEGIN IMMEDIATE');
  try {
    const pedidos = db
      .prepare(
        restaurado
          ? "SELECT id,status,created_by FROM report_jobs WHERE status IN ('queued','running')"
          : "SELECT id,status,created_by FROM report_jobs WHERE status='running'",
      )
      .all();
    const timestamp = new Date().toISOString();
    for (const pedido of pedidos) {
      const mensagem =
        pedido.status === 'running'
          ? '\nExecução interrompida. Confira arquivos e entrega antes de solicitar novamente; não haverá reenvio automático.'
          : '\nO banco foi restaurado. Pedido preservado para revisão; use seus parâmetros em uma nova solicitação se ainda necessário.';
      db.prepare(
        'UPDATE report_jobs SET status=?,completed_at=?,log=log||? WHERE id=?',
      ).run(
        pedido.status === 'running' ? 'failed' : 'review',
        timestamp,
        mensagem,
        pedido.id,
      );
      db.prepare(
        "INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) VALUES(?,?,'UPDATE','report_job',?,?,?)",
      ).run(
        `aud_${crypto.randomUUID()}`,
        pedido.created_by,
        pedido.id,
        mensagem.trim(),
        timestamp,
      );
    }
    db.exec('COMMIT');
    return pedidos.length;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}
export function concluirRelatorio(db, job, code, log, artifacts = []) {
  const timestamp = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    // Código 2 significa lock ocupado, antes de processar ou enviar qualquer dado.
    // Não repetir automaticamente: o administrador decide quando tentar outra vez.
    const status = code === 0 ? 'done' : 'failed';
    db.prepare(
      "UPDATE report_jobs SET status=?,completed_at=?,exit_code=?,log=?,artifacts_json=? WHERE id=? AND status='running'",
    ).run(
      status,
      timestamp,
      code,
      log.slice(-64_000),
      JSON.stringify(artifacts),
      job.id,
    );
    db.prepare(
      "INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) VALUES(?,?,'UPDATE','report_job',?,?,?)",
    ).run(
      `aud_${crypto.randomUUID()}`,
      job.created_by,
      job.id,
      `Execução ${status}; código ${code}`,
      timestamp,
    );
    db.exec('COMMIT');
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}
export function listarArquivos(jobId, raiz = privado) {
  const arquivos = [];
  for (const subpasta of [
    'alertas/relatorios/diarios',
    'alertas/relatorios/diarios/previews-email',
    'alertas/relatorios/diarios/com_acordo',
    'alertas/relatorios/diarios/qualidade_acordos',
    'alertas/relatorios/diarios/pendencias_comparacao',
    'alertas/relatorios/historicos',
  ]) {
    const pasta = path.join(raiz, subpasta);
    if (!fs.existsSync(pasta)) continue;
    for (const entrada of fs.readdirSync(pasta, { withFileTypes: true })) {
      if (
        entrada.isFile() &&
        entrada.name.includes(jobId.replace(/[^a-zA-Z0-9]/g, '')) &&
        /\.(xlsx|csv|eml)$/i.test(entrada.name)
      )
        arquivos.push({
          name: entrada.name,
          relativePath: path.relative(raiz, path.join(pasta, entrada.name)),
          ...(subpasta === 'alertas/relatorios/historicos' ? { expiresAt: new Date(fs.statSync(path.join(pasta, entrada.name)).mtimeMs + VALIDADE_HISTORICO_MS).toISOString() } : {}),
        });
    }
  }
  return arquivos;
}
export function arquivoPermitido(job, nome, raiz = privado) {
  const artifact = JSON.parse(job.artifacts_json).find(
    (item) => item.name === nome,
  );
  if (!artifact) return null;
  try {
    const arquivo = fs.realpathSync.native(path.resolve(raiz, artifact.relativePath));
    const pasta = fs.realpathSync.native(path.join(raiz, 'alertas', 'relatorios'));
    const relativa = path.relative(pasta, arquivo);
    if (
      relativa.startsWith('..') ||
      path.isAbsolute(relativa) ||
      !fs.statSync(arquivo).isFile()
    )
      return null;
    return arquivo;
  } catch {
    return null;
  }
}
export function limparHistoricosExpirados(db, raiz = privado, agora = Date.now()) {
  // O consumidor pode partir antes das migracoes do Portal em uma base antiga.
  if (!db.prepare('PRAGMA table_info(report_jobs)').all().some(c => c.name === 'artifacts_cleaned_at')) {
    try { db.exec('ALTER TABLE report_jobs ADD COLUMN artifacts_cleaned_at TEXT'); }
    catch (erro) { if (!String(erro.message).includes('duplicate column')) throw erro; }
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_report_jobs_cleanup ON report_jobs(completed_at) WHERE action='recorte' AND completed_at IS NOT NULL AND status IN ('done','failed') AND artifacts_json!='[]' AND artifacts_cleaned_at IS NULL");
  let removidos = 0;
  const jobs = db.prepare("SELECT id,action,completed_at,artifacts_json FROM report_jobs WHERE action='recorte' AND completed_at IS NOT NULL AND status IN ('done','failed') AND artifacts_json!='[]' AND artifacts_cleaned_at IS NULL").all();
  const marcar = db.prepare('UPDATE report_jobs SET artifacts_cleaned_at=? WHERE id=? AND artifacts_json=?');
  for (const job of jobs) {
    let pendente = false;
    for (const artifact of JSON.parse(job.artifacts_json)) {
      if (!arquivoHistoricoExpirado(job, artifact, agora)) { pendente = true; continue; }
      const candidato = path.resolve(raiz, artifact.relativePath);
      const pastaHistoricos = path.resolve(raiz, 'alertas', 'relatorios', 'historicos');
      const relativa = path.relative(pastaHistoricos, candidato);
      if (relativa.startsWith('..') || path.isAbsolute(relativa)) continue;
      try {
        fs.lstatSync(candidato);
        const arquivo = arquivoPermitido(job, artifact.name, raiz);
        if (!arquivo) { pendente = true; continue; }
        const historicos = fs.realpathSync.native(pastaHistoricos);
        const real = path.relative(historicos, arquivo);
        if (real.startsWith('..') || path.isAbsolute(real)) continue;
        fs.unlinkSync(arquivo); removidos++;
      } catch (erro) {
        if (!['ENOENT','ENOTDIR'].includes(erro.code)) {
          pendente = true;
          console.error('Nao foi possivel excluir historico expirado:', erro.code);
        }
      }
    }
    if (!pendente) marcar.run(new Date(agora).toISOString(), job.id, job.artifacts_json);
  }
  return removidos;
}
export function encerrarArvore(filho, executar = execFile) {
  if (!filho?.pid || filho.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    executar('taskkill.exe', ['/PID', String(filho.pid), '/T', '/F'], { windowsHide: true }, erro => {
      if (erro && filho.exitCode === null) reject(erro); else resolve();
    });
  });
}
function lockDisponivel() {
  return new Promise((resolve, reject) => {
    execFile(path.join(pastaAlertas, '.venv', 'Scripts', 'python.exe'),
      ['processo/pipeline.py', '--verificar-lock'],
      { cwd: pastaAlertas, windowsHide: true, timeout: 15000, env: { ...process.env, SUPPLY_VISION_PRIVADO: privado } },
      erro => { if (!erro) resolve(true); else if (erro.code === 2) resolve(false); else reject(erro); });
  });
}
function executarPython(db, job, segredo) {
  return new Promise((resolve, reject) => {
    let log = '';
    const argumentos = comandoRelatorio(job);
    const python = path.join(pastaAlertas, '.venv', 'Scripts', 'python.exe');
    const filho = spawn(python, argumentos, {
      cwd: pastaAlertas,
      windowsHide: true,
      env: {
        ...process.env,
        SUPPLY_VISION_PRIVADO: privado,
        SUPPLY_VISION_RUN_ID: identificadorExecucao(job.id),
        SUPPLY_VISION_SEM_ENVIO: job.action === 'paralelo' ? '1' : '0',
        PYTHONUTF8: '1',
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    filhoAtivo = filho;
    const registrar = (chunk) => {
      log = (log + chunk).slice(-128_000);
    };
    const redigido = () => redigirLog(log, segredo).slice(-64_000);
    filho.stdout.setEncoding('utf8');
    filho.stderr.setEncoding('utf8');
    filho.stdout.on('data', registrar);
    filho.stderr.on('data', registrar);
    const atualizacao = setInterval(() => {
      try {
        db.prepare(
          "UPDATE report_jobs SET log=? WHERE id=? AND status='running'",
        ).run(redigido(), job.id);
      } catch (erro) {
        console.error('Não foi possível atualizar o progresso:', erro.message);
      }
    }, 2000);
    const limite = setTimeout(
      () => {
        registrar(
          '\nTempo máximo de duas horas excedido. Confira os registros antes de solicitar novo envio.\n',
        );
        execFile(
          'taskkill.exe',
          ['/PID', String(filho.pid), '/T', '/F'],
          { windowsHide: true },
          () => {},
        );
      },
      2 * 60 * 60_000,
    );
    filho.once('error', (erro) => {
      if (filhoAtivo === filho) filhoAtivo = null;
      clearInterval(atualizacao);
      clearTimeout(limite);
      reject(erro);
    });
    filho.once('close', (code) => {
      if (filhoAtivo === filho) filhoAtivo = null;
      clearInterval(atualizacao);
      clearTimeout(limite);
      resolve({ code: code ?? 1, log: redigido() });
    });
  });
}
export function criarServidorArquivos({ token, abrirBanco, raiz = privado }) {
  return http.createServer((req, res) => {
    const recebida = Buffer.from(req.headers.authorization || ''),
      esperada = Buffer.from(`Bearer ${token}`);
    if (
      req.method !== 'GET' ||
      recebida.length !== esperada.length ||
      !timingSafeEqual(recebida, esperada)
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    let db;
    try {
      const partes = new URL(req.url, 'http://localhost').pathname
        .split('/')
        .filter(Boolean)
        .map(decodeURIComponent);
      if (
        partes.length !== 2 ||
        partes.some((p) => !/^[a-zA-Z0-9_.-]+$/.test(p))
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      db = abrirBanco();
      const job = db
        ?.prepare('SELECT action,completed_at,artifacts_json FROM report_jobs WHERE id=?')
        .get(partes[0]);
      const arquivo = job && arquivoPermitido(job, partes[1], raiz);
      const artifact = job && JSON.parse(job.artifacts_json).find(a => a.name === partes[1]);
      if (artifact && arquivoHistoricoExpirado(job, artifact)) {
        res.writeHead(410, { 'cache-control': 'no-store' }); res.end(); return;
      }
      if (!arquivo) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': fs.statSync(arquivo).size,
        'cache-control': 'no-store',
      });
      const stream = fs.createReadStream(arquivo);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    } finally {
      db?.close();
    }
  });
}
async function principal() {
  const liberarRestauracao = travarRestauracao();
  // Mantem a trava durante toda a vida do runner, incluindo downloads e filas.
  process.once('exit', liberarRestauracao);
  const config = lerConfigBruta();
  if (!config.PORTAL_API_TOKEN)
    throw new Error(
      'Configure PORTAL_API_TOKEN para habilitar relatórios no portal.',
    );
  const porta = Number(config.RELATORIOS_PORTA || 3001);
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535)
    throw new Error('RELATORIOS_PORTA deve ser uma porta entre 1024 e 65535.');
  const abrir = () => abrirBancoLocal('report_jobs');
  const servidor = criarServidorArquivos({
    token: config.PORTAL_API_TOKEN,
    abrirBanco: abrir,
  });
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(porta, '127.0.0.1', resolve);
  });
  // O socket exclusivo garante que outro runner não marque um trabalho vivo como falho.
  const arquivoQlik = path.join(privado, 'alertas', 'config', 'cfg_qlik.txt');
  const chaveQlik = fs.existsSync(arquivoQlik)
    ? fs
        .readFileSync(arquivoQlik, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : [];
  let inicializado = false,
    ocupado = false,
    ultimaLimpeza = 0,
    ultimoPulso = 0;
  const ciclo = async () => {
    if (ocupado) return;
    const db = abrir();
    if (!db) return;
    ocupado = true;
    try {
      if (!inicializado) {
        // Um Python sobrevivente ainda pode estar enviando: nao declarar falha
        // nem permitir novos pedidos enquanto mantiver o lock operacional.
        if (!await lockDisponivel()) return;
        revisarPedidosInterrompidos(db);
        inicializado = true;
      }
      if (validacaoAtiva(db)) return;
      const job = reservarRelatorio(db);
      if (!job) return;
      try {
        const resultado = await executarPython(db, job, [
          config.PORTAL_API_TOKEN,
          config.SMTP_PASSWORD,
          ...chaveQlik,
        ]);
        concluirRelatorio(
          db,
          job,
          resultado.code,
          resultado.log,
          listarArquivos(job.id),
        );
      } catch (erro) {
        concluirRelatorio(
          db,
          job,
          1,
          `Não foi possível executar: ${erro.code || 'falha no serviço'}. Confira a instalação Python e os registros da operação.`,
        );
      }
    } finally {
      ocupado = false;
      db.close();
    }
  };
  const pulso = setInterval(() => {
    if (!inicializado) return;
    const db = abrir();
    if (!db) return;
    try {
      // O portal considera o serviço disponível com sinal de até 30 s. Gravar
      // a cada 15 s basta e reduz as escritas externas no banco do portal.
      if (Date.now() - ultimoPulso >= 15_000) {
        db.prepare(
          'INSERT INTO report_runner(id,heartbeat_at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at',
        ).run(new Date().toISOString());
        ultimoPulso = Date.now();
      }
      if (Date.now() - ultimaLimpeza >= 60_000 && !validacaoAtiva(db)) {
        const removidos = limparHistoricosExpirados(db);
        ultimaLimpeza = Date.now();
        if (removidos) console.log(`${removidos} arquivo(s) histórico(s) expirado(s) excluído(s).`);
      }
    } catch (erro) {
      console.error('Disponibilidade/limpeza dos relatórios:', erro.message);
    } finally {
      db.close();
    }
  }, 5000);
  const agenda = setInterval(() => {
    void ciclo().catch((erro) =>
      console.error('Fila de relatórios:', erro.message),
    );
  }, 3000);
  let encerrando = false;
  const encerrar = async () => {
    if (encerrando) return;
    encerrando = true;
    clearInterval(pulso);
    clearInterval(agenda);
    servidor.close();
    try { await encerrarArvore(filhoAtivo); liberarRestauracao(); process.removeListener('exit', liberarRestauracao); process.exit(0); }
    catch { console.error('Nao foi possivel encerrar a arvore Python; confira os processos antes de reiniciar.'); process.exit(1); }
  };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
  console.log(
    `Serviço de relatórios disponível somente em 127.0.0.1:${porta}.`,
  );
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  principal().catch((erro) => {
    console.error(erro.message);
    process.exitCode = 1;
  });
