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
function validarNotificacao(texto: string, link: string) {
  if (!link.startsWith('/') || link.startsWith('//') || link.includes('\u005c') || /[\r\n\t]/.test(link)) throw new Error('Link da notificação inválido.');
  const mensagem = texto.trim();
  if (!mensagem) throw new Error('Texto da notificação inválido.');
  return mensagem.length > 300 ? `${mensagem.slice(0, 299)}…` : mensagem;
}

export function prepararNotificacaoUsuario({ destinatario, tipo, texto, link, timestamp = now() }: {
  destinatario: string; tipo: string; texto: string; link: string; timestamp?: string;
}) {
  return prepararNotificacaoCondicional({ tipo, texto, textoSql:'?', link, timestamp, origem:'(SELECT 1)', destinatarioSql:'?', valoresDestinatario:[destinatario], condicao:'1=1', valoresTexto:[texto] });
}

export function prepararNotificacaoCondicional({ tipo, texto, textoSql, link, timestamp = now(), origem, destinatarioSql, valoresDestinatario = [], condicao, valores = [], valoresTexto = [] }: {
  tipo: string; texto: string; textoSql: string; link: string; timestamp?: string; origem: string; destinatarioSql: string; valoresDestinatario?: unknown[]; condicao: string; valores?: unknown[]; valoresTexto?: unknown[];
}) {
  validarNotificacao(texto, link);
  return rawDb().prepare(`INSERT INTO notificacoes_usuario(id,user_id,tipo,texto,link,criada_em)
    SELECT ?,n.user_id,?,CASE WHEN length(n.texto)>300 THEN substr(n.texto,1,299)||'…' ELSE n.texto END,?,?
    FROM (SELECT ${destinatarioSql} user_id,${textoSql} texto FROM ${origem} WHERE ${condicao}) n`)
    .bind(id('ntf'), tipo, link, timestamp, ...valoresDestinatario, ...valoresTexto, ...valores);
}
