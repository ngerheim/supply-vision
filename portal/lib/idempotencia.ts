import { EntradaInvalida } from './limites-entrada.ts';

export function chaveIdempotencia(request: Request): string | null {
  const chave = request.headers.get('idempotency-key');
  if (chave === null) return null;
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(chave)) throw new EntradaInvalida('Identificador da tentativa inválido.');
  return chave;
}
