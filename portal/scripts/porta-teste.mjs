import net from 'node:net';
export async function reservarPortaLoopback() {
  const servidor=net.createServer();
  await new Promise((resolve,reject)=>{servidor.once('error',reject);servidor.listen(0,'127.0.0.1',resolve);});
  const porta=servidor.address().port;
  await new Promise(resolve=>servidor.close(resolve));
  return porta;
}
