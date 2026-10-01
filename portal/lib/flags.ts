import { EntradaInvalida } from './limites-entrada.ts';

// O banco retorna 0/1; formulários novos enviam booleanos.
export function flag(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw new EntradaInvalida(
    'Informe uma opção válida para o campo de ativação.',
  );
}
