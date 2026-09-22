import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { criarTransportador, lerConfig, portalPrivado } from './configuracao.mjs';
import { montarCasca, escapar, paleta } from '../lib/email-visual.ts';

const pastaBanco = path.join(portalPrivado, 'banco', 'estado', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
const pastaBackup = path.join(portalPrivado, 'backups');
const arquivoFinal = path.join(pastaBackup, 'portal-atual.sqlite');
const arquivoTemporario = path.join(pastaBackup, 'portal-atual.tmp.sqlite');
const arquivoAnterior = path.join(pastaBackup, 'portal-atual.anterior.sqlite');

function localizarBanco() {
  const nome = fs.readdirSync(pastaBanco).find((item) => item.endsWith('.sqlite') && item !== 'metadata.sqlite');
  if (!nome) throw new Error('Banco atual nao encontrado.');
  return path.join(pastaBanco, nome);
}

function criarCopiaIntegra(origem) {
  fs.mkdirSync(pastaBackup, { recursive: true });
  fs.rmSync(arquivoTemporario, { force: true });
  const banco = new DatabaseSync(origem, { readOnly: true });
  try { banco.exec(`VACUUM INTO '${arquivoTemporario.replaceAll("'", "''").replaceAll('\\', '/')}'`); }
  finally { banco.close(); }
  const copia = new DatabaseSync(arquivoTemporario, { readOnly: true });
  try {
    const resultado = Object.values(copia.prepare('PRAGMA integrity_check').get())[0];
    if (resultado !== 'ok') throw new Error(`Copia reprovada na verificacao de integridade: ${resultado}`);
  } finally { copia.close(); }
  fs.rmSync(arquivoAnterior, { force: true });
  if (fs.existsSync(arquivoFinal)) fs.renameSync(arquivoFinal, arquivoAnterior);
  try { fs.renameSync(arquivoTemporario, arquivoFinal); }
  catch (erro) {
    if (fs.existsSync(arquivoAnterior)) fs.renameSync(arquivoAnterior, arquivoFinal);
    throw erro;
  }
  fs.rmSync(arquivoAnterior, { force: true });
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
  const hashLocal = createHash('sha256').update(fs.readFileSync(arquivoFinal)).digest('hex');
  const hashRede = createHash('sha256').update(fs.readFileSync(temporario)).digest('hex');
  if (hashLocal !== hashRede) { fs.rmSync(temporario, { force: true }); throw new Error('A copia do backup na rede nao confere com a copia local.'); }
  fs.rmSync(anterior, { force: true });
  if (fs.existsSync(final)) fs.renameSync(final, anterior);
  try { fs.renameSync(temporario, final); }
  catch (erro) { if (fs.existsSync(anterior)) fs.renameSync(anterior, final); throw erro; }
  fs.rmSync(anterior, { force: true });
  console.log(`Copia atual na rede confirmada (SHA-256 ${hashRede.slice(0, 16)}).`);
  return final;
}
async function enviar() {
  const config = lerConfig();
  if (!config.BACKUP_EMAIL_TO) throw new Error('BACKUP_EMAIL_TO nao configurado.');
  const copiaNaRede = replicarNaRede(config);
  const conteudo = fs.readFileSync(arquivoFinal);
  const hash = createHash('sha256').update(conteudo).digest('hex');
  const tamanhoMb = (conteudo.length / 1024 / 1024).toFixed(2);

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
  if (anexar && conteudo.length > 20 * 1024 * 1024) {
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

try { criarCopiaIntegra(localizarBanco()); await enviar(); }
catch (erro) { console.error(`ERRO: ${erro instanceof Error ? erro.message : 'falha inesperada'}`); process.exitCode = 1; }
