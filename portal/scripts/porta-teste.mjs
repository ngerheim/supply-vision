import net from 'node:net';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export async function reservarPortaLoopback() {
  const servidor=net.createServer();
  await new Promise((resolve,reject)=>{servidor.once('error',reject);servidor.listen(0,'127.0.0.1',resolve);});
  const porta=servidor.address().port;
  let liberacao;
  return { porta, liberar() { return liberacao ??= new Promise(resolve=>servidor.close(resolve)); } };
}

// Apenas para configurar um servico AUSENTE. Servidores reais devem escutar
// em 0 e informar sua porta depois de listen, sem liberar/reabrir uma reserva.
export async function portaSemServico() {
  const reserva = await reservarPortaLoopback();
  await reserva.liberar();
  return reserva.porta;
}

export async function iniciarServidorFixture(outDir, env, pararArquivo) {
  const filho = fork(fileURLToPath(new URL('../tests/apoio/servidor.mjs', import.meta.url)), [outDir, '0', pararArquivo],
    { env, execArgv: ['--experimental-strip-types'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let log = '';
  filho.stdout.on('data', d => { log += d; }); filho.stderr.on('data', d => { log += d; });
  try {
    const porta = await new Promise((resolve, reject) => {
      const prazo = setTimeout(() => reject(new Error('Servidor de fixture nao iniciou: ' + log)), 15000);
      filho.once('message', mensagem => { clearTimeout(prazo); resolve(mensagem.porta); });
      filho.once('error', erro => { clearTimeout(prazo); reject(erro); });
      filho.once('exit', codigo => { clearTimeout(prazo); reject(new Error(`Servidor encerrou (${codigo}): ${log}`)); });
    });
    return { filho, porta, get log() { return log; } };
  } catch (erro) { filho.kill(); throw erro; }
}
