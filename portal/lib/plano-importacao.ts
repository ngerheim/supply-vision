import { createHash } from 'node:crypto';
import type { parseImportRow } from './importacao.ts';

// A mesma projecao alimenta o hash e o INSERT. IDs gerados, datas, rotulos e
// metadados de conferencia nao descrevem as condicoes que o usuario aprovou.
export function valoresItemImportado(row: ReturnType<typeof parseImportRow>) {
  return [row.locationId!, row.itemId!, row.modelId!, row.unitId!, row.price, row.price === 0 ? 1 : 0, row.brands || null] as const;
}

export function impressaoPlanoImportacao(agreementId: string, rows: ReturnType<typeof parseImportRow>[]) {
  // Tuplas de campos em ordem fixa, JSON sem espacos e ordenacao por codigo de
  // caractere (sem locale). A ordem das linhas nao altera o conjunto gravado.
  const items = rows.map(row => JSON.stringify(valoresItemImportado(row))).sort();
  return createHash('sha256').update(JSON.stringify([agreementId, items])).digest('hex');
}
