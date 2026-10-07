import { pathToFileURL } from 'node:url';
import { comBackupExclusivo } from './backup-exclusivo.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { criarTransportador, lerConfig, lerConfigBruta, portalPrivado } from './configuracao.mjs';
import { DIAS_RETENCAO, guardarNoHistorico } from './retencao-backup.mjs';
import { localizarBanco as localizarBancoLocal } from './banco-local.mjs';
import { montarCasca, escapar, paleta } from '../lib/email-visual.ts';

// Leitura em blocos limita a memoria independentemente do tamanho do banco.
export function hashArquivo(arquivo) {
  const hash = createHash('sha256'), bloco = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(arquivo, 'r');
  try {
    let lidos;
    while ((lidos = fs.readSync(fd, bloco, 0, bloco.length, null)) > 0) hash.update(bloco.subarray(0, lidos));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

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

function replicarNaRede(config) {
  const pastaRede = config.BACKUP_NETWORK_DIR?.trim();
  if (!pastaRede) return null;
  fs.mkdirSync(pastaRede, { recursive: true });
  const final = path.join(pastaRede, 'portal-atual.sqlite');
  const temporario = path.join(pastaRede, 'portal-atual.tmp.sqlite');
  const anterior = path.join(pastaRede, 'portal-atual.anterior.sqlite');
  fs.rmSync(temporario, { force: true });
  fs.copyFileSync(arquivoFinal, temporario);
  const hashLocal = hashArquivo(arquivoFinal);
  const hashRede = hashArquivo(temporario);
  if (hashLocal !== hashRede) { fs.rmSync(temporario, { force: true }); throw new Error('A copia do backup na rede nao confere com a copia local.'); }
  fs.rmSync(anterior, { force: true });
  if (fs.existsSync(final)) fs.renameSync(final, anterior);
  try { fs.renameSync(temporario, final); }
  catch (erro) { if (fs.existsSync(anterior)) fs.renameSync(anterior, final); throw erro; }
  fs.rmSync(anterior, { force: true });
  console.log(`Copia atual na rede confirmada (SHA-256 ${hashRede.slice(0, 16)}).`);
  // O historico tambem vai para a rede: se o notebook for perdido, e dela
  // que se volta a um dia anterior ao erro.
  guardarNoHistorico(pastaRede, final);
  return final;
}
async function enviar(config, copiaNaRede) {
  if (!config.BACKUP_EMAIL_TO) throw new Error('BACKUP_EMAIL_TO nao configurado.');
  const tamanho = fs.statSync(arquivoFinal).size;
  const hash = hashArquivo(arquivoFinal);
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
        ? [{ filename: 'portal-atual.sqlite', path: arquivoFinal, contentType: 'application/vnd.sqlite3' }]
        : [],
    });
  } finally { transportador.close(); }
  console.log(`Backup atual confirmado (${tamanhoMb} MB, SHA-256 ${hash.slice(0, 16)}); comprovante enviado por e-mail${anexar ? ' com o banco anexado' : ''}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await comBackupExclusivo(pastaBackup, async () => {
    criarCopiaIntegra(localizarBanco());
    // A redundância não depende do servidor de correio nem da configuração SMTP.
    const copiaNaRede = replicarNaRede(lerConfigBruta());
    try { await enviar(lerConfig(), copiaNaRede); }
    catch (erro) {
      if (!copiaNaRede) throw erro;
      console.warn(`AVISO: backup local e na rede confirmados; comprovante não enviado: ${erro instanceof Error ? erro.message : 'falha de e-mail'}`);
    }
  }); }
  catch (erro) { console.error(`ERRO: ${erro instanceof Error ? erro.message : 'falha inesperada'}`); process.exitCode = 1; }
}
