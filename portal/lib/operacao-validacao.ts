export const SCHEMA_VALIDACAO = `CREATE TABLE IF NOT EXISTS operacao_validacao (id INTEGER PRIMARY KEY CHECK(id=1), ativa INTEGER NOT NULL DEFAULT 0)`;
export const VALIDACAO_ATIVA_SQL = 'SELECT 1 ativa FROM operacao_validacao WHERE id=1 AND ativa=1';
