// Devolve o banco do portal a uma copia de backup.
//
// Existia o backup e existia o teste de restauracao, mas a restauracao em si
// era manual: parar a operacao, achar o arquivo de nome hexadecimal, apagar os
// -wal/-shm e sobrescrever. Errar um desses passos corrompe o banco, e ninguem
// devia ter de acertar isso sob pressao.
//
//   node scripts/restaurar-backup.mjs [--anterior | --data AAAA-MM-DD] [--sim]
//
// Sem opcao, usa a copia mais recente (portal-atual.sqlite).
// --anterior usa a copia do dia anterior mais recente do historico de 7 dias,
// que e a que interessa quando um erro ja entrou no backup de hoje. (Antes
// apontava para portal-atual.anterior.sqlite, que o backup apaga logo depois
// da troca e por isso nunca existia na hora de restaurar.)
// --data escolhe um dia especifico do historico.
// --sim dispensa a confirmacao digitada, para quem chama pela central.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

import { portalPrivado } from './configuracao.mjs';
import { listarHistorico, nomeDoDia } from './retencao-backup.mjs';

const pastaBanco = path.join(portalPrivado, 'banco', 'estado', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
const pastaBackup = path.join(portalPrivado, 'backups');
const anterior = process.argv.includes('--anterior');
const semPergunta = process.argv.includes('--sim');
const posicaoData = process.argv.indexOf('--data');
const dataPedida = posicaoData > 0 ? String(process.argv[posicaoData + 1] || '') : '';

function escolherOrigem() {
  if (dataPedida) {
    const item = listarHistorico(pastaBackup).find((entrada) => entrada.dia === dataPedida);
    if (!item) throw new Error(`Nao ha backup de ${dataPedida} no historico. Disponiveis: ${listarHistorico(pastaBackup).map((entrada) => entrada.dia).join(', ') || 'nenhum'}.`);
    return item.arquivo;
  }
  if (anterior) {
    const hoje = nomeDoDia();
    const item = listarHistorico(pastaBackup).find((entrada) => entrada.dia < hoje);
    if (!item) throw new Error('Ainda nao ha backup de um dia anterior no historico.');
    return item.arquivo;
  }
  return path.join(pastaBackup, 'portal-atual.sqlite');
}
const origem = escolherOrigem();

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

// O PID do supervisor nao basta: o Portal pode ter sido iniciado a mao ou o
// arquivo pode estar ausente ou velho. Se algo responde na porta do Portal, o
// banco esta aberto por alguem, e a restauracao nao pode seguir.
function portalRespondendo(porta = 3000) {
  return new Promise((resolve) => {
    const conexao = net.connect({ host: '127.0.0.1', port: porta });
    const fim = (resposta) => { conexao.destroy(); resolve(resposta); };
    conexao.setTimeout(1500, () => fim(false));
    conexao.once('connect', () => fim(true));
    conexao.once('error', () => fim(false));
  });
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
if (operacaoNoAr() || await portalRespondendo()) throw new Error('A operacao esta no ar (supervisor ativo ou Portal respondendo na porta 3000). Pare a operacao antes de restaurar.');

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

// O backup e copiado ao lado do banco e conferido ali; so entao troca de
// lugar com o banco, num rename. Copiar direto por cima deixava o banco pela
// metade se a energia caisse durante a copia.
const restaurando = `${alvo}.restaurando`;
fs.rmSync(restaurando, { force: true });
fs.copyFileSync(origem, restaurando);
const totaisRestaurado = resumir(restaurando);
console.log(`Restaurado: ${JSON.stringify(totaisRestaurado)}`);
if (JSON.stringify(totaisRestaurado) !== JSON.stringify(totaisBackup)) {
  fs.rmSync(restaurando, { force: true });
  throw new Error('A copia do backup nao confere com o original. O banco atual nao foi alterado.');
}
// -wal e -shm carregam transacoes do banco antigo; deixa-los ao lado do
// arquivo novo corrompe a base restaurada.
for (const sufixo of ['-wal', '-shm']) fs.rmSync(alvo + sufixo, { force: true });
fs.renameSync(restaurando, alvo);
console.log('\nRestauracao concluida. Inicie a operacao novamente.');
