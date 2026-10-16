import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { iniciarServidorNode } from '../../scripts/servidor-node.mjs';
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.env.MODO_ENSAIO !== '1' || !process.env.SUPPLY_VISION_PRIVADO) throw new Error('Servidor de teste exige fixture explicita.');
  const runtime = await iniciarServidorNode({outDir:path.resolve(process.argv[2]),port:Number(process.argv[3]),pai:process.ppid});
  for (const sinal of ['SIGINT','SIGTERM']) process.once(sinal,()=>{void runtime.encerrar();});
}
