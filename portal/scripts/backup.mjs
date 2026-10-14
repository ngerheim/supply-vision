import { modoEnsaio } from './modo-ensaio.mjs';
import { pathToFileURL } from 'node:url';
import { comBackupExclusivo } from './backup-exclusivo.mjs';
import { fork } from 'node:child_process';
import { hashArquivo } from './backup-rede.mjs';
export { hashArquivo } from './backup-rede.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { criarTransportador, lerConfig, lerConfigBruta, portalPrivado } from './configuracao.mjs';
import { DIAS_RETENCAO, guardarNoHistorico } from './retencao-backup.mjs';
import { localizarBanco as localizarBancoLocal } from './banco-local.mjs';
import { montarCasca, escapar, paleta } from '../lib/email-visual.ts';

const pastaBackup = path.join(portalPrivado, 'backups');
const arquivoFinal = path.join(pastaBackup, 'portal-atual.sqlite');
const arquivoTemporario = path.join(pastaBackup, 'portal-atual.tmp.sqlite');
const arquivoAnterior = path.join(pastaBackup, 'portal-atual.anterior.sqlite');

function localizarBanco() {
  const banco = localizarBancoLocal();
  if (!banco) throw new Error('Banco atual nao encontrado.');
  return banco;
}

export function criarCopiaIntegra(origem) {
  fs.mkdirSync(pastaBackup, { recursive: true });
  fs.rmSync(arquivoTemporario, { force: true });
  const banco = new DatabaseSync(origem, { readOnly: true });
  try { banco.exec(`VACUUM INTO '${arquivoTemporario.replaceAll("'", "''").replaceAll('\\', '/')}'`); }
  finally { banco.close(); }
  const copia = new DatabaseSync(arquivoTemporario, { readOnly: true });
  try {
    const resultado = Object.values(copia.prepare('PRAGMA integrity_check').get())[0];
    if (resultado !== 'ok') throw new Error(`Copia reprovada na verificacao de integridade: ${String(resultado)}`);
  } finally { copia.close(); }
  fs.rmSync(arquivoAnterior, { force: true });
  if (fs.existsSync(arquivoFinal)) fs.renameSync(arquivoFinal, arquivoAnterior);
  try { fs.renameSync(arquivoTemporario, arquivoFinal); }
  catch (erro) {
    if (fs.existsSync(arquivoAnterior)) fs.renameSync(arquivoAnterior, arquivoFinal);
    throw erro;
  }
  fs.rmSync(arquivoAnterior, { force: true });
  const { apagados } = guardarNoHistorico(pastaBackup, arquivoFinal);
  console.log(`Historico local: copia do dia guardada (${DIAS_RETENCAO} dias)${apagados.length ? `; removidos: ${apagados.join(', ')}` : ''}.`);
}

