// A instalacao Windows tem consumidores Node que acessam o mesmo SQLite.
// D1 local escreve um bookmark ate em SELECT e nao aguarda SQLITE_BUSY.
// O transporte local executa SQL no Node com busy_timeout; D1 remoto permanece
// com o binding original. Cada operacao e enviada uma vez, inclusive escritas.
export function bancoSqliteLocal(porta: string, token: string, prepararD1: () => Promise<unknown>) {
  if (!/^\d+$/.test(porta) || Number(porta) < 1 || Number(porta) > 65535 || !/^[0-9a-f]{64}$/.test(token)) throw new Error('Configuracao SQLite local invalida.');
  const url = `http://127.0.0.1:${porta}`;
  let pronto: Promise<void> | null = null;
  async function preparar() {
    const response = await fetch(`${url}/ready`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('SQLite local indisponivel.');
    const estado = await response.json() as { pronto: boolean };
    // So a criacao do arquivo vazio passa pelo workerd, preservando sua
    // identidade/caminho. Bases existentes nunca precisam de bookmark.
    if (!estado.pronto) await prepararD1();
  }
  async function executar(operacao: string, consultas: { sql: string; values: unknown[] }[]) {
    if (!pronto) pronto = preparar().catch(erro => { pronto = null; throw erro; });
    await pronto;
    const response = await fetch(`${url}/sql`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ operacao, consultas }),
    });
    const resultado = await response.json() as { success: boolean; error?: string; resultados: { results: Record<string, unknown>[]; meta: { changes: number } }[] };
    if (!response.ok || !resultado.success) throw new Error(`SQLITE_LOCAL_ERROR: ${resultado.error || 'consulta nao concluida'}`);
    return resultado.resultados;
  }
  function prepare(sql: string, values: unknown[] = []) {
    return {
      sql, values,
      bind(...valores: unknown[]) { return prepare(sql, valores.map(valor => valor instanceof ArrayBuffer ? Array.from(new Uint8Array(valor)) : ArrayBuffer.isView(valor) ? Array.from(new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength)) : valor)); },
      async all<T = Record<string, unknown>>() { const [r] = await executar('consulta', [{ sql, values }]); return { ...r, success: true, results: r.results as T[] }; },
      async run() { const [r] = await executar('consulta', [{ sql, values }]); return { ...r, success: true }; },
      async first<T = Record<string, unknown>>(coluna?: string): Promise<T | null> {
        const [r] = await executar('consulta', [{ sql, values }]);
        return (coluna ? r.results[0]?.[coluna] : r.results[0]) as T ?? null;
      },
    };
  }
  return {
    prepare,
    async batch(consultas: { sql: string; values: unknown[] }[]) {
      return (await executar('batch', consultas)).map(r => ({ ...r, success: true }));
    },
    async exec(sql: string) { return executar('exec', [{ sql, values: [] }]); },
  };
}
