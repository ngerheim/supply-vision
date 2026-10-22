import { assinarEstadoPortal, obterEstadoPortal, proximoIntervalo } from './estado-portal.ts';
import { api } from './api.ts';
import { CABECALHO_ATUALIZACAO_AUTOMATICA } from './atualizacao-periodica.ts';
import { atualizarContagemCentral } from './central-estado.ts';

export async function consultarDisponibilidade(usuario: string | null, signal: AbortSignal) {
  const dados = await api<{ naoLidas?: number }>(usuario ? '/api/central/nao-lidas' : '/api/health', {
    headers: CABECALHO_ATUALIZACAO_AUTOMATICA, signal,
  });
  if (usuario && !signal.aborted && typeof dados.naoLidas === 'number') atualizarContagemCentral(usuario, dados.naoLidas);
}

// Agendamento exclusivo da disponibilidade; as consultas das outras telas
// continuam com o contrato de iniciarAtualizacaoPeriodica intacto.
export function iniciarPollingDisponibilidade(
  consultar: (signal: AbortSignal) => Promise<void>,
  documento: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
  obterEstado = obterEstadoPortal,
  assinarEstado = assinarEstadoPortal,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let consultando = false, consultarAoConcluir = false;
  function agendar() {
    if (controller.signal.aborted || consultando) return;
    clearTimeout(timer);
    const intervalo = proximoIntervalo(obterEstado(), documento.hidden);
    if (intervalo !== null) timer = setTimeout(() => void ciclo(), intervalo);
  }
  async function ciclo() {
    if (controller.signal.aborted || consultando) return;
    clearTimeout(timer);
    if (proximoIntervalo(obterEstado(), documento.hidden) === null) return;
    consultando = true;
    try { await consultar(controller.signal); }
    catch { /* O helper da API ja sinaliza a indisponibilidade. */ }
    finally {
      consultando = false;
      const imediatamente = consultarAoConcluir && !documento.hidden;
      consultarAoConcluir = false;
      if (!controller.signal.aborted && imediatamente) void ciclo();
      else agendar();
    }
  }
  function aoMudarVisibilidade() {
    if (documento.hidden) {
      consultarAoConcluir = false;
      agendar();
    } else if (consultando) {
      // Nao sobrepor pedidos se a aba reaparecer durante uma consulta lenta.
      consultarAoConcluir = true;
    } else void ciclo();
  }
  documento.addEventListener('visibilitychange', aoMudarVisibilidade);
  const desassinar = assinarEstado(agendar);
  void ciclo();
  return () => {
    controller.abort();
    clearTimeout(timer);
    desassinar();
    documento.removeEventListener('visibilitychange', aoMudarVisibilidade);
  };
}
