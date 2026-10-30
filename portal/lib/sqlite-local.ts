import { abrirSqliteLocal } from '../scripts/sqlite-local.mjs';
import { autorEscrita, acaoEscritaAutorizada, SessaoRevogada } from './autor-escrita.ts';
import { lerPermissoes, pode } from './permissoes.ts';
import { SESSAO_INATIVIDADE_MS } from './politica-sessao.ts';

export function bancoSqliteLocal(options: Parameters<typeof abrirSqliteLocal>[0]) {
  const banco = abrirSqliteLocal(options);
  const leitura = (sql: string) => /^\s*(SELECT|EXPLAIN|PRAGMA)\b/i.test(sql);
  function guarda() {
    const autor = autorEscrita();
    if (!autor) return undefined;
    return (consultar: (consulta: {sql: string; values: unknown[]}) => {results: unknown[]}) => {
      const agora = new Date().toISOString(), limite = new Date(Date.now() - SESSAO_INATIVIDADE_MS).toISOString();
      const acao = acaoEscritaAutorizada();
      const perfilEscreve = pode({ role: autor.role }, 'portal:escrever');
      // Sem acao declarada, escreve quem tem perfil de escrita ou algum
      // ajuste individual de edicao; o roteador ja autorizou a rota.
      const r = consultar({ sql: `SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token=? AND u.id=? AND u.active=1 AND u.role=? ${acao || perfilEscreve ? '' : `AND EXISTS (SELECT 1 FROM permissoes_usuario p WHERE p.user_id=u.id AND p.nivel='edicao')`}
        AND s.expires_at>? AND (s.last_seen_at IS NULL OR s.last_seen_at>=?)`,
        values: [autor.token, autor.id, autor.role, agora, limite] });
      if (!r.results.length) throw new SessaoRevogada();
      if (acao && !pode({ role: autor.role }, 'permissao:gerenciar')) {
        const ajustes = consultar({ sql: 'SELECT area,nivel FROM permissoes_usuario WHERE user_id=?', values: [autor.id] });
        const permissoes = lerPermissoes(ajustes.results as { area: unknown; nivel: unknown }[]);
        if (!pode({ role: autor.role, permissoes }, acao)) throw new SessaoRevogada();
      }
    };
  }
  function consultar(sql: string, values: unknown[]) {
    const verificar = !leitura(sql) ? guarda() : undefined;
    return verificar ? banco.batch([{sql, values}], verificar)[0] : banco.consultar({sql, values});
  }
  function prepare(sql: string, values: unknown[] = []) {
    return {
      sql, values,
      bind(...valores: unknown[]) { return prepare(sql, valores); },
      async all<T = Record<string, unknown>>() {
        const r = consultar(sql, values);
        return { ...r, results: r.results as T[] };
      },
      async run() { return consultar(sql, values); },
      async first<T = Record<string, unknown>>(coluna?: string): Promise<T | null> {
        const r = consultar(sql, values);
        return (coluna ? r.results[0]?.[coluna] : r.results[0]) as T ?? null;
      },
    };
  }
  return {
    prepare, arquivo: banco.arquivo, fechar: () => banco.fechar(),
    async batch(consultas: { sql: string; values: unknown[] }[]) { return banco.batch(consultas, consultas.some(c => !leitura(c.sql)) ? guarda() : undefined); },
    async batchConstruir(construir: (consultar: (consulta: {sql:string;values:unknown[]}) => {results: unknown[]}) => {sql:string;values:unknown[]}[]) { return banco.batch(consultar => construir(consultar), guarda()); },
    async exec(sql: string) { return banco.exec(sql); },
  };
}

export type BancoLocal = ReturnType<typeof bancoSqliteLocal>;
export type ConsultaLocal = ReturnType<BancoLocal['prepare']>;
