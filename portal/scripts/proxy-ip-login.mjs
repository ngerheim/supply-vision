import http from 'node:http';
import { assinarIpLogin } from '../lib/ip-login.ts';
// Backend sempre em loopback. Identidade vem do socket; cliente nao pode
// escolher os cabecalhos assinados, que nao sao devolvidos na resposta.
export function criarProxyIpLogin({ portaBackend, token }) {
  if (!token || !Number.isInteger(portaBackend) || portaBackend < 1) throw new Error('Proxy de IP exige token e porta interna.');
  const servidor = http.createServer(async (req, res) => {
    let upstream;
    try {
      const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/,'');
      const headers = { ...req.headers, 'x-sv-client-ip': ip, 'x-sv-client-proof': await assinarIpLogin(ip,token), 'x-forwarded-for':ip, 'cf-connecting-ip':ip };
      delete headers['cf-ray'];
      upstream = http.request({ host:'127.0.0.1', port:portaBackend, path:req.url, method:req.method, headers }, resposta => {
        const saida = { ...resposta.headers }; delete saida['x-sv-client-ip']; delete saida['x-sv-client-proof'];
        res.writeHead(resposta.statusCode || 502,saida);resposta.pipe(res);
      });
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Portal inicializando ou indisponivel.');});
      req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());
      req.pipe(upstream);
    } catch { upstream?.destroy();if(!res.headersSent)res.writeHead(503);res.end(); }
  });
  servidor.requestTimeout = 120_000;
  return servidor;
}
export async function reservarPortaLoopback() {
  const servidor=http.createServer();
  await new Promise((resolve,reject)=>{servidor.once('error',reject);servidor.listen(0,'127.0.0.1',resolve);});
  const porta=servidor.address().port;
  await new Promise(resolve=>servidor.close(resolve));
  return porta;
}
