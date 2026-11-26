import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { privado } from '../scripts/caminhos.mjs';
import { pode } from './permissoes.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';

// Painel de resultados: o Alertas grava os indicadores e o pacote "Baixar
// base" em privado/alertas/painel a cada recorte longo; o Portal so le.
// Nada e recalculado aqui: o numero da tela e o mesmo do arquivo baixado.
export const PASTA_PAINEL = path.join(privado, 'alertas', 'painel');
const LIMITE_JSON = 8 * 1024 * 1024;

export function painelApi(contexto: Pick<ContextoApi, 'ok' | 'fail' | 'audit' | 'NextResponse'>, pasta = PASTA_PAINEL) {
  const { ok, fail, audit, NextResponse } = contexto;

  async function dados(user: User) {
    if (!pode(user, 'painel:consultar')) return fail('Seu perfil não permite consultar o Painel.', 403);
    let texto: string;
    try {
      const arquivo = path.join(pasta, 'painel.json');
      if ((await stat(arquivo)).size > LIMITE_JSON) return fail('Arquivo do Painel maior que o esperado.', 500);
      texto = await readFile(arquivo, 'utf8');
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return ok({ disponivel: false });
      throw erro;
    }
    return ok({ disponivel: true, ...JSON.parse(texto) });
  }

  async function base(user: User) {
    if (!pode(user, 'painel:consultar')) return fail('Seu perfil não permite baixar a base do Painel.', 403);
    const arquivo = path.join(pasta, 'painel_base.zip');
    let info;
    try { info = await stat(arquivo); }
    catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return fail('A base ainda não foi gerada. Peça um recorte desde 01/01/2025.', 404);
      throw erro;
    }
    await audit(user.id, 'EXPORT', 'system', null, 'Base do Painel baixada (crua, tratada e retiradas)');
    const dia = info.mtime.toISOString().slice(0, 10);
    return new NextResponse(Readable.toWeb(createReadStream(arquivo)) as ReadableStream, { headers: {
      'cache-control': 'no-store', 'content-type': 'application/zip', 'content-length': String(info.size),
      'content-disposition': `attachment; filename="painel-base-${dia}.zip"`, 'x-content-type-options': 'nosniff',
    } });
  }

  return { dados, base };
}
