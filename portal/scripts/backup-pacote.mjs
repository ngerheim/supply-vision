import fs from 'node:fs';
import path from 'node:path';
import { privado } from './caminhos.mjs';
import { localizarBanco } from './banco-local.mjs';
import { criarSnapshot } from './snapshot-banco.mjs';
import { executar7z, exigirNomesCriptografados, FalhaBackup } from './backup-7z.mjs';
import { hashArquivo } from './backup-rede.mjs';
import { validarBanco } from './validar-banco.mjs';

// Allowlist da antiga semente. Nao atravessa links nem inclui caches ou backups.
const pastasExcluidas = new Set(['node_modules', '.venv', '.git', '.cache', 'work', 'dist', 'logs', 'backups', 'worktrees', 'preparos']);
export function configuracaoPermitida(nome) {
  return /^(comum\/[^/]+\.env|portal\/configuracao\/[^/]+\.env|alertas\/(config|parametros)\/.+|alertas\/estado-envios\/[^/]+\.json|operacao\/estado\.json)$/.test(nome)
    && !/(?:\.log(?:\.|$)|\.(?:sqlite|7z|zip|bak|tmp)$)/i.test(nome)
    && !nome.split('/').some(p => !p || p === '.' || p === '..' || /[:\\\0]/.test(p)
      || pastasExcluidas.has(p.toLowerCase()));
}
function listarArquivos(pasta, prefixo = '', ignorarPastas = false) {
  if (!fs.existsSync(pasta)) return [];
  if (fs.lstatSync(pasta).isSymbolicLink()) throw new FalhaBackup('Link recusado no conteudo do backup.');
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap(item => {
    const nome = prefixo + item.name, arquivo = path.join(pasta, item.name);
    if (ignorarPastas && pastasExcluidas.has(item.name.toLowerCase())) return [];
    if (item.isSymbolicLink()) throw new FalhaBackup('Link recusado no conteudo do backup.');
    return item.isDirectory() ? listarArquivos(arquivo, nome + '/', ignorarPastas) : item.isFile() ? [nome] : [];
  });
}
export function listarConfiguracao(raiz = privado) {
  const pastas = ['alertas/config', 'alertas/parametros'];
  const recursivos = pastas.flatMap(pasta => listarArquivos(path.join(raiz, pasta), pasta + '/', true));
  const diretos = ['comum', 'portal/configuracao', 'alertas/estado-envios', 'operacao'].flatMap(pasta => {
    const diretorio = path.join(raiz, pasta);
    if (!fs.existsSync(diretorio)) return [];
    if (fs.lstatSync(diretorio).isSymbolicLink()) throw new FalhaBackup('Link recusado no conteudo do backup.');
    return fs.readdirSync(diretorio).map(nome => pasta + '/' + nome).filter(configuracaoPermitida).map(nome => {
      if (!fs.lstatSync(path.join(raiz, nome)).isFile() || fs.lstatSync(path.join(raiz, nome)).isSymbolicLink()) throw new FalhaBackup('Arquivo de configuracao invalido.');
      return nome;
    });
  });
  return [...recursivos, ...diretos].filter(configuracaoPermitida);
}
function validarEstado(nome, arquivo) {
  if (nome !== 'operacao/estado.json' && !nome.startsWith('alertas/estado-envios/')) return;
  const estado = JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, ''));
  if (!estado || typeof estado !== 'object' || Array.isArray(estado)) throw new FalhaBackup('Estado persistente do backup invalido.');
}
export function montarPacote(pasta, { raiz = privado, banco = localizarBanco(null, path.join(raiz, 'portal')) } = {}) {
  if (!banco) throw new FalhaBackup('Banco atual nao encontrado.');
  fs.mkdirSync(path.join(pasta, 'banco'), { recursive: true });
  criarSnapshot(banco, path.join(pasta, 'banco/portal.sqlite'));
  for (const nome of listarConfiguracao(raiz)) {
    const destino = path.join(pasta, nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(path.join(raiz, nome), destino);
    validarEstado(nome, destino);
  }
  const arquivos = Object.fromEntries(listarArquivos(pasta).map(nome => [nome, hashArquivo(path.join(pasta, nome))]));
  fs.writeFileSync(path.join(pasta, 'backup.json'), JSON.stringify({ formato: 1, bancoNome: path.basename(banco), arquivos }));
}
export function compactarPacote(pasta, arquivo, executavel, senha, { executar } = {}) {
  if (fs.existsSync(arquivo)) throw new FalhaBackup('Arquivo de backup ja existe.');
  executar7z(executavel, senha, ['a', '-t7z', '-m0=lzma2', '-mx=9', '-mhe=on', arquivo, '.'], { cwd: pasta, executar });
  exigirNomesCriptografados(executavel, arquivo, { executar });
  executar7z(executavel, senha, ['t', arquivo], { executar });
}
export function validarPacote(pasta) {
  const meta = JSON.parse(fs.readFileSync(path.join(pasta, 'backup.json'), 'utf8'));
  if (meta.formato !== 1 || typeof meta.bancoNome !== 'string' || !/^[^/\\:]+\.sqlite$/.test(meta.bancoNome) || meta.bancoNome === 'metadata.sqlite'
    || !meta.arquivos || !Object.hasOwn(meta.arquivos, 'banco/portal.sqlite')) throw new FalhaBackup('Manifesto do backup invalido.');
  for (const nome of listarArquivos(pasta)) {
    if (nome === 'backup.json') continue;
    if ((nome !== 'banco/portal.sqlite' && !configuracaoPermitida(nome)) || !Object.hasOwn(meta.arquivos, nome)) throw new FalhaBackup('Conteudo do backup invalido.');
  }
  for (const [nome, hash] of Object.entries(meta.arquivos)) {
    if ((nome !== 'banco/portal.sqlite' && !configuracaoPermitida(nome)) || !/^[a-f0-9]{64}$/.test(hash)
      || hashArquivo(path.join(pasta, nome)) !== hash) throw new FalhaBackup('Hash do conteudo do backup nao confere.');
    validarEstado(nome, path.join(pasta, nome));
  }
  validarBanco(path.join(pasta, 'banco/portal.sqlite'));
  return meta;
}
export function extrairPacote(arquivo, pasta, executavel, senha, { executar } = {}) {
  exigirNomesCriptografados(executavel, arquivo, { executar });
  executar7z(executavel, senha, ['t', arquivo], { executar });
  // Conferir nomes ANTES de extrair: um pacote adulterado nao pode sair do TEMP.
  const lista = executar7z(executavel, senha, ['l', '-slt', '-ba', arquivo], { executar });
  for (const bloco of lista.trim().split(/\r?\n\r?\n/)) {
    const nome = /^Path = (.+)$/m.exec(bloco)?.[1]?.trim().replaceAll('\\', '/');
    if (!nome || nome.startsWith('/') || nome.split('/').some(p => p === '..' || /[:\0]/.test(p))
      || /^(?:Symbolic Link|Hard Link) =/m.test(bloco) || /^Attributes = .*\bl[rw-]/m.test(bloco)) throw new FalhaBackup('Caminho inseguro no arquivo de backup.');
  }
  executar7z(executavel, senha, ['x', arquivo, `-o${pasta}`], { executar });
  return validarPacote(pasta);
}
export function exigirDestinoSeguro(nome, raiz = privado) {
  if (!configuracaoPermitida(nome)) throw new FalhaBackup('Destino de configuracao invalido.');
  const alvo = path.join(raiz, nome);
  for (let atual = alvo; atual !== path.dirname(raiz); atual = path.dirname(atual)) {
    if (fs.existsSync(atual) && fs.lstatSync(atual).isSymbolicLink()) throw new FalhaBackup('Link recusado no destino da configuracao.');
  }
  return alvo;
}

export async function comBackupDaRede(data, acao, { config, senha, executavel } = {}) {
  const { lerConfigBruta } = await import('./configuracao.mjs');
  const { localizar7zip, lerSenhaBackup } = await import('./backup-7z.mjs');
  const { listarHistorico } = await import('./retencao-backup.mjs');
  const os = await import('node:os');
  config ??= lerConfigBruta();
  if (!config.BACKUP_NETWORK_DIR?.trim()) throw new FalhaBackup('BACKUP_NETWORK_DIR nao configurado.');
  if (data && !/^\d{4}-\d{2}-\d{2}_\d{4}$/.test(data)) throw new FalhaBackup('Use --data AAAA-MM-DD_HHMM.');
  const lista = listarHistorico(config.BACKUP_NETWORK_DIR.trim());
  console.log(`Backups na rede: ${lista.map(item => path.basename(item.arquivo)).join(', ') || 'nenhum'}`);
  const item = data ? lista.find(item => item.data === data) : lista[0];
  if (!item) throw new FalhaBackup('Backup solicitado nao encontrado na rede.');
  const temp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'sv-restauracao-'));
  try {
    const meta = extrairPacote(item.arquivo, temp, executavel ?? localizar7zip(config), senha ?? lerSenhaBackup());
    return await acao(temp, meta);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
