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
  const response = await fetch(path, options);
  const type = response.headers.get('content-type') || '';
  const data: JsonData = type.includes('json')
    ? await response.json()
    : await response.text();
  if (
    response.status === 401 &&
    !path.endsWith('/session') &&
    !path.endsWith('/login')
  )
    window.dispatchEvent(new Event('portal:session-expired'));
  if (!response.ok) throw new ApiError(data);
  return data as T;
}

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Não foi possível concluir a operação.';
