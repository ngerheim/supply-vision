import { PORTAL_BUILD, ehEscrita } from './portal-build.ts';
import { AVISO_INDISPONIVEL, AVISO_VERSAO, obterEstadoPortal, sinalizarPortal } from './estado-portal.ts';

type JsonData = ReturnType<typeof JSON.parse>;
type AnyRow = Record<string, JsonData>;

export class ApiError extends Error {
  details: AnyRow;
  constructor(data: AnyRow) {
    super(data?.error || 'Não foi possível concluir a operação.');
    this.details = data;
  }
}

// Tambem usado pelos downloads que precisam do corpo binario original.
export async function fetchPortal(path: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);
  const polling = headers.get('x-portal-poll') === '1';
  if (ehEscrita(options?.method)) {
    const estado = obterEstadoPortal();
    if (estado.versaoNova) throw new ApiError({ error: AVISO_VERSAO });
    if (estado.indisponivel) throw new ApiError({ error: `${AVISO_INDISPONIVEL} Não é possível salvar agora.` });
    headers.set('x-portal-build', PORTAL_BUILD);
  }
  let response: Response;
  try { response = await fetch(path, { ...options, headers }); }
  catch (erro) {
    if (!options?.signal?.aborted || options.signal.reason?.name === 'TimeoutError') sinalizarPortal({ polling, falhaRede: true });
    throw erro;
  }
  sinalizarPortal({ polling, status: response.status, build: response.headers.get('x-portal-build') });
  if (response.status === 409) {
    try { sinalizarPortal({ status: 409, codigo: (await response.clone().json()).codigo }); }
    catch { /* Uma resposta sem JSON ainda pode identificar o build pelo cabecalho. */ }
  }
  return response;
}

export async function baixarArquivo(path: string, nome?: string, options?: RequestInit): Promise<void> {
  const response = await fetchPortal(path, options);
  if (!response.ok) {
    if (response.status === 401 && !obterEstadoPortal().versaoNova) window.dispatchEvent(new Event('portal:session-expired'));
    const dados = await response.json().catch(() => ({}));
    throw new ApiError({error:dados.error || 'Não foi possível baixar o arquivo.'});
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = nome || /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || 'arquivo';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function api<T = JsonData>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  // Escritas podem continuar no servidor mesmo depois de uma desconexão.
  // Nunca repetimos automaticamente uma operação.
  const leitura = !options?.method || options.method.toUpperCase() === 'GET';
  const timeout = AbortSignal.timeout(leitura ? 30000 : 180000);
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  let data: JsonData;
  try {
    response = await fetchPortal(path, { ...options, signal });
    if (
      response.status === 401 &&
      !obterEstadoPortal().versaoNova &&
      !path.endsWith('/session') &&
      !path.endsWith('/login')
    )
      window.dispatchEvent(new Event('portal:session-expired'));
    const type = response.headers.get('content-type') || '';
    data = type.includes('json') ? await response.json() : await response.text();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options?.signal?.aborted) throw error;
    sinalizarPortal({ polling: new Headers(options?.headers).get('x-portal-poll') === '1', falhaRede: true });
    throw new ApiError({ error: timeout.aborted
      ? leitura ? 'O servidor demorou para responder. Tente novamente.' : 'A confirmação demorou. Confira o resultado antes de repetir a operação.'
      : leitura ? 'Não foi possível conectar ao portal. Verifique sua conexão e tente novamente.' : 'A conexão foi interrompida. Confira o resultado antes de repetir a operação.' });
  }
  if (!response.ok) {
    const codigo = typeof data === 'object' && data ? (data as AnyRow).codigo : undefined;
    if (codigo === 'validacao') throw new ApiError({ ...(data as AnyRow), status: response.status });
    if (response.status === 429) throw new ApiError({ ...(typeof data === 'object' && data ? data : { error: 'Limite de consultas atingido.' }), status: response.status });
    if (response.status === 503 && !path.startsWith('/api/solicitacoes/')) {
      const espera = Number(response.headers.get('retry-after'));
      throw new ApiError({ error: `O servidor está ocupado. ${espera > 0 && Number.isFinite(espera) ? `Tente novamente em ${Math.ceil(espera)} segundos.` : 'Aguarde um momento e tente novamente.'}` });
    }
    throw new ApiError({ ...(typeof data === 'object' && data ? data : { error: 'Não foi possível concluir a operação. Tente novamente.' }), status: response.status });
  }
  return data as T;
}

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Não foi possível concluir a operação.';
