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
