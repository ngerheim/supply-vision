// Repete apenas SELECT: nem RETURNING nem uma rota GET com auditoria autorizam
// reenviar escrita. A segunda falha e qualquer outro erro seguem para o chamador.
export async function leituraD1<T>(sql: string, consultar: () => Promise<T>): Promise<T> {
  try {
    return await consultar();
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    if (!/^\s*SELECT\b/i.test(sql)
      || !mensagem.includes('D1_ERROR: Failed to get session commit token: internal error')) throw erro;
    console.warn('[portal] D1 interno na leitura; nova tentativa unica em 100 ms.');
    await new Promise(resolve => setTimeout(resolve, 100));
    return consultar();
  }
}
