import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fork, spawn } from 'node:child_process';
import { setTimeout as esperar } from 'node:timers/promises';
import { modoEnsaio } from './modo-ensaio.mjs';
import { comBackupExclusivo } from './backup-exclusivo.mjs';
import { criarTransportador, lerConfigBruta, lerArquivo, privado, portalPrivado } from './configuracao.mjs';
import { localizarBanco } from './banco-local.mjs';
import { criarSnapshot } from './snapshot-banco.mjs';
import { nomeBackup, removerHistoricoLocal } from './retencao-backup.mjs';
import { montarPacote, compactarPacote } from './backup-pacote.mjs';
import { localizar7zip, lerSenhaBackup, FalhaBackup } from './backup-7z.mjs';
import { enviarAvisoAdmin } from './aviso-admin.mjs';
export { hashArquivo } from './backup-rede.mjs';

export function criarCopiaIntegra(origem, destino = path.join(portalPrivado, 'backups/pre-atualizacao.sqlite')) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.tmp`;
  fs.rmSync(temporario, { force: true });
  criarSnapshot(origem, temporario);
  try { fs.renameSync(temporario, destino); }
  finally { fs.rmSync(temporario, { force: true }); }
  return destino;
}
export function prazoRedeMs(config) {
  const segundos = Number(config.BACKUP_NETWORK_TIMEOUT_SECONDS?.trim() || '60');
  if (!Number.isInteger(segundos) || segundos < 1 || segundos > 600)
    throw new FalhaBackup('BACKUP_NETWORK_TIMEOUT_SECONDS deve ser inteiro entre 1 e 600.');
  return segundos * 1000;
}
function encerrarArvore(filho) {
  if (process.platform === 'win32') {
    const matar = spawn('taskkill.exe', ['/PID', String(filho.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    matar.on('error', () => filho.kill('SIGKILL'));
    matar.once('exit', codigo => { if (codigo !== 0) filho.kill('SIGKILL'); });
  } else filho.kill('SIGKILL');
}
export async function replicarNaRede(config, { origem, executavel, senha, prazoMs = prazoRedeMs(config), registrar = console.warn,
  iniciar = () => fork(new URL('./backup-rede.mjs', import.meta.url), [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }),
} = {}) {
  if (!config.BACKUP_NETWORK_DIR?.trim()) throw new FalhaBackup('BACKUP_NETWORK_DIR nao configurado.');
  return new Promise((resolve, reject) => {
    const filho = iniciar();
    let resposta, excedeu = false;
    const timer = setTimeout(() => { excedeu = true; encerrarArvore(filho); }, prazoMs);
    filho.once('error', () => { clearTimeout(timer); reject(new FalhaBackup('Processo de backup em rede falhou.')); });
    filho.on('message', valor => { if (typeof valor?.aviso === 'string') registrar(valor.aviso); else resposta = valor; });
    filho.once('exit', codigo => {
      clearTimeout(timer);
      if (excedeu) reject(new FalhaBackup('Prazo da tentativa de backup em rede excedido; processo encerrado.'));
      else if (codigo !== 0 || !resposta?.ok) reject(new FalhaBackup(resposta?.erro || 'Processo de backup em rede falhou.'));
      else resolve(resposta.arquivo);
    });
    filho.send({ origem, pastaRede: config.BACKUP_NETWORK_DIR.trim(), executavel, senha });
  });
}
export async function tentarRede(rede, { agora = Date.now, aguardar = esperar, intervaloMs = 600000, janelaMs = 3600000, registrar = console.warn } = {}) {
  const inicio = agora();
  while (agora() - inicio < janelaMs) {
    const tentativa = agora();
    try { return await rede(Math.min(janelaMs - (agora() - inicio), intervaloMs)); }
    catch { registrar('AVISO: backup de rede falhou; nova tentativa em 10 minutos, por ate 1 hora.'); }
    const proxima = Math.min(tentativa + intervaloMs, inicio + janelaMs);
    await aguardar(Math.max(0, proxima - agora()));
  }
  return null;
}
export function limiteAnexo(config) {
  const mb = Number(config.BACKUP_EMAIL_MAX_MB?.trim() || '15');
  if (!Number.isFinite(mb) || mb <= 0 || mb > 100) throw new FalhaBackup('BACKUP_EMAIL_MAX_MB deve estar entre 0 e 100 MB.');
  return mb * 1024 * 1024;
}
export async function enviarEmergencia(config, arquivo, { criarTransporte = criarTransportador, registrar = console.warn } = {}) {
  const to = config.BACKUP_EMAIL_TO?.trim() || config.ADMIN_ALERTA_EMAIL?.trim();
  if (!to) throw new FalhaBackup('Destinatario de emergencia ausente: configure BACKUP_EMAIL_TO ou ADMIN_ALERTA_EMAIL.');
  const anexar = fs.statSync(arquivo).size <= limiteAnexo(config);
  const transporte = criarTransporte(config);
  let timer;
  try {
    await Promise.race([
      transporte.sendMail({ from: { name: config.EMAIL_FROM_NAME, address: config.SMTP_USER }, to,
        subject: '[Supply Vision] Falha no backup de rede',
        text: 'A pasta de rede falhou durante 1 hora. ' + (anexar
          ? 'O MESMO arquivo 7z criptografado segue em anexo. Confira a rede com a TI.'
          : 'O arquivo excede BACKUP_EMAIL_MAX_MB; somente este alerta foi enviado. Nao ha nova copia na rede. Confira com a TI.'),
        attachments: anexar ? [{ filename: path.basename(arquivo), path: arquivo, contentType: 'application/x-7z-compressed' }] : [],
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new FalhaBackup('Prazo do e-mail de emergencia excedido.')), 55000); }),
    ]);
  } catch { throw new FalhaBackup('E-mail de emergencia falhou; administrador deve verificar SMTP e rede.'); }
  finally { clearTimeout(timer); transporte.close(); }
  registrar(anexar ? 'AVISO: rede falhou; arquivo 7z enviado por e-mail de emergencia.' : 'ALERTA: arquivo acima do limite; somente alerta enviado por e-mail.');
}
function registrarBackup(mensagem) {
  console.warn(mensagem);
  try {
    const pasta = path.join(portalPrivado, 'logs');
    fs.mkdirSync(pasta, { recursive: true });
    fs.appendFileSync(path.join(pasta, 'backup.log'), `${new Date().toISOString()} ${mensagem}\n`);
  } catch { console.warn('AVISO: registro de backup indisponivel.'); }
}
function configBackup() {
  return { ...lerConfigBruta(), ...lerArquivo(path.join(privado, 'comum/operacao.env')) };
}
export async function executarBackup({ somenteLocal = false, ensaio = modoEnsaio(), config = configBackup(),
  copiar = () => criarCopiaIntegra(localizarBanco()), senha = lerSenhaBackup, zip = localizar7zip,
  preparar = montarPacote, compactar = compactarPacote, rede = replicarNaRede, retentar = tentarRede,
  email = enviarEmergencia, avisar = enviarAvisoAdmin, registrar = registrarBackup,
} = {}) {
  if (somenteLocal) { copiar(); return 0; }
  const temp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'sv-backup-'));
  const pasta = path.join(temp, 'conteudo');
  const alertar = async detalhe => {
    try { await avisar('backup-falhou', { destinatarios: config.ADMIN_ALERTA_EMAIL || config.BACKUP_EMAIL_TO, ensaio, detalhe }); }
    catch { registrar('ALERTA: falha ao avisar administrador; confira SMTP e o backup de rede.'); }
  };
  try {
    fs.mkdirSync(pasta);
    // Ensaio valida somente a copia descartavel e nunca le senha nem acessa rede.
    if (ensaio) { preparar(pasta); console.log('ensaio: envio suprimido; copia descartavel validada, rede bloqueada.'); return 0; }
    const segredo = senha(), executavel = zip(config);
    limiteAnexo(config); prazoRedeMs(config);
    if (!config.BACKUP_NETWORK_DIR?.trim()) throw new FalhaBackup('BACKUP_NETWORK_DIR nao configurado.');
    preparar(pasta);
    const arquivo = path.join(temp, nomeBackup());
    compactar(pasta, arquivo, executavel, segredo);
    fs.rmSync(pasta, { recursive: true, force: true });
    if (await retentar(limite => rede(config, { origem: arquivo, executavel, senha: segredo,
      prazoMs: Math.min(prazoRedeMs(config), limite), registrar }), { registrar })) {
      try { removerHistoricoLocal(path.join(portalPrivado, 'backups')); }
      catch { registrar('AVISO: backup na rede confirmado; limpeza do historico local legado pendente.'); }
      console.log(`Backup confirmado na rede: ${path.basename(arquivo)}.`); return 0;
    }
    let detalhe = 'Rede indisponivel durante 1 hora; confira a entrega do e-mail de emergencia.';
    try { await email(config, arquivo, { registrar }); }
    catch (erro) { detalhe = erro instanceof FalhaBackup ? erro.message : 'ALERTA: e-mail de emergencia falhou.'; registrar(detalhe); }
    await alertar(detalhe);
    return 1;
  } catch (erro) {
    const mensagem = erro instanceof FalhaBackup ? erro.message : 'Backup falhou; confira banco, configuracao e permissoes.';
    registrar(mensagem);
    await alertar(mensagem); return 1;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.some(a => ['--somente-rede', '--snapshot-pre-atualizacao'].includes(a))) throw new FalhaBackup('Replica de snapshot de atualizacao removida.');
    process.exitCode = await comBackupExclusivo(path.join(portalPrivado, 'backups'), () => executarBackup({ somenteLocal: process.argv.includes('--somente-local') }));
  } catch (erro) { console.error(erro instanceof FalhaBackup ? erro.message : 'Backup falhou; confira operacao e configuracao.'); process.exitCode = 1; }
}
