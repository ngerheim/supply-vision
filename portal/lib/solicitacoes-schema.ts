// O numero nasce no INSERT transacional: recusas e rollback nao consomem SOL.
export const SCHEMA_SOLICITACOES = [
  `CREATE TABLE IF NOT EXISTS solicitacoes (
    sequencia INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    codigo TEXT GENERATED ALWAYS AS ('SOL-' || sequencia) STORED UNIQUE,
    tipo TEXT NOT NULL DEFAULT 'cadastro_fornecedor' CHECK(tipo='cadastro_fornecedor'),
    cnpj TEXT NOT NULL CHECK(length(cnpj)=14 AND cnpj NOT GLOB '*[^0-9]*'),
    razao_social TEXT NOT NULL, nome_fantasia TEXT, situacao_cadastral TEXT,
    cnae_codigo TEXT, cnae_descricao TEXT, consulta_fonte TEXT, consultada_em TEXT,
    nao_verificado INTEGER NOT NULL CHECK(nao_verificado IN (0,1)),
    logradouro TEXT, numero TEXT, complemento TEXT, bairro TEXT, cidade TEXT, uf TEXT, cep TEXT,
    telefone TEXT, email TEXT, atendimento_cidade TEXT, atendimento_uf TEXT,
    urgencia TEXT NOT NULL CHECK(urgencia IN ('normal','urgente')),
    status TEXT NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta','em_analise','devolvida','cadastrado','recusado')),
    solicitante_id TEXT NOT NULL REFERENCES users(id), atendente_id TEXT REFERENCES users(id), motivo_recusa TEXT,
    criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
    request_key TEXT, request_hash TEXT, UNIQUE(solicitante_id,request_key))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitacao_cnpj_aberta ON solicitacoes(cnpj) WHERE status IN ('aberta','em_analise','devolvida')`,
  `CREATE INDEX IF NOT EXISTS idx_solicitacoes_atualizacao ON solicitacoes(atualizado_em DESC,id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_solicitacoes_solicitante ON solicitacoes(solicitante_id,atualizado_em DESC,id DESC)`,
  `CREATE TABLE IF NOT EXISTS solicitacao_andamentos (
    id TEXT PRIMARY KEY, solicitacao_id TEXT NOT NULL REFERENCES solicitacoes(id), user_id TEXT NOT NULL REFERENCES users(id),
    de_status TEXT, para_status TEXT NOT NULL, texto TEXT, criado_em TEXT NOT NULL,
    request_key TEXT, request_hash TEXT, UNIQUE(solicitacao_id,user_id,request_key))`,
  `CREATE INDEX IF NOT EXISTS idx_solicitacao_andamentos ON solicitacao_andamentos(solicitacao_id,criado_em,id)`,
  `CREATE TRIGGER IF NOT EXISTS solicitacao_andamentos_imutavel_update BEFORE UPDATE ON solicitacao_andamentos
    BEGIN SELECT RAISE(ABORT,'Andamentos sao imutaveis'); END`,
  `CREATE TRIGGER IF NOT EXISTS solicitacao_andamentos_imutavel_delete BEFORE DELETE ON solicitacao_andamentos
    BEGIN SELECT RAISE(ABORT,'Andamentos sao imutaveis'); END`,
  `CREATE TABLE IF NOT EXISTS categorias_fornecedor (id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE COLLATE NOCASE, nome_chave TEXT NOT NULL UNIQUE,
    ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0,1)), revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS solicitacao_categorias (solicitacao_id TEXT NOT NULL REFERENCES solicitacoes(id),
    categoria_id TEXT NOT NULL REFERENCES categorias_fornecedor(id), PRIMARY KEY(solicitacao_id,categoria_id))`,
  `CREATE TABLE IF NOT EXISTS consultas_cnpj (id TEXT PRIMARY KEY, cnpj TEXT NOT NULL, fonte TEXT NOT NULL,
    dados_json TEXT NOT NULL, consultada_em TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id))`,
  `CREATE INDEX IF NOT EXISTS idx_consultas_cnpj_data ON consultas_cnpj(consultada_em)`,
  ...['Oficina', 'Auto elétrica', 'Reboque'].map((nome, i) =>
    `INSERT OR IGNORE INTO categorias_fornecedor(id,nome,nome_chave) VALUES('categoria_semente_${i+1}','${nome}','${nome.toUpperCase()}')`),
];
