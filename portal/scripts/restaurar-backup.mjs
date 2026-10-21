import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { portasOperacao } from './portas-operacao.mjs';
import { lerConfigEfetiva, lerArquivo } from './configuracao.mjs';
import { privado, portalPrivado } from './caminhos.mjs';
import { validarBanco } from './validar-banco.mjs';
import { criarSnapshot } from './snapshot-banco.mjs';
import { prepararRestauracao } from './restauracao-segura.mjs';
import { localizarBanco, destinoBanco } from './banco-local.mjs';
import { travarRestauracao } from './trava-restauracao.mjs';
import { comBackupExclusivo } from './backup-exclusivo.mjs';
import { comBackupDaRede, exigirDestinoSeguro, configuracaoPermitida, listarConfiguracao } from './backup-pacote.mjs';
import { listarHistorico } from './retencao-backup.mjs';
import { FalhaBackup } from './backup-7z.mjs';

function portalRespondendo(porta) {
  return new Promise(resolve => {
    const conexao = net.connect({ host: '127.0.0.1', port: porta });
    const fim = resposta => { conexao.destroy(); resolve(resposta); };
    conexao.setTimeout(1500, () => fim(false));
    conexao.once('connect', () => fim(true)); conexao.once('error', () => fim(false));
  });
}
export async function exigirOperacaoParada(raiz = privado, config = lerConfigEfetiva()) {
  const lock = path.join(raiz, 'operacao/supervisor.lock');
  if (fs.existsSync(lock)) {
    try { const fd = fs.openSync(lock, 'r+'); fs.closeSync(fd); }
    catch { throw new FalhaBackup('Pare a operacao antes de restaurar.'); }
  }
  const pid = path.join(raiz, 'operacao/supervisor.pid.json');
  let numero;
  if (fs.existsSync(pid)) {
    try { numero = JSON.parse(fs.readFileSync(pid, 'utf8').replace(/^\uFEFF/, '')).pid; }
    catch { throw new FalhaBackup('Registro do supervisor ilegivel; confirme a parada antes de restaurar.'); }
    if (numero) {
      let ativo = false;
      try { process.kill(numero, 0); ativo = true; } catch (erro) { ativo = erro.code !== 'ESRCH'; }
      if (ativo) throw new FalhaBackup('Pare a operacao antes de restaurar.');
    }
  }
  const portas = portasOperacao(config);
  if (await portalRespondendo(portas.portal) || await portalRespondendo(portas.relatorios)) throw new FalhaBackup('Portal ou relatorios no ar; pare a operacao antes de restaurar.');
}
export async function restaurarCopia(origem, { raiz = privado, configuracao = false, pasta, meta } = {}) {
  const portal = path.join(raiz, 'portal'), backups = path.join(portal, 'backups');
  await exigirOperacaoParada(raiz, lerArquivo(path.join(raiz, 'portal/configuracao/portal.env')));
  return comBackupExclusivo(backups, async () => {
    const liberar = travarRestauracao(true, portal);
    let restaurando, guardado, concluida = false, preservarRecuperacao = false;
    try {
      const existente = localizarBanco(null, portal);
      const alvo = existente || destinoBanco(meta?.bancoNome || 'portal.sqlite', portal);
      validarBanco(origem);
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      restaurando = `${alvo}.restaurando`;
      const { marcados } = prepararRestauracao(origem, restaurando, validarBanco);
      const nomes = configuracao ? [...new Set([...Object.keys(meta.arquivos).filter(configuracaoPermitida), ...listarConfiguracao(raiz)])] : [];
      // Validar todos os alvos antes de preservar ou escrever qualquer configuracao.
      const alvos = nomes.map(nome => ({ nome, alvo: exigirDestinoSeguro(nome, raiz), presente: Object.hasOwn(meta.arquivos, nome) }));
      const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
      guardado = path.join(backups, `pre-restauracao-${carimbo}`);
      fs.mkdirSync(guardado);
      if (existente) criarSnapshot(existente, path.join(guardado, 'banco.sqlite'));
      const anteriores = [];
      for (const item of alvos) {
        const existe = fs.existsSync(item.alvo);
        if (existe) {
          const copia = path.join(guardado, 'configuracao', item.nome);
          fs.mkdirSync(path.dirname(copia), { recursive: true }); fs.copyFileSync(item.alvo, copia);
        }
        anteriores.push({ ...item, existe });
      }
      fs.writeFileSync(path.join(guardado, 'configuracao.json'), JSON.stringify(anteriores.map(({ nome, existe }) => ({ nome, existe }))));
      const escritos = [];
      try {
        for (const item of alvos) {
          escritos.push(item);
          if (!item.presente) { fs.rmSync(item.alvo, { force: true }); continue; }
          fs.mkdirSync(path.dirname(item.alvo), { recursive: true });
          fs.copyFileSync(path.join(pasta, item.nome), `${item.alvo}.restaurando`);
          fs.renameSync(`${item.alvo}.restaurando`, item.alvo);
        }
        for (const sufixo of ['-wal', '-shm']) fs.rmSync(alvo + sufixo, { force: true });
        fs.renameSync(restaurando, alvo);
      } catch {
        // A troca pode falhar apos remover WAL/SHM; o snapshot consistente
        // anterior precisa sobreviver mesmo se a configuracao for recuperada.
        preservarRecuperacao = true;
        try {
          for (const item of escritos.reverse()) {
            fs.rmSync(`${item.alvo}.restaurando`, { force: true });
            if (anteriores.find(a => a.nome === item.nome).existe) fs.copyFileSync(path.join(guardado, 'configuracao', item.nome), item.alvo);
            else fs.rmSync(item.alvo, { force: true });
          }
        } catch {
          throw new FalhaBackup('Restauracao e recuperacao da configuracao falharam; copia pre-restauracao preservada para revisao.');
        }
        throw new FalhaBackup('Restauracao nao concluida; copia pre-restauracao preservada. Confira o banco e esta copia antes de iniciar a operacao.');
      }
      concluida = true;
      // Somente depois do compromisso, manter UMA protecao local.
      try {
        for (const nome of fs.readdirSync(backups)) {
          if (/^pre-restauracao-\d{4}-\d{2}-\d{2}T[\dTZ-]+(?:\.sqlite)?$/.test(nome) && nome !== path.basename(guardado))
            fs.rmSync(path.join(backups, nome), { recursive: true, force: true });
        }
      } catch { console.warn('AVISO: restaurado; limpeza da protecao anterior pendente.'); }
      console.log(`Restauracao concluida; ${marcados} entregas neutralizadas. Inicie a operacao novamente.`);
      return guardado;
    } finally {
      try {
        if (restaurando) fs.rmSync(restaurando, { force: true });
        if (guardado && !concluida && !preservarRecuperacao) fs.rmSync(guardado, { recursive: true, force: true });
      } finally { liberar(); }
    }
  });
}
export async function executarRestauracao(args = process.argv.slice(2)) {
  let data = args.includes('--data') ? args[args.indexOf('--data') + 1] : undefined;
  if (args.includes('--data') && !data) throw new FalhaBackup('Use --data AAAA-MM-DD_HHMM.');
  if (args.includes('--listar') || args.includes('--anterior')) {
    const config = lerConfigEfetiva();
    if (!config.BACKUP_NETWORK_DIR?.trim()) throw new FalhaBackup('BACKUP_NETWORK_DIR nao configurado.');
    const lista = listarHistorico(config.BACKUP_NETWORK_DIR.trim());
    console.log(lista.map(item => path.basename(item.arquivo)).join('\n') || 'Nenhum backup na rede.');
    if (args.includes('--listar')) return;
    if (!lista[1]) throw new FalhaBackup('Backup anterior nao encontrado.');
    data = lista[1].data;
  }
  await exigirOperacaoParada();
  if (!args.includes('--sim')) {
    const io = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { if ((await io.question('Digite RESTAURAR para substituir o banco: ')) !== 'RESTAURAR') throw new FalhaBackup('Restauracao cancelada.'); }
    finally { io.close(); }
  }
  // Apenas o atualizador usa o snapshot local; restauracao humana usa a rede.
  if (args.includes('--pre-atualizacao')) return restaurarCopia(path.join(portalPrivado, 'backups/pre-atualizacao.sqlite'));
  return comBackupDaRede(data, (pasta, meta) => restaurarCopia(path.join(pasta, 'banco/portal.sqlite'), {
    configuracao: args.includes('--configuracao'), pasta, meta,
  }));
}
export function mensagemErroRestauracao(erro, config) {
  if (!config) { try { config = lerConfigEfetiva(); } catch { config = process.env; } }
  // Erros nativos podem carregar comando, argumentos e stdout/stderr secretos.
  const nativo = erro && typeof erro === 'object' && ('stdout' in erro || 'stderr' in erro || 'spawnargs' in erro);
  const codigo = /^[A-Z][A-Z0-9_]{1,63}$/.test(erro?.code) ? `${erro.code}: ` : '';
  let motivo = nativo ? `processo auxiliar falhou (codigo ${Number.isInteger(erro.status) ? erro.status : 'indisponivel'})`
    : `${codigo}${erro instanceof Error ? erro.message : 'falha desconhecida'}`;
  for (const [chave, valor] of Object.entries({...process.env, ...config})) {
    if (/TOKEN|PASSWORD|SENHA|SECRET|SMTP_USER/i.test(chave) && typeof valor === 'string' && valor) motivo = motivo.split(valor).join('[MASCARADO]');
  }
  motivo = motivo.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[MASCARADO]@')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [MASCARADO]')
    .replace(/\b(password|senha|token|secret|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[MASCARADO]')
    .replace(/\p{Cc}+/gu, ' ').slice(0, 600);
  return erro instanceof FalhaBackup ? motivo : `Restauracao falhou: ${motivo}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await executarRestauracao(); }
  catch (erro) { console.error(mensagemErroRestauracao(erro)); process.exitCode = 1; }
}
