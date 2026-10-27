// A sequencia e gerada no mesmo INSERT da abertura e revertida no rollback.
export const SCHEMA_BAIXAS = [
  `CREATE TABLE IF NOT EXISTS estoques (id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nome_chave TEXT NOT NULL UNIQUE, ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0,1)), revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS baixas_estoque (
    sequencia INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    codigo TEXT GENERATED ALWAYS AS ('BX-' || sequencia) STORED UNIQUE,
    numero_os TEXT NOT NULL CHECK(length(numero_os) BETWEEN 1 AND 20 AND numero_os NOT GLOB '*[^0-9]*'),
    estoque_id TEXT NOT NULL REFERENCES estoques(id),
    placa TEXT NOT NULL CHECK(placa GLOB '[A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9]' OR placa GLOB '[A-Z][A-Z][A-Z][0-9][A-Z][0-9][0-9]'),
    status TEXT NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta','baixada','recusada')),
    solicitante_id TEXT NOT NULL REFERENCES users(id), atendente_id TEXT REFERENCES users(id), motivo_recusa TEXT,
    criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
    request_key TEXT, request_hash TEXT, UNIQUE(solicitante_id,request_key))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_baixa_os_aberta ON baixas_estoque(numero_os) WHERE status='aberta'`,
  `CREATE INDEX IF NOT EXISTS idx_baixas_atualizacao ON baixas_estoque(atualizado_em DESC,id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_baixas_solicitante ON baixas_estoque(solicitante_id,atualizado_em DESC,id DESC)`,
  `CREATE TABLE IF NOT EXISTS baixa_andamentos (id TEXT PRIMARY KEY, baixa_id TEXT NOT NULL REFERENCES baixas_estoque(id),
    user_id TEXT NOT NULL REFERENCES users(id), de_status TEXT, para_status TEXT NOT NULL, texto TEXT, criado_em TEXT NOT NULL,
    request_key TEXT, request_hash TEXT, UNIQUE(baixa_id,user_id,request_key))`,
  `CREATE INDEX IF NOT EXISTS idx_baixa_andamentos ON baixa_andamentos(baixa_id,criado_em,id)`,
  `CREATE TRIGGER IF NOT EXISTS baixa_andamentos_imutavel_update BEFORE UPDATE ON baixa_andamentos BEGIN SELECT RAISE(ABORT,'Andamentos sao imutaveis'); END`,
  `CREATE TRIGGER IF NOT EXISTS baixa_andamentos_imutavel_delete BEFORE DELETE ON baixa_andamentos BEGIN SELECT RAISE(ABORT,'Andamentos sao imutaveis'); END`,
];
