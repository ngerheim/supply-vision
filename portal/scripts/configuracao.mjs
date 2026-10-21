import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

const portal = path.resolve(import.meta.dirname, '..');
import { privado, portalPrivado } from './caminhos.mjs';
export { privado, portalPrivado } from './caminhos.mjs';

// Contrato: testes/fixtures/configuracao-env.json; linhas malformadas sao erro.
export function lerArquivo(arquivo, { obrigatorio = false } = {}) {
  if (!fs.existsSync(arquivo)) {
    if (obrigatorio) throw new Error('Configuracao obrigatoria ausente.');
    return {};
  }
  const config = {};
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const separador = limpa.indexOf('=');
    if (separador <= 0 || !limpa.slice(0, separador).trim()) throw new Error('Linha invalida na configuracao: esperado CHAVE=valor.');
    config[limpa.slice(0, separador).trim()] = limpa.slice(separador + 1).trim();
  }
  return config;
}

export function lerConfig() {
  const comum = path.join(privado, 'comum', 'smtp.env');
  const especifica = path.join(portalPrivado, 'configuracao', 'portal.env');
  const legado = path.join(portal, '.portal-email.env');
  const config = fs.existsSync(comum) || fs.existsSync(especifica)
    ? { ...lerArquivo(comum), ...lerArquivo(especifica) }
    : lerArquivo(legado);
  const obrigatorias = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM_NAME', 'PORTAL_URL'];
  const faltando = obrigatorias.filter((chave) => !config[chave]);
  if (faltando.length) throw new Error(`Configuracao privada incompleta: ${faltando.join(', ')}.`);
  return config;
}

// Mesma leitura, sem exigir o que so o envio de e-mail precisa: quem sobe o
// Portal nao deveria ser impedido por falta de SMTP.
export function lerConfigBruta() {
  const comum = path.join(privado, 'comum', 'smtp.env');
  const especifica = path.join(portalPrivado, 'configuracao', 'portal.env');
  return { ...lerArquivo(comum), ...lerArquivo(especifica) };
}

export function lerConfigEfetiva(config = lerConfigBruta(), ambiente = process.env) {
  return { ...config, ...ambiente };
}

export function criarTransportador(config) {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: Number(config.SMTP_PORT),
    secure: config.SMTP_SECURE === 'true',
    requireTLS: config.SMTP_REQUIRE_TLS !== 'false',
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { servername: config.SMTP_HOST, minVersion: 'TLSv1.2' },
  });
}

// Avisos operacionais usam somente o SMTP comum, sem depender do Portal.
export function lerConfigSmtp() {
  const config = lerArquivo(path.join(privado, 'comum', 'smtp.env'));
  const obrigatorias = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM_NAME'];
  if (obrigatorias.some(chave => !config[chave])) throw new Error('Configuracao SMTP comum incompleta.');
  return config;
}