export function prazoRedeMs(config) {
  const segundos = Number(config.BACKUP_NETWORK_TIMEOUT_SECONDS?.trim() || '600');
  if (!Number.isInteger(segundos) || segundos < 1 || segundos > 86400)
    throw new Error('BACKUP_NETWORK_TIMEOUT_SECONDS deve ser inteiro entre 1 e 86400.');
  return segundos * 1000;
}
export async function replicarNaRede(config, { origem = arquivoFinal, prazoMs, registrar = console.warn, iniciar = () => fork(new URL('./backup-rede.mjs', import.meta.url), [], { execArgv: [], stdio: ['ignore','ignore','ignore','ipc'] }) } = {}) {
  const pastaRede = config.BACKUP_NETWORK_DIR?.trim();
  if (!pastaRede) return null;
  const limite = prazoMs ?? prazoRedeMs(config);
  const resultado = await new Promise((resolve, reject) => {
    const filho = iniciar();
    let resposta, excedeu = false;
    const timer = setTimeout(() => { excedeu = true; filho.kill('SIGKILL'); }, limite);
    filho.once('error', erro => { clearTimeout(timer); reject(erro); });
    filho.on('message', valor => { if (typeof valor?.aviso === 'string') registrar(valor.aviso); else resposta = valor; });
    filho.once('exit', codigo => {
      clearTimeout(timer);
      // Confirma o encerramento antes de liberar a trava ou retomar a operacao.
      if (excedeu) reject(new Error(`Prazo do backup em rede excedido (${limite / 1000} s); processo encerrado, copia local validada preservada.`));
      else if (codigo !== 0 || !resposta?.ok) reject(new Error(resposta?.erro || 'Processo de backup em rede falhou.'));
      else resolve(resposta);
    });
    filho.send({ origem, pastaRede });
  });
  console.log(`Copia atual na rede confirmada (SHA-256 ${resultado.hash.slice(0, 16)}).`);
  return resultado.arquivo;
}
async function enviar(config, copiaNaRede, origem = arquivoFinal) {
  if (!config.BACKUP_EMAIL_TO) throw new Error('BACKUP_EMAIL_TO nao configurado.');
  const tamanho = fs.statSync(origem).size;
  const hash = hashArquivo(origem);
  const tamanhoMb = (tamanho / 1024 / 1024).toFixed(2);

  // O anexo levava o banco INTEIRO para fora da empresa a cada horario de
  // backup: hashes de senha, sessoes, tentativas de acesso e toda a base
  // comercial. A exportacao da API ja recusa mandar senhas por principio, e
  // a copia de rede -- conferida por SHA-256 -- cumpre o papel de redundancia.
  //
  // Por padrao o e-mail passa a ser so o comprovante. Anexar de novo e uma
  // decisao explicita (BACKUP_ANEXAR_BANCO=true). Sem copia de rede nao ha
  // outra redundancia, entao ali o anexo continua indo, com aviso.
  const pedidoExplicito = String(config.BACKUP_ANEXAR_BANCO || '').trim().toLowerCase() === 'true';
  const anexar = pedidoExplicito || !copiaNaRede;
  if (anexar && !pedidoExplicito) {
    console.warn('AVISO: sem BACKUP_NETWORK_DIR configurado, o banco segue anexado ao e-mail por falta de outra copia.');
  }
  if (anexar && tamanho > 20 * 1024 * 1024) {
    console.warn(`AVISO: o banco tem ${tamanhoMb} MB e pode ser recusado pelo servidor de e-mail. Configure BACKUP_NETWORK_DIR.`);
  }

  const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' }).format(new Date());
  const ondeEsta = copiaNaRede
    ? `<tr><td><b>Copia integra</b></td><td>${escapar(copiaNaRede)}</td></tr>`
    : '';
  const transportador = criarTransportador(config);
  try {
    await transportador.sendMail({
      from: { name: config.EMAIL_FROM_NAME, address: config.SMTP_USER },
      to: config.BACKUP_EMAIL_TO,
      subject: `[Supply Vision] Backup do Portal - ${data}`,
      text: `Backup integro do banco do Portal Suprimentos.\n\nData: ${data}\nTamanho: ${tamanhoMb} MB\nSHA-256: ${hash}\n`
        + (copiaNaRede ? `Copia integra em: ${copiaNaRede}\n` : '')
        + (anexar ? '\nO banco segue anexado a esta mensagem.\n' : '\nO banco NAO segue anexado: confira a copia acima.\n'),
      html: montarCasca(
        'Backup do Portal',
        data,
        `<p style="margin:0 0 20px;line-height:1.55">Copia integra do banco, conferida com <b>PRAGMA integrity_check</b>${anexar ? ' e anexada a esta mensagem' : ''}.</p>`
        + `<table role="presentation" width="100%" cellspacing="0" cellpadding="7" style="font-size:14px;background:${paleta.rodapeFundo};border-radius:10px">`
        + `<tr><td><b>Tamanho</b></td><td>${escapar(tamanhoMb)} MB</td></tr>`
        + ondeEsta
        + `<tr><td><b>SHA-256</b></td><td style="font-family:Consolas,monospace;font-size:12px;word-break:break-all">${escapar(hash)}</td></tr>`
        + `</table>`,
      ),
      attachments: anexar
        ? [{ filename: 'portal-atual.sqlite', path: origem, contentType: 'application/vnd.sqlite3' }]
        : [],
    });
  } finally { transportador.close(); }
  console.log(`Backup atual confirmado (${tamanhoMb} MB, SHA-256 ${hash.slice(0, 16)}); comprovante enviado por e-mail${anexar ? ' com o banco anexado' : ''}.`);
}

// O codigo 3 e exclusivo do backup pre-atualizacao: copia local ja validada.
export async function executarBackup({ preAtualizacao = false, somenteLocal = false, somenteRede = false, ensaio = modoEnsaio(),
  copiar = () => criarCopiaIntegra(localizarBanco()), rede = () => replicarNaRede(lerConfigBruta()),
  email = copia => enviar(lerConfig(), copia), registrar = console.warn } = {}) {
  if (!somenteRede) copiar();
  if (somenteLocal) return 0;
  if (ensaio) { console.log('ensaio: envio suprimido; backup local validado, backup em rede bloqueado.'); return 0; }
  let copiaNaRede;
  try { copiaNaRede = await rede(); }
  catch (erro) {
    if (!preAtualizacao) throw erro;
    registrar(`AVISO: backup local validado; copia de rede falhou. ${erro instanceof Error ? erro.message : ''}`);
    return 3;
  }
  try { await email(copiaNaRede); }
  catch (erro) {
    if (!copiaNaRede) throw erro;
    registrar('AVISO: backup local e na rede confirmados; comprovante não enviado.');
  }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const origem = process.argv.includes('--snapshot-pre-atualizacao')
      ? path.join(pastaBackup, 'pre-atualizacao.sqlite') : arquivoFinal;
    process.exitCode = await comBackupExclusivo(pastaBackup, () => executarBackup({
      preAtualizacao: process.argv.includes('--pre-atualizacao'),
      somenteLocal: process.argv.includes('--somente-local'),
      somenteRede: process.argv.includes('--somente-rede'),
      rede: () => replicarNaRede(lerConfigBruta(), { origem }),
      email: copia => enviar(lerConfig(), copia, origem),
    }));
  }
  catch (erro) { console.error(`ERRO: ${erro instanceof Error ? erro.message : 'falha inesperada'}`); process.exitCode = 1; }
}
