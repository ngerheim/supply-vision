import { abrirSqliteLocal } from '../scripts/sqlite-local.mjs';

export function bancoSqliteLocal(options: Parameters<typeof abrirSqliteLocal>[0]) {
  const banco = abrirSqliteLocal(options);
  function prepare(sql: string, values: unknown[] = []) {
    return {
      sql, values,
      bind(...valores: unknown[]) { return prepare(sql, valores); },
      async all<T = Record<string, unknown>>() {
        const r = banco.consultar({ sql, values });
        return { ...r, results: r.results as T[] };
      },
      async run() { return banco.consultar({ sql, values }); },
      async first<T = Record<string, unknown>>(coluna?: string): Promise<T | null> {
        const r = banco.consultar({ sql, values });
        return (coluna ? r.results[0]?.[coluna] : r.results[0]) as T ?? null;
      },
    };
  }
  return {
    prepare, arquivo: banco.arquivo, fechar: () => banco.fechar(),
    async batch(consultas: { sql: string; values: unknown[] }[]) { return banco.batch(consultas); },
    async exec(sql: string) { return banco.exec(sql); },
  };
}

export type BancoLocal = ReturnType<typeof bancoSqliteLocal>;
export type ConsultaLocal = ReturnType<BancoLocal['prepare']>;
