import { Worker } from 'node:worker_threads';

// Leituras pesadas fora da fila principal do Portal.
//
// O SQLite do Portal e sincrono: enquanto uma consulta grande roda, nenhum
// outro pedido e atendido -- nem o health do supervisor (prazo de 5 s). A
// copia de acordos pedida pelos Alertas (uma linha por condicao e por CNPJ)
// passou a levar dezenas de segundos e o supervisor acusava "Portal parou de
// responder" a cada rodada. Aqui a consulta roda numa thread propria, com uma
// conexao so de leitura (WAL: nao bloqueia nem e bloqueada pelo escritor), e
// devolve o JSON pronto; a fila principal so encaminha o texto.
//
// Codigo do worker embutido (eval): o build empacota lib/ e nao gera um
// arquivo separado para a thread.
const CODIGO = `
const { parentPort } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const conexoes = new Map();
function conexao(arquivo) {
  let db = conexoes.get(arquivo);
  if (!db) {
    db = new DatabaseSync(arquivo, { readOnly: true });
    db.exec('PRAGMA busy_timeout=5000; PRAGMA query_only=ON');
    conexoes.set(arquivo, db);
  }
  return db;
}
parentPort.on('message', ({ id, arquivo, consultas, formato }) => {
  try {
    const db = conexao(arquivo);
    // Varias leituras no mesmo instantaneo, como o batch do Portal.
    db.exec('BEGIN');
    let resultados;
    try { resultados = consultas.map(c => db.prepare(c.sql).all(...c.valores)); }
    finally { db.exec('COMMIT'); }
    parentPort.postMessage({ id, resultado: formato === 'json' ? JSON.stringify(resultados) : resultados });
  } catch (erro) {
    parentPort.postMessage({ id, erro: String(erro && erro.message || erro) });
  }
});
`;

type Consulta = { sql: string; valores?: unknown[] };
type Pendente = { resolve: (v: unknown) => void; reject: (e: Error) => void };
let worker: Worker | null = null, proximo = 1;
const pendentes = new Map<number, Pendente>();

function iniciar() {
  if (worker) return worker;
  const novo = new Worker(CODIGO, { eval: true });
  novo.on('message', ({ id, resultado, erro }: { id: number; resultado?: unknown; erro?: string }) => {
    const p = pendentes.get(id);
    if (!p) return;
    pendentes.delete(id);
    if (!pendentes.size) novo.unref();
    if (erro) p.reject(new Error(erro)); else p.resolve(resultado);
  });
  const falhar = (erro: Error) => {
    if (worker === novo) worker = null;
    for (const [id, p] of pendentes) { pendentes.delete(id); p.reject(erro); }
  };
  novo.on('error', falhar);
  novo.on('exit', codigo => falhar(new Error(`Leitura paralela encerrada (codigo ${codigo}).`)));
  // Presa ao processo so enquanto ha leitura pendente: ociosa, nao segura o
  // Portal na hora de encerrar (on('message') religa; por isso vem depois).
  novo.unref();
  worker = novo;
  return novo;
}

function pedir(arquivo: string, consultas: Consulta[], formato: 'json' | 'linhas') {
  return new Promise<unknown>((resolve, reject) => {
    const id = proximo++;
    pendentes.set(id, { resolve, reject });
    try { const atual = iniciar(); atual.ref(); atual.postMessage({ id, arquivo, consultas: consultas.map(c => ({ sql: c.sql, valores: c.valores ?? [] })), formato }); }
    catch (erro) { pendentes.delete(id); reject(erro as Error); }
  });
}

// Linhas de uma consulta, lidas na thread paralela.
export async function lerEmParalelo<T = Record<string, unknown>>(arquivo: string, sql: string, valores: unknown[] = []) {
  return ((await pedir(arquivo, [{ sql, valores }], 'linhas')) as T[][])[0];
}

// Resultado ja serializado: [[linhas da 1a consulta], ...] em JSON.
export async function lerJsonEmParalelo(arquivo: string, consultas: Consulta[]) {
  return (await pedir(arquivo, consultas, 'json')) as string;
}

// Testes: encerra a thread para nao segurar o processo entre suites.
export async function encerrarLeituraParalela() {
  const atual = worker;
  worker = null;
  if (atual) await atual.terminate();
}
