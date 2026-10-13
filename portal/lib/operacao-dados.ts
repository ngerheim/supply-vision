import { textoBusca } from './busca.ts';

// Uma unica varredura na migracao, nunca na abertura de novos chamados.
export const CRIAR_CONTADOR_CHAMADOS_SQL = 'CREATE TABLE IF NOT EXISTS ticket_counter (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL)';
export const MIGRAR_CONTADOR_CHAMADOS_SQL = `INSERT OR IGNORE INTO ticket_counter(id,value)
 SELECT 1,COALESCE(MAX(CAST(substr(code,instr(code,'-')+1) AS INTEGER)),0) FROM tickets`;
export const RESERVAR_CODIGO_CHAMADO_SQL = 'UPDATE ticket_counter SET value=value+1 WHERE id=1 RETURNING value';
export function joinContagemHistorico(busca: string | null | undefined) {
  return busca ? 'LEFT JOIN users u ON u.id=l.user_id' : '';
}

type CamposBuscaChamado = { code: string; supplier_name: string; city: string | null; state: string | null };
export function dadosBuscaChamado(campos: CamposBuscaChamado) {
  const fornecedor = textoBusca(campos.supplier_name);
  // Chave natural: Fornecedor 2 precede Fornecedor 10, inclusive com zeros.
  const supplierSort = fornecedor.replace(/\d+/g, parte => {
    const numero = parte.replace(/^0+(?=\d)/, '');
    return `${String(numero.length).padStart(6, '0')}:${numero}`;
  });
  return { searchText: textoBusca(`${campos.code} ${campos.supplier_name} ${campos.city ?? ''} ${campos.state ?? ''}`), supplierSort };
}
export const LISTAR_CHAMADOS_SEM_BUSCA_SQL = `SELECT id,code,supplier_name,city,state FROM tickets
 WHERE search_text IS NULL OR supplier_sort IS NULL ORDER BY id LIMIT 100`;
export const GRAVAR_BUSCA_CHAMADO_SQL = `UPDATE tickets SET search_text=?,supplier_sort=?
 WHERE id=? AND code IS ? AND supplier_name IS ? AND city IS ? AND state IS ?`;
// Lotes pequenos, retomaveis. A condicao evita sobrescrever uma edicao concorrente.
export async function migrarBuscaChamados(db: D1Database) {
  for (;;) {
    const linhas = (await db.prepare(LISTAR_CHAMADOS_SEM_BUSCA_SQL).all<CamposBuscaChamado & { id: string }>()).results;
    if (!linhas.length) return;
    await db.batch(linhas.map(linha => {
      const dados = dadosBuscaChamado(linha);
      return db.prepare(GRAVAR_BUSCA_CHAMADO_SQL).bind(dados.searchText, dados.supplierSort, linha.id, linha.code, linha.supplier_name, linha.city, linha.state);
    }));
  }
}
export function filtroChamados(params: URLSearchParams) {
  const conditions: string[] = [], values: unknown[] = [];
  const grupos: Record<string, string[]> = { ativos: ['aberto', 'aguardando_fornecedor'], fechados: ['fechado'], cancelados: ['cancelado'] };
  const grupo = params.get('group');
  if (grupo && grupos[grupo]) {
    conditions.push(`t.status IN (${grupos[grupo].map(() => '?').join(',')})`);
    values.push(...grupos[grupo]);
  }
  const q = textoBusca(params.get('q'));
  if (q) { conditions.push('instr(t.search_text,?)>0'); values.push(q); }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}
export const COLUNAS_ORDENACAO_CHAMADOS = ['code', 'supplier', 'priority', 'status', 'elapsed', 'requester'] as const;
export function ordemChamados(params: URLSearchParams, agora = new Date()) {
  const colunas: Record<string, string> = {
    code: "CAST(substr(t.code,instr(t.code,'-')+1) AS INTEGER)",
    supplier: 't.supplier_sort',
    priority: "CASE t.priority WHEN 'alta' THEN 1 WHEN 'media' THEN 2 WHEN 'baixa' THEN 3 ELSE 9 END",
    status: "CASE t.status WHEN 'aberto' THEN 'Aberto' WHEN 'aguardando_fornecedor' THEN 'Aguardando fornecedor' WHEN 'cancelado' THEN 'Cancelado' WHEN 'fechado' THEN 'Fechado' ELSE t.status END",
    elapsed: '(julianday(COALESCE(t.closed_at,?))-julianday(t.created_at))',
    requester: "COALESCE(r.name,'') COLLATE NOCASE",
  };
  const coluna = params.get('sort');
  if (!coluna || !COLUNAS_ORDENACAO_CHAMADOS.some(chave => chave === coluna)) return { sql: 't.updated_at DESC,t.id DESC', values: [] as unknown[] };
  const direcao = params.get('direction') === 'desc' ? 'DESC' : 'ASC';
  return { sql: `${colunas[coluna]} ${direcao},t.updated_at DESC,t.id DESC`, values: coluna === 'elapsed' ? [agora.toISOString()] : [] };
}
