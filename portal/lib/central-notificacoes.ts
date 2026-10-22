import { id, now, rawDb } from './database.ts';

export const SCHEMA_CENTRAL = [
  `CREATE TABLE IF NOT EXISTS notificacoes_usuario (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL, texto TEXT NOT NULL, link TEXT NOT NULL,
    criada_em TEXT NOT NULL, lida_em TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_central_nao_lidas ON notificacoes_usuario(user_id) WHERE lida_em IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_central_recentes ON notificacoes_usuario(user_id,criada_em DESC,id DESC)`,
];

// Retorna uma instrucao, sem executar: o produtor a inclui no lote da causa.
export function prepararNotificacaoUsuario({ destinatario, tipo, texto, link, timestamp = now() }: {
  destinatario: string; tipo: string; texto: string; link: string; timestamp?: string;
}) {
  if (!link.startsWith('/') || link.startsWith('//') || link.includes('\u005c') || /[\r\n\t]/.test(link)) throw new Error('Link da notificação inválido.');
  if (!texto.trim() || texto.length > 300) throw new Error('Texto da notificação inválido.');
  return rawDb().prepare(`INSERT INTO notificacoes_usuario(id,user_id,tipo,texto,link,criada_em) VALUES(?,?,?,?,?,?)`)
    .bind(id('ntf'), destinatario, tipo, texto, link, timestamp);
}
