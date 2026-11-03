/** Desde a 3.4.3 a solicitacao pede so o link e os anexos; os demais campos
 * ficam opcionais para manter as solicitacoes antigas. */
export const ddlPagamentos = (tabela: string) => `CREATE TABLE IF NOT EXISTS ${tabela} (
    sequencia INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    codigo TEXT GENERATED ALWAYS AS ('PAG-' || printf('%04d',sequencia)) STORED UNIQUE,
    fornecedor TEXT CHECK(fornecedor IS NULL OR length(fornecedor) BETWEEN 1 AND 120), cnpj TEXT,
    numero_oc TEXT CHECK(numero_oc IS NULL OR length(numero_oc) BETWEEN 1 AND 40), numero_nf TEXT CHECK(numero_nf IS NULL OR length(numero_nf) BETWEEN 1 AND 40),
    valor_centavos INTEGER CHECK(valor_centavos IS NULL OR valor_centavos>0), vencimento TEXT, link TEXT CHECK(link IS NULL OR (length(link)<=500 AND link LIKE 'https://%')),
    observacao TEXT CHECK(observacao IS NULL OR length(observacao)<=1000), status TEXT NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta','em_analise','paga','recusada')),
    motivo_recusa TEXT, solicitante_id TEXT NOT NULL REFERENCES users(id), atendente_id TEXT REFERENCES users(id), criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, request_key TEXT, request_hash TEXT, UNIQUE(solicitante_id,request_key))`;
export const ddlPagamentoAnexos = (tabela: string, pai: string) => `CREATE TABLE IF NOT EXISTS ${tabela} (id TEXT PRIMARY KEY, pagamento_id TEXT NOT NULL REFERENCES ${pai}(id), tipo TEXT NOT NULL CHECK(tipo IN ('oc','nf')),
    nome_arquivo TEXT NOT NULL CHECK(length(nome_arquivo)<=120), mime TEXT NOT NULL, tamanho INTEGER NOT NULL, sha256 TEXT NOT NULL, conteudo BLOB NOT NULL, criado_em TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), UNIQUE(pagamento_id,tipo))`;
export const ddlPagamentoAndamentos = (tabela: string, pai: string) => `CREATE TABLE IF NOT EXISTS ${tabela} (id TEXT PRIMARY KEY, pagamento_id TEXT NOT NULL REFERENCES ${pai}(id), user_id TEXT NOT NULL REFERENCES users(id),
    de_status TEXT, para_status TEXT NOT NULL, texto TEXT, criado_em TEXT NOT NULL, request_key TEXT, request_hash TEXT, UNIQUE(pagamento_id,user_id,request_key))`;
/** Indices e gatilhos das tres tabelas, ja com os nomes finais. */
export const COMPLEMENTOS_PAGAMENTOS = [
  `CREATE INDEX IF NOT EXISTS idx_pagamentos_status_atualizado ON pagamentos(status,atualizado_em DESC,id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_pagamentos_solicitante ON pagamentos(solicitante_id,atualizado_em DESC,id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_pagamento_andamentos ON pagamento_andamentos(pagamento_id,criado_em,id)`,
  `CREATE TRIGGER IF NOT EXISTS pagamento_andamentos_imutavel_update BEFORE UPDATE ON pagamento_andamentos BEGIN SELECT RAISE(ABORT,'Andamentos sao imutaveis'); END`,
  `CREATE TRIGGER IF NOT EXISTS pagamento_andamentos_imutavel_delete BEFORE DELETE ON pagamento_andamentos BEGIN SELECT RAISE(ABORT,'Andamentos sao imutaveis'); END`,
];
export const SCHEMA_PAGAMENTOS = [
  ddlPagamentos('pagamentos'),
  ddlPagamentoAnexos('pagamento_anexos', 'pagamentos'),
  ddlPagamentoAndamentos('pagamento_andamentos', 'pagamentos'),
  ...COMPLEMENTOS_PAGAMENTOS,
];
