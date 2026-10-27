import type { ContextoApi, User } from './api-compartilhada.ts';
import { comAcaoEscrita } from './autor-escrita.ts';

export function centralApi({ rawDb, all, first, now, ok, fail }: ContextoApi) {
  const colunas = 'id,tipo,texto,link,criada_em,lida_em';
  async function listar(user: User, params: URLSearchParams) {
    const cursorData = params.get('cursorData'), cursorId = params.get('cursorId');
    const pagina = cursorData && cursorId
      ? await all(`SELECT ${colunas} FROM notificacoes_usuario WHERE user_id=? AND (criada_em<? OR (criada_em=? AND id<?)) ORDER BY criada_em DESC,id DESC LIMIT 31`, [user.id, cursorData, cursorData, cursorId])
      : await all(`SELECT ${colunas} FROM notificacoes_usuario WHERE user_id=? ORDER BY criada_em DESC,id DESC LIMIT 31`, [user.id]);
    const notificacoes = pagina.slice(0, 30);
    const ultima = notificacoes.at(-1);
    return ok({ notificacoes, temAnteriores: pagina.length > 30, proximoCursor: pagina.length > 30 && ultima ? { criada_em: ultima.criada_em, id: ultima.id } : null });
  }
  async function contar(user: User) {
    return ok({ naoLidas: Number((await first<{ n: number }>('SELECT COUNT(*) n FROM notificacoes_usuario WHERE user_id=? AND lida_em IS NULL', [user.id]))?.n || 0) });
  }
  async function detalhe(user: User, id: string) {
    const notificacao = await first(`SELECT ${colunas} FROM notificacoes_usuario WHERE id=? AND user_id=?`, [id, user.id]);
    return notificacao ? ok({ notificacao }) : fail('Notificação não encontrada.', 404);
  }
  async function marcar(user: User, id?: string) {
    const resultado = await comAcaoEscrita('central:marcar', () => rawDb().prepare(
      `UPDATE notificacoes_usuario SET lida_em=COALESCE(lida_em,?) WHERE user_id=?${id ? ' AND id=?' : ' AND lida_em IS NULL'}`,
    ).bind(now(), user.id, ...(id ? [id] : [])).run());
    if (id && !resultado.meta.changes) return fail('Notificação não encontrada.', 404);
    return ok({ success: true });
  }
  return { listar, contar, detalhe, marcar };
}
