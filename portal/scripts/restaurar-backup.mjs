// Devolve o banco do portal a uma copia de backup.
//
// Existia o backup e existia o teste de restauracao, mas a restauracao em si
// era manual: parar a operacao, achar o arquivo de nome hexadecimal, apagar os
// -wal/-shm e sobrescrever. Errar um desses passos corrompe o banco, e ninguem
// devia ter de acertar isso sob pressao.
//
//   node scripts/restaurar-backup.mjs [--anterior] [--sim]
//
// --anterior usa a geracao mais velha (portal-atual.anterior.sqlite), que e a
// que interessa quando um backup novo ja empurrou o bom para tras.
// --sim dispensa a confirmacao digitada, para quem chama pela central.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

import { portalPrivado } from './configuracao.mjs';

const pastaBanco = path.join(portalPrivado, 'banco', 'estado', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
const pastaBackup = path.join(portalPrivado, 'backups');
const anterior = process.argv.includes('--anterior');
const semPergunta = process.argv.includes('--sim');
const origem = path.join(pastaBackup, anterior ? 'portal-atual.anterior.sqlite' : 'portal-atual.sqlite');

const TABELAS = ['users', 'tickets', 'agreements', 'agreement_items', 'suppliers', 'catalog_items', 'units'];

function localizarBanco() {
  if (!fs.existsSync(pastaBanco)) throw new Error(`Pasta do banco nao encontrada: ${pastaBanco}`);
  const nome = fs.readdirSync(pastaBanco).find((item) => item.endsWith('.sqlite') && item !== 'metadata.sqlite');
  if (!nome) throw new Error('Banco atual nao encontrado.');
  return path.join(pastaBanco, nome);
}

function resumir(arquivo) {
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const integridade = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    if (integridade !== 'ok') throw new Error(`Integridade reprovada: ${integridade}`);
    const tabelas = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((linha) => linha.name));
    const totais = {};
    for (const nome of TABELAS) totais[nome] = tabelas.has(nome) ? Number(db.prepare(`SELECT COUNT(*) total FROM ${nome}`).get().total) : null;
    return totais;
  } finally { db.close(); }
}

function operacaoNoAr() {
  // Com o portal no ar o arquivo esta aberto: sobrescrever deixaria o banco
  // inconsistente e o processo continuaria escrevendo no que foi substituido.
  const pid = path.join(portalPrivado, '..', 'operacao', 'supervisor.pid.json');
  if (!fs.existsSync(pid)) return false;
  try {
    const { pid: numero } = JSON.parse(fs.readFileSync(pid, 'utf8'));
    if (!numero) return false;
    process.kill(numero, 0);
    return true;
  } catch { return false; }
}

async function confirmar(pergunta) {
  if (semPergunta) return true;
  const io = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await new Promise((resolve) => io.question(pergunta, resolve))).trim().toLowerCase() === 'restaurar'; }
  finally { io.close(); }
}

if (!fs.existsSync(origem)) throw new Error(`Backup nao encontrado: ${origem}`);
if (operacaoNoAr()) throw new Error('A operacao esta no ar. Pare a operacao antes de restaurar.');

const alvo = localizarBanco();
const totaisBackup = resumir(origem);
const dataBackup = fs.statSync(origem).mtime.toLocaleString('pt-BR');
console.log(`Backup   : ${path.basename(origem)}  (${dataBackup})`);
console.log(`Conteudo : ${JSON.stringify(totaisBackup)}`);
console.log(`Destino  : ${alvo}`);

if (!await confirmar('\nO banco atual sera substituido. Digite "restaurar" para continuar: ')) {
  console.log('Restauracao cancelada. Nada foi alterado.');
  process.exit(1);
}

// O estado atual vira copia datada antes de qualquer escrita: se o backup
// escolhido for o errado, ainda da para voltar.
const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
const guardado = path.join(pastaBackup, `pre-restauracao-${carimbo}.sqlite`);
const db = new DatabaseSync(alvo, { readOnly: true });
try { db.exec(`VACUUM INTO '${guardado.replaceAll("'", "''").replaceAll('\\', '/')}'`); }
finally { db.close(); }
console.log(`Estado atual guardado em ${path.basename(guardado)}`);

// -wal e -shm carregam transacoes do banco antigo; deixa-los ao lado do
// arquivo novo corrompe a base restaurada.
for (const sufixo of ['-wal', '-shm']) fs.rmSync(alvo + sufixo, { force: true });
fs.copyFileSync(origem, alvo);

const totaisRestaurado = resumir(alvo);
console.log(`Restaurado: ${JSON.stringify(totaisRestaurado)}`);
if (JSON.stringify(totaisRestaurado) !== JSON.stringify(totaisBackup)) throw new Error('O banco restaurado nao confere com o backup.');
console.log('\nRestauracao concluida. Inicie a operacao novamente.');
