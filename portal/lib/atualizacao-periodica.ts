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

// Consultas substituiveis: cancelar tambem invalida respostas de transportes
// que nao interrompem a promessa ao receber AbortSignal.
export function criarConsultaDebounced<T>(receber: (resultado: T) => void, falhar: (erro: unknown) => void) {
  let sequencia = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const cancelar = () => {
    sequencia++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
  };
  return {
    cancelar,
    executar(consultar: (signal: AbortSignal) => Promise<T>, atraso = 300) {
      cancelar();
      const pedido = sequencia, atual = new AbortController();
      controller = atual;
      timer = setTimeout(() => {
        timer = undefined;
        void (async () => {
          try {
            const resultado = await consultar(atual.signal);
            if (!atual.signal.aborted && pedido === sequencia) receber(resultado);
          } catch (erro) {
            if (!atual.signal.aborted && pedido === sequencia) falhar(erro);
          }
        })();
      }, atraso);
    },
  };
}
