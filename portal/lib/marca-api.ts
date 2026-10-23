import { open } from 'node:fs/promises';
import path from 'node:path';
import { portalPrivado } from '../scripts/caminhos.mjs';
import { CABECALHOS_MARCA } from './cabecalhos-seguranca.ts';

const limite = 512 * 1024;
export async function logoMarca() {
  const headers = CABECALHOS_MARCA;
  let arquivo;
  try {
    arquivo = await open(path.join(portalPrivado, 'marca', 'logo.svg'), 'r');
    const info = await arquivo.stat();
    if (!info.isFile()) return new Response(null, { status: 404, headers });
    if (info.size > limite) return new Response(null, { status: 413, headers });
    // Bound the actual read too, even if the file grows after stat().
    const buffer = Buffer.alloc(limite + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await arquivo.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > limite) return new Response(null, { status: 413, headers });
    return new Response(buffer.subarray(0, total), { headers });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404, headers });
    throw error;
  } finally { await arquivo?.close(); }
}
