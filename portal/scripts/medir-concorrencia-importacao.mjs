// Mede duas importacoes SIMULTANEAS no mesmo processo.
//
// Uma importacao sozinha custou ~100 MB de RSS. Se duas rodarem em paralelo,
// o teto por requisicao nao limita o processo: ele limita cada uma.
//
// Os arquivos sao gerados num processo separado e lidos do disco, para a
// memoria da geracao nao contaminar a medicao.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raizPortal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const xlsxUrl = pathToFileURL(path.join(raizPortal, 'node_modules', 'xlsx', 'xlsx.mjs')).href;
const guardiaoUrl = pathToFileURL(path.join(raizPortal, 'lib', 'xlsx-zip-guard.ts')).href;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conc-'));
const mb = (b) => (b / 1024 / 1024).toFixed(1);

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

const medidor = path.join(tmp, 'medir.mjs');
fs.writeFileSync(medidor, `
import fs from 'node:fs';
import * as XLSX from '${xlsxUrl}';
import { inspecionarXlsxZip } from '${guardiaoUrl}';

const arquivos = process.argv.slice(3);
const quantas = +process.argv[2];
const buffers = arquivos.map((a) => new Uint8Array(fs.readFileSync(a)));

const base = process.memoryUsage.rss();
let pico = base;
const t = setInterval(() => { pico = Math.max(pico, process.memoryUsage.rss()); }, 5);

async function importar(bytes) {
  const r = await inspecionarXlsxZip(bytes);
  if (!r.ok) return { aceita: false };
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, sheets: 0 });
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  return { aceita: true, linhas: linhas.length };
}

const inicio = Date.now();
const resultados = quantas === 1
  ? [await importar(buffers[0])]
  : await Promise.all(buffers.slice(0, quantas).map(importar));
const ms = Date.now() - inicio;

clearInterval(t);
pico = Math.max(pico, process.memoryUsage.rss());
console.log(JSON.stringify({ base, pico, ms, aceitas: resultados.filter((r) => r.aceita).length }));
`);

console.log('\nCusto de memoria com importacoes simultaneas');
console.log('Cada linha roda em processo proprio e limpo.\n');
console.log('cenario                RSS base   pico RSS   custo      tempo    aceitas');
console.log('---------------------  ---------  ---------  ---------  -------  -------');

// Arquivo que passa pelo guardiao com folga (5 mil linhas -> ~8 MB de expansao).
const arqs = [];
for (let i = 0; i < 3; i++) {
  const a = path.join(tmp, `p${i}.xlsx`);
  execFileSync(process.execPath, ['--experimental-strip-types', gerador, a, '5000', '30'], { stdio: 'pipe' });
  arqs.push(a);
}

for (const [nome, quantas] of [['1 importacao', 1], ['2 simultaneas', 2], ['3 simultaneas', 3]]) {
  const bruto = execFileSync(
    process.execPath,
    ['--experimental-strip-types', medidor, String(quantas), ...arqs],
    { encoding: 'utf8', maxBuffer: 1 << 24 },
  );
  const r = JSON.parse(bruto.trim().split('\n').pop());
  console.log(
    nome.padEnd(22),
    (mb(r.base) + ' MB').padEnd(10),
    (mb(r.pico) + ' MB').padEnd(10),
    (mb(r.pico - r.base) + ' MB').padEnd(10),
    (r.ms + ' ms').padEnd(8),
    r.aceitas,
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
