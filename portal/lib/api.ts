type JsonData = ReturnType<typeof JSON.parse>;
type AnyRow = Record<string, JsonData>;

export class ApiError extends Error {
  details: AnyRow;
  constructor(data: AnyRow) {
    super(data?.error || 'Não foi possível concluir a operação.');
    this.details = data;
  }
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
    response = await fetch(path, { ...options, signal });
    if (
      response.status === 401 &&
      !path.endsWith('/session') &&
      !path.endsWith('/login')
    )
      window.dispatchEvent(new Event('portal:session-expired'));
    const type = response.headers.get('content-type') || '';
    data = type.includes('json') ? await response.json() : await response.text();
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new ApiError({ error: timeout.aborted
      ? leitura ? 'O servidor demorou para responder. Tente novamente.' : 'A confirmação demorou. Confira o resultado antes de repetir a operação.'
      : leitura ? 'Não foi possível conectar ao portal. Verifique sua conexão e tente novamente.' : 'A conexão foi interrompida. Confira o resultado antes de repetir a operação.' });
  }
  if (!response.ok) {
    if (response.status === 429 || response.status === 503) {
      const espera = Number(response.headers.get('retry-after'));
      throw new ApiError({ error: `O servidor está ocupado. ${espera > 0 && Number.isFinite(espera) ? `Tente novamente em ${Math.ceil(espera)} segundos.` : 'Aguarde um momento e tente novamente.'}` });
    }
    throw new ApiError(typeof data === 'object' && data ? data : { error: 'Não foi possível concluir a operação. Tente novamente.' });
  }
  return data as T;
}

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Não foi possível concluir a operação.';
