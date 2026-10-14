import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { criarServidorSqlite } from './sqlite-local.mjs';
import { criarProxyIpLogin, reservarPortaLoopback } from './proxy-ip-login.mjs';

// O mesmo transporte atende a instalacao e os testes descartaveis. O workerd
// continua servindo o portal; em sqlite, suas consultas passam pelo Node.
// Os consumidores externos continuam abrindo o arquivo por conta propria.
export async function iniciarRuntimeLocal(argumentos, { projeto = path.resolve(import.meta.dirname, '..'), tokenIp = null, bancoLocal = 'sqlite' } = {}) {
  const args = [...argumentos];
  function retirar(nome, padrao) {
    const indice = args.indexOf(nome);
    if (indice < 0) return padrao;
    const valor = args[indice + 1];
    if (!valor || valor.startsWith('--')) throw new Error(`Valor ausente: ${nome}`);
    args.splice(indice, 2);return valor;
  }
  bancoLocal = retirar('--banco-local', bancoLocal);
  if (!['sqlite', 'd1'].includes(bancoLocal)) throw new Error('Banco local deve ser sqlite ou d1.');
  const porta = Number(retirar('--port', '3000')), ip = retirar('--ip', '127.0.0.1');
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new Error('Porta publica invalida.');
  const persistenciaInformada = retirar('--persist-to', null);
  if (!persistenciaInformada) throw new Error('Runtime local exige persistencia explicita.');
  const persistencia = path.resolve(projeto, persistenciaInformada);
  const varsOriginal = retirar('--env-file', null);
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-runtime-'));
  const token = randomBytes(32).toString('hex');
  const sqlite = bancoLocal === 'sqlite' ? criarServidorSqlite({ persistencia, token }) : null;
  let proxy, processo, encerrado = false;
  function encerrar() {
    if (encerrado) return;encerrado = true;
    processo?.kill();proxy?.close();proxy?.closeAllConnections();sqlite?.close();sqlite?.closeAllConnections();
    try { fs.rmSync(temporario, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { console.warn('Nao foi possivel remover o arquivo temporario do runtime local.'); }
  }
  try {
    if (sqlite) await new Promise((resolve, reject) => { sqlite.once('error', reject);sqlite.listen(0, '127.0.0.1', resolve); });
    const portaBackend = await reservarPortaLoopback();
    proxy = criarProxyIpLogin({ portaBackend, token: tokenIp });
    await new Promise((resolve, reject) => { proxy.once('error', reject);proxy.listen(porta, ip, resolve); });
    const arquivoVars = path.join(temporario, 'worker.env');
    const original = varsOriginal ? fs.readFileSync(path.resolve(projeto, varsOriginal), 'utf8') : '';
    // Token efemero somente em arquivo protegido, nunca na linha de comando.
    const varsBanco = sqlite ? `PORTAL_SQLITE_PORTA=${sqlite.address().port}\nPORTAL_SQLITE_TOKEN=${token}\n` : 'PORTAL_SQLITE_PORTA=\nPORTAL_SQLITE_TOKEN=\n';
    // d1 tambem apaga valores antigos: nunca reutiliza a ponte da execucao anterior.
    fs.writeFileSync(arquivoVars, `${original}\n${varsBanco}`, { mode: 0o600 });
    const wrangler = path.join(projeto, 'node_modules/wrangler/bin/wrangler.js');
    processo = spawn(process.execPath, [wrangler, ...args, '--persist-to', persistencia, '--env-file', arquivoVars, '--ip', '127.0.0.1', '--port', String(portaBackend)], { cwd: projeto, stdio: 'inherit' });
    processo.once('error', encerrar);
    processo.once('exit', encerrar);
    return { processo, encerrar, bancoLocal };
  } catch (erro) { encerrar();throw erro; }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const runtime = await iniciarRuntimeLocal(process.argv.slice(2));
  for (const sinal of ['SIGTERM', 'SIGINT']) process.once(sinal, runtime.encerrar);
  runtime.processo.once('exit', (codigo, sinal) => { process.exitCode = sinal ? 1 : codigo ?? 1; });
}
