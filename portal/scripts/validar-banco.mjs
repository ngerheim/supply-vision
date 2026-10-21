import { DatabaseSync } from 'node:sqlite';

// Identidade minima do produto, sem exigir colunas adicionadas por migracoes.
// Backups antigos validos podem ser migrados ao iniciar a versao compativel.
const estrutura = {
  users: ['id', 'email', 'password_hash', 'password_salt', 'role', 'active'],
  tickets: ['id', 'code', 'status'],
  agreements: ['id', 'number', 'supplier_id', 'start_date'],
  agreement_items: ['id', 'version_id', 'price'],
  suppliers: ['id', 'cnpj', 'legal_name'],
  catalog_items: ['id', 'name'],
  units: ['id', 'code'],
  email_notifications: ['id', 'status', 'locked_at', 'last_error', 'updated_at'],
};

export function validarBanco(arquivo) {
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const resultados = db.prepare('PRAGMA integrity_check').all();
    if (resultados.length !== 1 || Object.values(resultados[0])[0] !== 'ok') throw new Error('Integridade do banco reprovada.');
    const tabelas = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(l => l.name));
    const totais = {};
    for (const [tabela, obrigatorias] of Object.entries(estrutura)) {
      if (!tabelas.has(tabela)) throw new Error(`Banco nao reconhecido: tabela ausente ${tabela}.`);
      const colunas = new Set(db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name));
      const faltando = obrigatorias.filter(c => !colunas.has(c));
      if (faltando.length) throw new Error(`Estrutura incompativel em ${tabela}: ${faltando.join(', ')}.`);
      totais[tabela] = Number(db.prepare(`SELECT COUNT(*) total FROM ${tabela}`).get().total);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Banco possui referencias orfas (foreign_key_check).');
    return totais;
  } finally { db.close(); }
}
