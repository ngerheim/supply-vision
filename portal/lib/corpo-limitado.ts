// Le corpos HTTP pelo fluxo e aplica o teto aos bytes efetivamente recebidos.
// O Content-Length e apenas um sinal antecipado: pode estar ausente ou
// incorreto e, por isso, nunca substitui a contagem do fluxo.

function declaradoAcimaDoLimite(request: Request, maximo: number) {
  const cabecalho = request.headers.get('content-length');
  if (!cabecalho) return false;
  const declarado = Number(cabecalho);
  return Number.isFinite(declarado) && declarado >= 0 && declarado > maximo;
}

export async function corpoBinarioLimitado(request: Request, maximo: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const leitor = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  let excedeu = declaradoAcimaDoLimite(request, maximo);
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximo && !excedeu) {
        excedeu = true;
        partes.length = 0;
      }
      // O proxy local do Wrangler perde a conexao quando o Worker cancela um
      // corpo ainda em envio. Drenar e descartar mantem a memoria limitada e
      // permite devolver o codigo HTTP correto sem materializar o excedente.
      if (!excedeu) partes.push(value);
    }
  } catch { return null; }
  if (excedeu) return null;
  const junto = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) { junto.set(parte, posicao); posicao += parte.byteLength; }
  return junto;
}

export async function corpoLimitado(request: Request, maximo: number): Promise<string | null> {
  const bytes = await corpoBinarioLimitado(request, maximo);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
