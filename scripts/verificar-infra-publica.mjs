import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Nomes sensiveis e fixtures de testes nao sao escritos literalmente no Git.
export const padroesInfraInterna = [
  ['192', '168', ''].join('.'), ['loc', 'frotas'].join(''), ['PROGRAMA', 'SUP'].join(''),
  ['NB-', '0200'].join(''), ['automacao', 'suprimento'].join('.'),
];
// Excecoes exatas e ficticias; nao liberar dominios/hosts por sufixo generico.
export const EXEMPLOS_FICTICIOS = Object.freeze({
  dns: ['portal.empresa.local', 'portal.local', 'teste.local'],
  unc: ['servidor', 'servidor-arquivos', 'inexistente', 'rede'],
  usuarios: ['nome', 'usuario', 'ficticio', 'automacao.ficticia', 'runneradmin'],
});
const dns = new RegExp('[a-z0-9.-]*\\.' + ['lo', 'cal'].join('') + '\\b', 'gi');
const privados = new RegExp('(?<![\\w.])(?:' + '10' + '|172\\.(?:1[6-9]|2[0-9]|3[01])' + '|192\\.168)' + '(?:\\.\\d{1,3})' + '{1,3}(?![\\w.])', 'g');
const powerbi = new RegExp(['powerbi', 'com'].join('\\.') + '/view\\?r=', 'i');
const usuario = /\bC:\\{1,4}Users\\{1,4}([^\\\s"'<>]+)/gi;
const unc = /(?:^|[\s="'`])\\{2,4}([a-z0-9._-]+)\\{1,4}([a-z0-9_$.-]+)/gi;
export function contemInfra(texto) {
  const lower = texto.toLowerCase();
  if (padroesInfraInterna.some(p => lower.includes(p.toLowerCase())) || powerbi.test(texto)) return true;
  // Enderecos completos; numeros decimais/versoes nao sao enderecos IP.
  for (const m of texto.matchAll(privados)) {
    const octetos = m[0].split('.');
    if (octetos.length === 4 && octetos.every(n => Number(n) <= 255)) return true;
  }
  for (const m of texto.matchAll(dns)) if (!EXEMPLOS_FICTICIOS.dns.includes(m[0].toLowerCase())) return true;
  for (const m of texto.matchAll(usuario)) if (!EXEMPLOS_FICTICIOS.usuarios.includes(m[1].toLowerCase())) return true;
  for (const m of texto.matchAll(unc)) if (!EXEMPLOS_FICTICIOS.unc.includes(m[1].toLowerCase())) return true;
  return false;
}
function git(raiz, argumentos) {
  const r = spawnSync('git', argumentos, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Nao foi possivel conferir os arquivos versionados com Git.');
  return r.stdout;
}
export function lockfileSeguro(texto) {
  let lock;
  try { lock = JSON.parse(texto); } catch { return false; }
  if (!lock || ![2, 3].includes(lock.lockfileVersion) || !lock.packages) return false;
  function conferir(valor, chave = '') {
    if (typeof valor === 'string') {
      if (chave === 'integrity') return /^(?:sha(?:256|384|512)-[A-Za-z0-9+/=]+)(?:\s+sha(?:256|384|512)-[A-Za-z0-9+/=]+)*$/.test(valor);
      return !contemInfra(valor);
    }
    if (valor && typeof valor === 'object') return Object.entries(valor).every(([k, v]) => !contemInfra(k) && conferir(v, k));
    return true;
  }
  return conferir(lock);
}
export function arquivosComInfraInterna(raiz) {
  const arquivos = git(raiz, ['ls-files', '-z']).split('\0').filter(Boolean);
  return arquivos.filter(nome => {
    const conteudo = fs.readFileSync(path.join(raiz, nome)).toString('utf8');
    return path.basename(nome) === 'package-lock.json' ? !lockfileSeguro(conteudo) : contemInfra(conteudo);
  });
}
export function commitsComInfraInterna(raiz, base) {
  if (!/^[a-f0-9]{40}$/i.test(base)) throw new Error('Base dos commits deve ser SHA completo.');
  const patch = git(raiz, ['log', '-p', '--format=commit %H%n%B', '--no-ext-diff', '--no-textconv', `${base}..HEAD`]);
  // Analisa adicoes, remocoes, contexto e mensagens; nao imprime dados encontrados.
  return contemInfra(patch);
}
export const HASH_XLSX = '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8';
export function conferirXlsx(arquivo, oficial) {
  const dados = fs.readFileSync(arquivo);
  const hash = createHash('sha256').update(dados).digest('hex');
  if (hash !== HASH_XLSX) throw new Error('Pacote SheetJS diverge do hash fixado.');
  if (oficial && createHash('sha256').update(fs.readFileSync(oficial)).digest('hex') !== hash) throw new Error('Pacote SheetJS diverge do pacote oficial.');
  return hash;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const raiz = path.resolve(import.meta.dirname, '..');
    const encontrados = arquivosComInfraInterna(raiz);
    const base = process.env.SV_BASE_SHA;
    if (base && commitsComInfraInterna(raiz, base)) encontrados.push('[commits novos]');
    conferirXlsx(path.join(raiz, 'portal/vendor/xlsx-0.20.3.tgz'), process.env.SV_XLSX_OFICIAL);
    if (encontrados.length) {
      console.error('Dados de infraestrutura interna ou lockfile invalido:');
      for (const nome of encontrados) console.error(nome);
      process.exitCode = 1;
    } else console.log('Infraestrutura publica e integridade SheetJS: aprovadas.');
  } catch { console.error('Verificacao publica/integridade nao concluida; consulte arquivos e base Git.'); process.exitCode = 1; }
}
