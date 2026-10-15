import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Excecoes exatas e ficticias; nao liberar dominios/hosts por sufixo generico.
export const EXEMPLOS_FICTICIOS = Object.freeze({
  dns: ['portal.empresa.local', 'portal.local', 'teste.local'],
  unc: ['servidor', 'servidor-arquivos', 'inexistente', 'rede'],
  usuarios: ['nome', 'usuario', 'ficticio', 'automacao.ficticia', 'runneradmin'],
});
const dns = /\b[a-z0-9.-]+\.local\b/gi;
const ipv4 = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g;
const powerbi = /powerbi\.com\/view\?r=/i;
const usuario = /\bC:\\{1,4}Users\\{1,4}([^\\\s"'<>]+)/gi;
const unc = /(?:^|[\s="'`])\\{2,4}([a-z0-9._-]+)\\{1,4}([a-z0-9_$.-]+)/gi;
const maquina = /\b[a-z]{2}-\d{4}\b/i;
// Delimitadores evitam confundir chamadas/propriedades JS com uma conta literal.
const conta = /(?:^|[\s="'`\\])([a-z][a-z0-9_-]+\.[a-z][a-z0-9_-]+)(?=$|[\s"'`,;\\])/gi;
const extensoes = new Set(['md', 'mjs', 'cjs', 'js', 'ts', 'tsx', 'py', 'ps1', 'bat', 'cmd', 'json', 'jsonl', 'env', 'example', 'txt', 'csv', 'sqlite', 'db', 'log', 'yml', 'yaml', 'toml', 'tgz', 'zip', 'png', 'svg', 'html', 'css', 'exe', 'dll', 'ini', 'xml', 'config', 'sample', 'lock', 'lockb', 'sinal', 'dev', 'com', 'org', 'net', 'io', 'br', 'pkl', 'parquet', 'xlsx', 'eml', 'commit', 'bak', 'backup', 'source', 'pid', 'psd1', 'jsonc', 'tsbuildinfo', 'mts', 'cts']);
export function arquivoFicticio(nome) {
  // So os caminhos versionados de teste/exemplo: um arquivo arbitrario nao pode
  // se declarar fixture pelo conteudo ou desativar as outras guardas.
  return /(?:^|\/)(?:tests|testes|privado\.exemplo)\//.test(nome)
    || /(?:^|\/)(?:testar-|teste-|test_)/.test(nome)
    || /(?:\.exemplo(?:\.|$)|\.example$)/.test(path.basename(nome));
}
export function contemInfra(texto, { arquivo = '', termos = [] } = {}) {
  const lower = texto.toLowerCase();
  if (termos.some(termo => lower.includes(termo.toLowerCase())) || powerbi.test(texto)) return true;
  for (const m of texto.matchAll(ipv4)) {
    const [a, b, c, d] = m[0].split('.').map(Number);
    if ([a, b, c, d].some(n => n > 255)) continue;
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
  }
  for (const m of texto.matchAll(dns)) if (!EXEMPLOS_FICTICIOS.dns.includes(m[0].toLowerCase())) return true;
  for (const m of texto.matchAll(usuario)) if (!EXEMPLOS_FICTICIOS.usuarios.includes(m[1].toLowerCase())) return true;
  for (const m of texto.matchAll(unc)) if (!EXEMPLOS_FICTICIOS.unc.includes(m[1].toLowerCase())) return true;
  if (!arquivoFicticio(arquivo)) {
    if (maquina.test(texto)) return true;
    // Propriedades, colunas SQL e nomes de arquivos tambem contem ponto.
    // Em codigo/configuracao, exigir contexto de conta ou um valor isolado;
    // isso evita tratar objeto.campo ou uma expressao do GitHub como usuario.
    const fonte = /\.(?:[cm]?[jt]sx?|py|ps1)$/.test(arquivo);
    for (const linha of texto.split('\n')) {
      const contexto = /\b(?:conta|usuario|username|user_name|taskuser|account|login|runas|owner)\b/i.test(linha);
      const valorIsolado = /^[\s"'`]*[a-z][a-z0-9_-]+\.[a-z][a-z0-9_-]+[\s"'`]*$/i.test(linha);
      if (!contexto && !valorIsolado && /\.(?:ya?ml|json)$/.test(arquivo)) continue;
      const valores = fonte && !valorIsolado
        ? [...linha.matchAll(/(["'`])([a-z][a-z0-9_-]+\.[a-z][a-z0-9_-]+)\1/gi)].map(m => m[2]).join('\n')
        : linha.replace(/\$\{\{.*?\}\}/g, '');
      for (const m of valores.matchAll(conta)) {
        if (!contexto && (/[a-z][A-Z]|_/.test(m[1]) || (fonte && (m[1].split('.')[0].length <= 2 || /[A-Z]/.test(m[1]) || m[1].startsWith('vnd.'))))) continue;
        if (!extensoes.has(m[1].split('.').at(-1).toLowerCase()) && !EXEMPLOS_FICTICIOS.usuarios.includes(m[1].toLowerCase()) && !EXEMPLOS_FICTICIOS.dns.includes(m[1].toLowerCase())) return true;
      }
    }
  }
  return false;
}
export function lerTermosProibidos(raiz) {
  const arquivo = path.join(raiz, 'privado/termos-proibidos.txt');
  try {
    return fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
      .map(linha => linha.trim()).filter(linha => linha && !linha.startsWith('#'));
  } catch (erro) {
    if (erro.code === 'ENOENT') return [];
    throw erro;
  }
}
function git(raiz, argumentos) {
  const r = spawnSync('git', argumentos, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Nao foi possivel conferir os arquivos versionados com Git.');
  return r.stdout;
}
export function lockfileSeguro(texto, opcoes = {}) {
  let lock;
  try { lock = JSON.parse(texto); } catch { return false; }
  if (!lock || ![2, 3].includes(lock.lockfileVersion) || !lock.packages) return false;
  function conferir(valor, chave = '') {
    if (typeof valor === 'string') {
      if (chave === 'integrity') return /^(?:sha(?:256|384|512)-[A-Za-z0-9+/=]+)(?:\s+sha(?:256|384|512)-[A-Za-z0-9+/=]+)*$/.test(valor);
      return !contemInfra(valor, opcoes);
    }
    if (valor && typeof valor === 'object') return Object.entries(valor).every(([k, v]) => !contemInfra(k, opcoes) && conferir(v, k));
    return true;
  }
  return conferir(lock);
}
function exigirRaizGit(raiz) {
  const topo = git(raiz, ['rev-parse', '--show-toplevel']).trim();
  if (fs.realpathSync.native(topo) !== fs.realpathSync.native(raiz)) throw new Error('Nao foi possivel conferir: a pasta pertence a outro repositorio ancestral.');
}
export function arquivosComInfraInterna(raiz) {
  exigirRaizGit(raiz);
  const termos = lerTermosProibidos(raiz);
  const arquivos = git(raiz, ['ls-files', '-z']).split('\0').filter(Boolean);
  return arquivos.filter(nome => {
    const conteudo = fs.readFileSync(path.join(raiz, nome)).toString('utf8');
    const opcoes = { arquivo: nome, termos };
    return path.basename(nome) === 'package-lock.json' ? !lockfileSeguro(conteudo, opcoes) : contemInfra(conteudo, opcoes);
  });
}
export function commitsComInfraInterna(raiz, base) {
  if (!/^[a-f0-9]{40}$/i.test(base)) throw new Error('Base dos commits deve ser SHA completo.');
  exigirRaizGit(raiz);
  const patch = git(raiz, ['log', '-p', '--format=mensagem %s%n%b', '--no-ext-diff', '--no-textconv', '--unified=0', `${base}..HEAD`]);
  const termos = lerTermosProibidos(raiz);
  let arquivo = '';
  for (const linha of patch.split('\n')) {
    if (linha.startsWith('diff --git ')) arquivo = '';
    else if (linha.startsWith('+++ b/')) arquivo = linha.slice(6);
    // Remocoes nao podem impedir a limpeza de um identificador ja publicado.
    // Adicoes de commits intermediarios continuam verificadas mesmo se revertidas.
    else if (linha.startsWith('+') && !linha.startsWith('+++') && contemInfra(linha.slice(1), { arquivo, termos })) return true;
    else if (linha.startsWith('mensagem ') && contemInfra(linha.slice(9), { termos })) return true;
  }
  return false;
}
// SheetJS 0.20.3: copia oficial integra de
// https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz (Apache-2.0 no pacote).
// O hash fixa a procedencia; CI compara tambem com o download oficial. npm ci
// usa o tarball local. Dependabot nao acompanha sua versao: revisar pacote,
// licenca, lockfile e testes de importacao explicitamente ao atualizar.
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
