// Le corpos HTTP pelo fluxo e aplica o teto aos bytes efetivamente recebidos.
// O Content-Length e apenas um sinal antecipado: pode estar ausente ou
// incorreto e, por isso, nunca substitui a contagem do fluxo.

function declaradoAcimaDoLimite(request: Request, maximo: number) {
  const cabecalho = request.headers.get('content-length');
  if (!cabecalho) return false;
  const declarado = Number(cabecalho);
  return Number.isFinite(declarado) && declarado >= 0 && declarado > maximo;
}

export class CorpoExpirado extends Error {
  constructor() { super('O envio excedeu o prazo. Envie novamente em uma conexao estavel.'); }
}

type PrazosCorpo = { leituraMs?: number; drenagemMs?: number; drenagemBytes?: number };

export async function corpoBinarioLimitado(request: Request, maximo: number, prazos: PrazosCorpo = {}): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const leitor = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  let excedeu = declaradoAcimaDoLimite(request, maximo);
  const fimLeitura = Date.now() + (prazos.leituraMs ?? 60_000);
  let fimDrenagem = excedeu ? Date.now() + (prazos.drenagemMs ?? 5_000) : Infinity;
  let drenados = 0;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const prazo = Math.min(fimLeitura, fimDrenagem) - Date.now();
      if (prazo <= 0) throw new CorpoExpirado();
      let pedaco: ReadableStreamReadResult<Uint8Array>;
      try {
        pedaco = await Promise.race([
          leitor.read(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CorpoExpirado()), prazo); }),
        ]);
      } finally { clearTimeout(timer); }
      const { done, value } = pedaco;
      if (done) break;
      total += value.byteLength;
      if (total > maximo && !excedeu) {
        excedeu = true;
        partes.length = 0;
        fimDrenagem = Date.now() + (prazos.drenagemMs ?? 5_000);
      }
      // O proxy local do Wrangler perde a conexao quando o Worker cancela um
      // corpo ainda em envio. Drenar e descartar mantem a memoria limitada e
      // permite devolver o codigo HTTP correto sem materializar o excedente.
      if (!excedeu) partes.push(value);
      else {
        drenados += value.byteLength;
        if (drenados > (prazos.drenagemBytes ?? 16 * 1024 * 1024)) throw new CorpoExpirado();
      }
    }
  } catch (erro) {
    // O cancelamento pode fechar a conexao local em um corpo ainda aberto.
    // Nunca o aguardamos: liberar a trava e os recursos nao depende do cliente.
    void leitor.cancel().catch(() => {});
    if (erro instanceof CorpoExpirado) throw erro;
    return null;
  } finally { leitor.releaseLock(); }
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
