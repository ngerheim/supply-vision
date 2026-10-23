import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { destinoBanco } from '../scripts/banco-local.mjs';

export const SENTINELA = '.supply-vision-demonstracao.json';
export const APP_ID = 0x5356444d;
const raizPadrao = path.resolve(import.meta.dirname, '../..');
export const bancoDemo = pasta => destinoBanco('portal.sqlite', path.join(pasta, 'portal'));
const dentro = (p, raiz) => { const r = path.relative(raiz, p); return !r || (!r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r)); };

function ancestrais(pasta) {
  const lista = [];
  for (let p = pasta; ; p = path.dirname(p)) { lista.push(p); if (p === path.dirname(p)) return lista; }
}
function semLinks(pasta) {
  for (const p of ancestrais(pasta)) if (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Pasta com link/junction recusada.');
}
function caminhoFisico(pasta) {
  const existente = ancestrais(pasta).find(p => fs.existsSync(p));
  return path.resolve(fs.realpathSync.native(existente), path.relative(existente, pasta));
}
function arquivos(pasta) {
  if (!fs.existsSync(pasta)) return [];
  const lista = [];
  for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
    const p = path.join(pasta, item.name);
    if (item.isSymbolicLink()) throw new Error('Link/junction dentro da demonstracao recusado.');
    if (item.isDirectory()) lista.push(...arquivos(p)); else lista.push(p);
  }
  return lista;
}
export function validarPasta(pasta, { raiz = raizPadrao, privadoAmbiente = process.env.SUPPLY_VISION_PRIVADO, recriar = false } = {}) {
  if (!pasta || !path.isAbsolute(pasta)) throw new Error('Informe uma pasta absoluta.');
  pasta = path.resolve(pasta); raiz = fs.realpathSync(raiz);
  semLinks(pasta);
  pasta = caminhoFisico(pasta);
  for (let proibida of [raiz, path.join(raiz, 'privado'), privadoAmbiente && path.resolve(privadoAmbiente)].filter(Boolean)) {
    semLinks(proibida);
    proibida = caminhoFisico(proibida);
    if (dentro(pasta, proibida) || dentro(proibida, pasta)) throw new Error('Worktree ou pasta privada real recusada.');
  }
  for (const p of ancestrais(pasta)) {
    if (fs.existsSync(path.join(p, 'supv.cmd')) || fs.existsSync(path.join(p, 'operacao/operacao.env')) || fs.existsSync(path.join(p, 'operacao.env'))) throw new Error('Pasta de instalacao recusada.');
    if (p !== pasta && (fs.existsSync(path.join(p, 'portal.sqlite')) || fs.existsSync(bancoDemo(p)))) throw new Error('Pasta dentro de banco existente recusada.');
  }
  const lista = arquivos(pasta);
  const marcador = path.join(pasta, SENTINELA);
  let sentinela;
  if (fs.existsSync(marcador)) {
    sentinela = JSON.parse(fs.readFileSync(marcador, 'utf8'));
    if (sentinela.tipo !== 'supply-vision-demo-v1' || !path.isAbsolute(sentinela.pasta || '') || path.relative(caminhoFisico(sentinela.pasta), pasta)) throw new Error('Sentinela invalida.');
  }
  if (recriar && !sentinela) throw new Error('Recriar exige sentinela da demonstracao.');
  if (!sentinela && lista.length) throw new Error('Pasta existente sem sentinela recusada.');
  for (const arquivo of lista.filter(p => path.basename(p).toLowerCase() === 'portal.sqlite')) {
    if (!sentinela || arquivo !== bancoDemo(pasta)) throw new Error('Banco alheio recusado.');
    const db = new DatabaseSync(arquivo, { readOnly: true });
    try { if (db.prepare('PRAGMA application_id').get().application_id !== APP_ID) throw new Error('Banco nao criado pela demonstracao.'); }
    finally { db.close(); }
  }
  return { pasta, sentinela, criar: !fs.existsSync(bancoDemo(pasta)) };
}
export function prepararPasta(pasta, opcoes = {}) {
  const validada = validarPasta(pasta, opcoes);
  if (opcoes.recriar) fs.rmSync(validada.pasta, { recursive: true });
  fs.mkdirSync(validada.pasta, { recursive: true });
  // No Windows empacotado, a criacao em LocalAppData pode ser virtualizada.
  validada.pasta = caminhoFisico(validada.pasta);
  if (!validada.sentinela || opcoes.recriar) fs.writeFileSync(path.join(validada.pasta, SENTINELA), JSON.stringify({ tipo: 'supply-vision-demo-v1', pasta: validada.pasta }), { flag: 'wx' });
  return { pasta: validada.pasta, criar: opcoes.recriar || validada.criar };
}
// A API nao altera o e-mail do administrador inicial. Somente esta base nova,
// com um unico usuario, recebe o endereco reservado; senha/hash ficam intactos.
export function marcarBancoNovo(pasta, inicial) {
  const sentinela = JSON.parse(fs.readFileSync(path.join(pasta, SENTINELA), 'utf8'));
  if (sentinela.tipo !== 'supply-vision-demo-v1' || path.relative(caminhoFisico(sentinela.pasta), caminhoFisico(pasta))) throw new Error('Sentinela invalida.');
  const db = new DatabaseSync(bancoDemo(pasta));
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    if (db.prepare('SELECT COUNT(*) n FROM users').get().n !== 1 || db.prepare('PRAGMA application_id').get().application_id !== 0) throw new Error('Exige banco novo.');
    db.prepare("UPDATE users SET name=?,email=? WHERE role='admin'").run(inicial.name, inicial.email);
    db.exec(`PRAGMA application_id=${APP_ID}; COMMIT`);
  } finally { db.close(); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const executar = process.argv.includes('--validar') ? validarPasta : prepararPasta;
  console.log(JSON.stringify(executar(process.argv[2], { recriar: process.argv.includes('--recriar') })));
}
