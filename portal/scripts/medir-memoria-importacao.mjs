// Medicao limpa: gera o arquivo, salva em disco, libera memoria, e SO ENTAO
// mede a importacao. A versao anterior media a geracao junto e o numero nao
// significava nada.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raizPortal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const xlsxUrl = pathToFileURL(path.join(raizPortal, 'node_modules', 'xlsx', 'xlsx.mjs')).href;
const guardiaoUrl = pathToFileURL(path.join(raizPortal, 'lib', 'xlsx-zip-guard.ts')).href;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));

// Passo 1: gerar os arquivos num processo separado, para a memoria da geracao
// nao poluir a medicao.
const gerador = path.join(tmp, 'gerar.mjs');
fs.writeFileSync(gerador, `
import fs from 'node:fs';
import * as XLSX from '${xlsxUrl}';
const [saida, linhas, colunas] = [process.argv[2], +process.argv[3], +process.argv[4]];
const dados = [];
for (let i = 0; i < linhas; i++) {
  const l = {};
  for (let c = 0; c < colunas; c++) l['COL' + c] = \`unico-\${i}-\${c}-\${((i*2654435761)^(c*40503))>>>0}\`;
  dados.push(l);
}
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), 'Dados');
fs.writeFileSync(saida, Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true })));
`);

// Passo 2: medir a importacao, cada uma em processo proprio e limpo.
const medidor = path.join(tmp, 'medir.mjs');
fs.writeFileSync(medidor, `
import fs from 'node:fs';
import * as XLSX from '${xlsxUrl}';
import { inspecionarXlsxZip } from '${guardiaoUrl}';
const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
const base = process.memoryUsage.rss();
let pico = base;
const t = setInterval(() => { pico = Math.max(pico, process.memoryUsage.rss()); }, 5);
const r = await inspecionarXlsxZip(bytes);
let saida;
if (!r.ok) { saida = { aceita: false, erro: r.erro }; }
else {
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, sheets: 0 });
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  saida = { aceita: true, expansao: r.metricas.descomprimidoTotal, linhas: linhas.length };
}
clearInterval(t);
pico = Math.max(pico, process.memoryUsage.rss());
console.log(JSON.stringify({ ...saida, base, pico, arquivo: bytes.length }));
`);

const mb = (b) => (b / 1024 / 1024).toFixed(1);
console.log('\nCada medicao roda em processo proprio, sem a memoria da geracao.\n');
console.log('cenario                   arquivo   expansao   RSS base   pico RSS   custo    resultado');
console.log('------------------------  --------  ---------  ---------  ---------  -------  ---------');

const casos = [
  ['adversarial 2k x 30 unico', 2000, 30],
  ['adversarial 5k x 30 unico', 5000, 30],
  ['adversarial 10k x 30 unico', 10000, 30],
  ['adversarial 20k x 30 unico', 20000, 30],
];

for (const [nome, linhas, colunas] of casos) {
  const arq = path.join(tmp, `${linhas}.xlsx`);
  execFileSync(process.execPath, ['--experimental-strip-types', gerador, arq, String(linhas), String(colunas)], { stdio: 'pipe' });
  const bruto = execFileSync(process.execPath, ['--experimental-strip-types', medidor, arq], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const r = JSON.parse(bruto.trim().split('\n').pop());
  console.log(
    nome.padEnd(25),
    (mb(r.arquivo) + ' MB').padEnd(9),
    (r.aceita ? mb(r.expansao) + ' MB' : '-').padEnd(10),
    (mb(r.base) + ' MB').padEnd(10),
    (mb(r.pico) + ' MB').padEnd(10),
    (mb(r.pico - r.base) + ' MB').padEnd(8),
    r.aceita ? `aceita, ${r.linhas} linhas` : 'RECUSADA',
  );
}

// A planilha real, para comparar.
const acordos = path.resolve(raizPortal, '..', 'privado', 'portal', 'dados-origem', 'ACORDOS.xlsx');
if (!fs.existsSync(acordos)) throw new Error('Planilha real ausente: ' + acordos);
const bruto = execFileSync(process.execPath, ['--experimental-strip-types', medidor, acordos], { encoding: 'utf8', maxBuffer: 1 << 24 });
const r = JSON.parse(bruto.trim().split('\n').pop());
console.log(
  'ACORDOS.xlsx (real)'.padEnd(25),
  (mb(r.arquivo) + ' MB').padEnd(9),
  (mb(r.expansao) + ' MB').padEnd(10),
  (mb(r.base) + ' MB').padEnd(10),
  (mb(r.pico) + ' MB').padEnd(10),
  (mb(r.pico - r.base) + ' MB').padEnd(8),
  `aceita, ${r.linhas} linhas`,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
