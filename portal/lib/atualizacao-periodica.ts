// Cabecalho enviado pelas consultas automaticas. O servidor continua
// validando a sessao, mas nao conta a consulta como atividade do usuario.
export const CABECALHO_ATUALIZACAO_AUTOMATICA = { 'x-portal-poll': '1' } as const;

// Decide se a requisicao conta como atividade para a expiracao por
// inatividade. Grava no maximo uma vez por minuto e nunca em consultas
// automaticas: uma aba esquecida aberta nao mantem a sessao viva sozinha.
export function registraAtividade(request: Request, vistoMs: number, agoraMs: number): boolean {
  if (request.headers.get('x-portal-poll') === '1') return false;
  return !vistoMs || agoraMs - vistoMs > 60000;
}

export function iniciarAtualizacaoPeriodica(
  atualizar: (signal: AbortSignal) => Promise<void>,
  aoFalhar: (erro: unknown) => void,
  deveAtualizar: () => boolean = () => true,
  intervalo = 5000,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ciclo = async () => {
    try {
      if (deveAtualizar()) await atualizar(controller.signal);
    } catch (erro) {
      if (!controller.signal.aborted) aoFalhar(erro);
    } finally {
      // O próximo pedido só começa após o anterior terminar, inclusive após falha.
      if (!controller.signal.aborted) timer = setTimeout(() => void ciclo(), intervalo);
    }
  };
  void ciclo();
  return () => {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  };
}
