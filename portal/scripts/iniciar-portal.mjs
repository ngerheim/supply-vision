import path from 'node:path';
import { validarVersaoNode } from './versao-node.mjs';
import { pathToFileURL } from 'node:url';
import { lerConfigEfetiva, portalPrivado, privado } from './configuracao.mjs';
import { configuracaoServidor } from './configuracao-servidor.mjs';
import { portasOperacao } from './portas-operacao.mjs';

export function enderecoServidor(modo, config = {}) {
  if (!['', 'local', 'lan'].includes(modo)) throw new Error('Modo do Portal invalido.');
  return { host: modo === 'lan' ? '0.0.0.0' : '127.0.0.1', port: portasOperacao(config).portal };
}
export async function iniciarPortal(modo = '') {
  validarVersaoNode();
  const config = lerConfigEfetiva();
  process.env.SUPPLY_VISION_PRIVADO = privado;
  Object.assign(process.env, configuracaoServidor(config));
  if (config.PORTAL_CRIAR_BANCO === '1' && (config.MODO_ENSAIO === '1' || process.env.CI === 'true')) process.env.PORTAL_CRIAR_BANCO = '1';
  const { iniciarServidorNode } = await import('./servidor-node.mjs');
  return iniciarServidorNode({ ...enderecoServidor(modo, config),
    pararArquivo: path.join(portalPrivado, '..', 'operacao', 'parar.sinal'),
    pai: process.ppid > 1 ? process.ppid : null,
  });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const runtime = await iniciarPortal(process.argv[2] || '');
  for (const sinal of ['SIGINT', 'SIGTERM']) process.once(sinal, () => { void runtime.encerrar(); });
}
