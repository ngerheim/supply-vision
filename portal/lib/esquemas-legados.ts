// Tabelas das abas Analise e Reembolso, retiradas do Portal em 2026-11-26.
// As migracoes antigas continuam criando-as numa base nova; na base em uso
// os dados ficam preservados (nada e apagado).
export const SCHEMA_ANALISE = [
  `CREATE TABLE IF NOT EXISTS compras_comparadas (
    id INTEGER PRIMARY KEY, data TEXT NOT NULL, grupo TEXT, os TEXT, cidade TEXT, fornecedor TEXT, cnpj TEXT,
    modelo TEXT, item TEXT, qtd REAL, preco_os REAL, preco_acordo REAL, total_os REAL, total_acordo REAL,
    dif_total REAL, status TEXT NOT NULL, motivo TEXT, tinha_acordo INTEGER NOT NULL DEFAULT 0,
    menor_preco REAL, fornecedor_acordo TEXT, dif_menor REAL, recebido_em TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_compras_comparadas_data ON compras_comparadas(data)',
];

export const SCHEMA_ANALISE_ACOES = [
  'CREATE TABLE IF NOT EXISTS analise_parametros (chave TEXT PRIMARY KEY, valor TEXT NOT NULL, atualizado_em TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS analise_acoes (
    id TEXT PRIMARY KEY, chave TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL, titulo TEXT NOT NULL, detalhe TEXT NOT NULL,
    impacto REAL NOT NULL, filtro TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pendente','feita','pulada','rejeitada','encerrada')),
    adiada_ate TEXT, motivo TEXT, criada_em TEXT NOT NULL, atualizada_em TEXT NOT NULL, vista_em TEXT NOT NULL,
    resolvida_em TEXT, resolvida_por TEXT REFERENCES users(id))`,
  'CREATE INDEX IF NOT EXISTS idx_analise_acoes_status ON analise_acoes(status, impacto DESC)',
  `CREATE TABLE IF NOT EXISTS analise_acoes_eventos (
    id TEXT PRIMARY KEY, acao_id TEXT NOT NULL REFERENCES analise_acoes(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id), de TEXT, para TEXT NOT NULL, motivo TEXT, criado_em TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_analise_acoes_eventos_recentes ON analise_acoes_eventos(criado_em DESC)',
];

export const SCHEMA_REEMBOLSO = [
  `CREATE TABLE IF NOT EXISTS reembolso_tabelas (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE COLLATE NOCASE, padrao INTEGER NOT NULL DEFAULT 0 CHECK(padrao IN (0,1)),
    revision INTEGER NOT NULL DEFAULT 0, atualizado_em TEXT NOT NULL)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_reembolso_tabela_padrao ON reembolso_tabelas(padrao) WHERE padrao=1',
  `CREATE TABLE IF NOT EXISTS reembolso_itens (
    id TEXT PRIMARY KEY, tabela_id TEXT NOT NULL REFERENCES reembolso_tabelas(id) ON DELETE CASCADE, ordem INTEGER NOT NULL,
    descricao TEXT NOT NULL, tipo TEXT CHECK(tipo IN ('INTEGRAL','PROPORCIONAL')), valores TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_reembolso_itens_tabela ON reembolso_itens(tabela_id, ordem)',
  `CREATE TABLE IF NOT EXISTS reembolso_clientes (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE COLLATE NOCASE, taxa REAL CHECK(taxa IS NULL OR (taxa>=0 AND taxa<=1)),
    pneu_km INTEGER, observacao TEXT, executivo TEXT, tabela_id TEXT REFERENCES reembolso_tabelas(id),
    ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0,1)), revision INTEGER NOT NULL DEFAULT 0, atualizado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reembolso_calculos (
    id TEXT PRIMARY KEY, placa TEXT, cliente TEXT, taxa REAL NOT NULL, categoria TEXT NOT NULL, modelo TEXT, km_atual INTEGER NOT NULL,
    os_atual TEXT, observacao TEXT, tabela TEXT, itens TEXT NOT NULL, total_custo REAL NOT NULL, total_reembolso REAL NOT NULL, fornecedor TEXT,
    user_id TEXT NOT NULL REFERENCES users(id), criado_em TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_reembolso_calculos_placa ON reembolso_calculos(placa, criado_em DESC)',
  'CREATE INDEX IF NOT EXISTS idx_reembolso_calculos_data ON reembolso_calculos(criado_em DESC, id DESC)',
];

export const SCHEMA_REEMBOLSO_HISTORICO = [
  `CREATE TABLE IF NOT EXISTS reembolso_historico_cache (
    placa TEXT PRIMARY KEY, linhas TEXT NOT NULL, itens INTEGER NOT NULL, consultado_em TEXT NOT NULL, user_id TEXT REFERENCES users(id))`,
  'CREATE INDEX IF NOT EXISTS idx_reembolso_historico_cache_data ON reembolso_historico_cache(consultado_em)',
  // O que nao entra no historico. Valor guardado como digitado e tambem
  // normalizado (sem acento/caixa), que e como a comparacao e feita.
  `CREATE TABLE IF NOT EXISTS reembolso_historico_filtros (
    id TEXT PRIMARY KEY, coluna TEXT NOT NULL CHECK(coluna IN ('grupo','produto','fornecedor','modelo','cliente')),
    modo TEXT NOT NULL CHECK(modo IN ('igual','contem')), valor TEXT NOT NULL, valor_norm TEXT NOT NULL,
    user_id TEXT REFERENCES users(id), criado_em TEXT NOT NULL, UNIQUE(coluna, modo, valor_norm))`,
];
