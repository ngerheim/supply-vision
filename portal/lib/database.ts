import { passwordHash, tokenHash, PBKDF2_ITERACOES_ATUAL, PBKDF2_ITERACOES_LEGADO } from './criptografia.ts';
export { passwordHash, tokenHash, PBKDF2_ITERACOES_ATUAL, PBKDF2_ITERACOES_LEGADO } from './criptografia.ts';
import { parseCookies } from './cookies.ts';
export { parseCookies } from './cookies.ts';
import { env } from 'cloudflare:workers';
import { type Role, validatePassword } from '@/lib/domain';

// Duas horas parado encerra a sessao, mesmo dentro das 12h de validade.
export const SESSAO_INATIVIDADE_MS = 2 * 60 * 60 * 1000;

export { normalizeCnpj, normalizeText } from '@/lib/domain';

const schema = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, legal_name TEXT NOT NULL, trade_name TEXT NOT NULL, cnpj TEXT NOT NULL UNIQUE, city TEXT, state TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, city TEXT NOT NULL, state TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_city_state ON locations(city, state)`,
  `CREATE TABLE IF NOT EXISTS catalog_items (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, category TEXT, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS vehicle_models (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS units (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS import_item_mappings (id TEXT PRIMARY KEY, source_text TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE, target_id TEXT NOT NULL REFERENCES catalog_items(id), active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_import_item_mappings_target ON import_item_mappings(target_id)`,
  `CREATE TABLE IF NOT EXISTS import_model_mappings (id TEXT PRIMARY KEY, source_text TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE, target_id TEXT NOT NULL REFERENCES vehicle_models(id), active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_import_model_mappings_target ON import_model_mappings(target_id)`,
  `CREATE TABLE IF NOT EXISTS import_unit_mappings (id TEXT PRIMARY KEY, source_text TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE, target_id TEXT NOT NULL REFERENCES units(id), active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_import_unit_mappings_target ON import_unit_mappings(target_id)`,
  `CREATE TABLE IF NOT EXISTS import_location_mappings (id TEXT PRIMARY KEY, source_text TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE, target_id TEXT NOT NULL REFERENCES locations(id), active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_import_location_mappings_target ON import_location_mappings(target_id)`,
  `CREATE TABLE IF NOT EXISTS agreements (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id), status TEXT NOT NULL DEFAULT 'active', start_date TEXT NOT NULL, end_date TEXT, owner_user_id TEXT REFERENCES users(id), notes TEXT, provisional INTEGER NOT NULL DEFAULT 0, current_version_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_agreements_supplier_status ON agreements(supplier_id, status)`,
  `CREATE TABLE IF NOT EXISTS agreement_locations (agreement_id TEXT NOT NULL REFERENCES agreements(id), location_id TEXT NOT NULL REFERENCES locations(id), PRIMARY KEY(agreement_id, location_id))`,
  `CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, agreement_id TEXT REFERENCES agreements(id), filename TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, total_rows INTEGER NOT NULL DEFAULT 0, valid_rows INTEGER NOT NULL DEFAULT 0, error_rows INTEGER NOT NULL DEFAULT 0, summary_json TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL, completed_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_imports_agreement_created ON imports(agreement_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS agreement_versions (id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES agreements(id), version_number INTEGER NOT NULL, import_id TEXT REFERENCES imports(id), status TEXT NOT NULL DEFAULT 'published', published_at TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(agreement_id, version_number))`,
  `CREATE TABLE IF NOT EXISTS agreement_items (id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES agreement_versions(id), location_id TEXT NOT NULL REFERENCES locations(id), catalog_item_id TEXT NOT NULL REFERENCES catalog_items(id), vehicle_model_id TEXT NOT NULL REFERENCES vehicle_models(id), unit_id TEXT NOT NULL REFERENCES units(id), price REAL NOT NULL CHECK(price >= 0), courtesy INTEGER NOT NULL DEFAULT 0, brands_text TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(version_id, location_id, catalog_item_id, vehicle_model_id, unit_id))`,
  `CREATE INDEX IF NOT EXISTS idx_agreement_items_search ON agreement_items(catalog_item_id, vehicle_model_id, location_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agreement_items_version ON agreement_items(version_id)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, details TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, supplier_name TEXT NOT NULL, cnpj TEXT, city TEXT, state TEXT, contact TEXT, scope TEXT, priority TEXT NOT NULL DEFAULT 'media', status TEXT NOT NULL DEFAULT 'aberto', requested_by TEXT REFERENCES users(id), assigned_to TEXT REFERENCES users(id), agreement_id TEXT REFERENCES agreements(id), notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ticket_events (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id), user_id TEXT REFERENCES users(id), kind TEXT NOT NULL, from_status TEXT, to_status TEXT, message TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_ticket_events ON ticket_events(ticket_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS email_notifications (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id), event_id TEXT NOT NULL, type TEXT NOT NULL, recipient_name TEXT NOT NULL, recipient_email TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, locked_at TEXT, sent_at TEXT, last_error TEXT, dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_email_notifications_queue ON email_notifications(status, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS idx_email_notifications_ticket ON email_notifications(ticket_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS daily_report_deliveries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), report_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, locked_at TEXT, sent_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,report_date))`,
  `CREATE INDEX IF NOT EXISTS idx_daily_report_queue ON daily_report_deliveries(status,next_attempt_at)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (id TEXT PRIMARY KEY, ip TEXT NOT NULL, email TEXT, success INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  // Exclusao mutua garantida pelo banco. A chave e fixa ('importacao'), entao
  // o INSERT do segundo concorrente viola a PRIMARY KEY e falha -- diferente
  // de consultar e depois inserir, que deixa os dois passarem pela janela
  // entre as duas operacoes.
  `CREATE TABLE IF NOT EXISTS travas (chave TEXT PRIMARY KEY, dono TEXT, adquirida_em TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
];

// CREATE TABLE IF NOT EXISTS nao altera tabelas que ja existem. Colunas novas
// precisam entrar aqui, senao bancos antigos ficam sem elas e as consultas
// quebram. Cada entrada roda uma unica vez e ignora erro de coluna duplicada.
const columnMigrations: Array<[string, string, string]> = [
  ['suppliers', 'city', 'TEXT'],
  ['suppliers', 'state', 'TEXT'],
  // Custo do PBKDF2 usado em cada senha. O padrao e o valor legado, porque
  // toda senha que ja existe foi gerada com ele.
  ['users', 'password_iterations', `INTEGER NOT NULL DEFAULT ${PBKDF2_ITERACOES_LEGADO}`],
  // Ultima atividade da sessao, para expirar por inatividade alem do prazo fixo.
  ['sessions', 'last_seen_at', 'TEXT'],
  ['users', 'daily_report_enabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'daily_report_time', "TEXT NOT NULL DEFAULT '17:45'"],
];

async function applyColumnMigrations() {
  for (const [table, column, type] of columnMigrations) {
    let info: { results?: Array<{ name: string }> };
    try {
      info = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    } catch {
      // Tabela ainda nao existe nesta base: nada a migrar.
      continue;
    }
    if ((info.results || []).some((c) => c.name === column)) continue;
    try {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
    } catch (erro) {
      // Coluna criada em paralelo por outra instancia e resultado aceitavel.
      // Qualquer outra falha precisa aparecer AGORA: engolindo tudo, uma
      // coluna que nunca foi criada so se manifestava depois, como erro de
      // consulta em producao.
      const mensagem = String((erro as Error)?.message || '').toLowerCase();
      if (!mensagem.includes('duplicate column')) throw erro;
    }
  }
}

export const rawDb = () => env.DB;

const hex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (length = 16) => { const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return hex(bytes); };
export const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export const now = () => new Date().toISOString();

let ready: Promise<void> | null = null;
export const MEDIDAS_PADRAO = ['UNIDADE', 'LITRO', 'PAR', 'JOGO', 'HORA'] as const;

export function ensureDatabase() {
  // A promise era memorizada mesmo quando falhava: uma unica falha na subida
  // -- base vazia sem INITIAL_ADMIN_PASSWORD, erro transitorio do D1 -- fazia
  // TODA requisicao seguinte reaproveitar a promise rejeitada ate o processo
  // reiniciar. Zerando aqui, a proxima requisicao tenta de novo.
  if (!ready) {
    ready = initialize().catch((erro) => {
      ready = null;
      throw erro;
    });
  }
  return ready;
}

async function initialize() {
  const db = rawDb();
  await db.batch(schema.map((sql) => db.prepare(sql)));
  await applyColumnMigrations();
  const existing = await db.prepare('SELECT id FROM users LIMIT 1').first();
  if (!existing) {
    const initialPassword = (env as unknown as { INITIAL_ADMIN_PASSWORD?: string }).INITIAL_ADMIN_PASSWORD;
    if (typeof initialPassword !== 'string' || !validatePassword(initialPassword)) {
      throw new Error('Base vazia: defina INITIAL_ADMIN_PASSWORD com pelo menos 10 caracteres antes do primeiro acesso.');
    }
    const salt = randomHex();
    const hash = await passwordHash(initialPassword, salt, PBKDF2_ITERACOES_ATUAL);
    const userId = id('usr');
    await db.batch([
      // password_iterations PRECISA ser gravado aqui. Sem ele a coluna assume o
      // padrao legado (120 mil) enquanto o hash foi calculado com 600 mil, e o
      // primeiro login de uma instalacao nova nunca funcionaria.
      db.prepare('INSERT INTO users (id,name,email,password_salt,password_hash,password_iterations,role,active,created_at) VALUES (?,?,?,?,?,?,?,1,?)').bind(userId, 'Administrador Local', 'admin@portal.local', salt, hash, PBKDF2_ITERACOES_ATUAL, 'admin', now()),
      db.prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)').bind(id('aud'), userId, 'CREATE', 'system', null, 'Base local inicializada', now()),
    ]);
  }
  // As medidas padrao sao infraestrutura, nao cadastro do usuario: sem elas a
  // importacao nao resolve MEDIDA nenhuma. Antes eram semeadas so na instalacao
  // nova, entao apagar uma era definitivo — e a conferencia assistida passava a
  // oferecer outra medida no lugar, gravando preco de par como preco de unidade.
  // Recriar a cada carga devolve o conjunto sem tocar no que ja existe.
  await db.batch(MEDIDAS_PADRAO.map((code) => db.prepare('INSERT OR IGNORE INTO units (id,code,name,active) VALUES (?,?,?,1)').bind(id('unt'), code, code)));
  await db.prepare('INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (1,?)').bind(now()).run();
  const prefixoMigrado = await db.prepare('SELECT 1 ok FROM schema_migrations WHERE version=2').first();
  if (!prefixoMigrado) {
    await db.batch([
      db.prepare("UPDATE tickets SET code='SUP-' || substr(code,4) WHERE code LIKE 'CH-%'"),
      db.prepare('INSERT INTO schema_migrations (version,applied_at) VALUES (2,?)').bind(now()),
    ]);
  }
  const relatorioConfigurado = await db.prepare('SELECT 1 ok FROM schema_migrations WHERE version=3').first();
  if (!relatorioConfigurado) {
    await db.batch([
      db.prepare('INSERT INTO schema_migrations (version,applied_at) VALUES (3,?)').bind(now()),
    ]);
  }
  await db.prepare('PRAGMA optimize').run();
}


export async function currentUser(request: Request) {
  await ensureDatabase();
  const token = parseCookies(request).acordos_session;
  if (!token) return null;

  // O banco guarda o hash, nunca o token.
  const guardado = await tokenHash(token);
  const agora = now();
  const sessao = await rawDb().prepare(
    `SELECT u.id,u.name,u.email,u.role,s.last_seen_at AS lastSeenAt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.active=1`
  ).bind(guardado, agora).first<{ id: string; name: string; email: string; role: Role; lastSeenAt: string | null }>();
  if (!sessao) return null;

  // Expiracao por inatividade, alem do prazo maximo de 12h: uma sessao
  // esquecida aberta numa maquina compartilhada deixa de valer sozinha.
  const visto = sessao.lastSeenAt ? Date.parse(sessao.lastSeenAt) : 0;
  if (visto && Date.now() - visto > SESSAO_INATIVIDADE_MS) {
    await rawDb().prepare('DELETE FROM sessions WHERE token=?').bind(guardado).run();
    return null;
  }

  // Registra a atividade no maximo uma vez por minuto, para nao gravar no
  // banco a cada requisicao da tela.
  if (!visto || Date.now() - visto > 60000) {
    await rawDb().prepare('UPDATE sessions SET last_seen_at=? WHERE token=?').bind(agora, guardado).run();
  }
  return { id: sessao.id, name: sessao.name, email: sessao.email, role: sessao.role };
}

export async function audit(userId: string | null, action: string, entity: string, entityId: string | null, details: string) {
  await rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)').bind(id('aud'), userId, action, entity, entityId, details, now()).run();
}

// Trava de exclusao mutua garantida pelo banco.
//
// O portal permite uma importacao por vez, porque cada uma custa ~96 MB de
// RSS (medido em scripts/medir-concorrencia-importacao.mjs) e o teto de
// expansao limita cada requisicao, nao a soma delas.
//
// A versao anterior consultava "existe alguma em processing?" e so entao
// inseria. Isso e uma corrida: duas requisicoes podem consultar ao mesmo
// tempo, ambas ver o banco livre, e ambas seguir. Aqui a exclusividade vem da
// PRIMARY KEY: quem insere primeiro ganha, o segundo recebe erro de UNIQUE.

export const TRAVA_IMPORTACAO = 'importacao';
// Uma importacao real leva segundos. 30 min so cobre o processo que morreu no
// meio sem liberar.
const TRAVA_VALIDADE_MS = 30 * 60 * 1000;

export async function adquirirTrava(chave: string, dono: string): Promise<boolean> {
  const agora = now();
  const db = rawDb();

  try {
    await db.prepare('INSERT INTO travas (chave,dono,adquirida_em) VALUES (?,?,?)')
      .bind(chave, dono, agora).run();
    return true;
  } catch (erro) {
    if (!String((erro as Error)?.message || '').includes('UNIQUE')) throw erro;
  }

  // Ja existe trava. Pode ser legitima (outra importacao rodando) ou orfa (o
  // processo morreu). O UPDATE condicional resolve as duas de uma vez: a
  // condicao adquirida_em < limite faz parte da PROPRIA escrita, entao dois
  // concorrentes tentando recuperar a mesma trava vencida nao passam juntos --
  // o primeiro muda a linha e o segundo nao encontra mais o que atualizar.
  const limite = new Date(Date.now() - TRAVA_VALIDADE_MS).toISOString();
  const r = await db.prepare(
    'UPDATE travas SET dono=?, adquirida_em=? WHERE chave=? AND adquirida_em < ?',
  ).bind(dono, agora, chave, limite).run();

  return (r.meta?.changes ?? 0) > 0;
}

export async function liberarTrava(chave: string, dono: string) {
  // So o dono libera: uma requisicao que perdeu a corrida nao pode soltar a
  // trava de quem esta trabalhando.
  await rawDb().prepare('DELETE FROM travas WHERE chave=? AND dono=?').bind(chave, dono).run();
}
