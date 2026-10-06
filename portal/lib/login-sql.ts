// A sessao so nasce se a conta ainda corresponde ao snapshot autenticado.
export const CRIAR_SESSAO_AUTENTICADA_SQL = `INSERT INTO sessions (token,user_id,expires_at,last_seen_at)
 SELECT ?,id,?,? FROM users WHERE id=? AND active=1 AND revision=? AND password_salt=? AND password_hash=?`;
export const MIGRAR_SENHA_AUTENTICADA_SQL = `UPDATE users SET password_salt=?,password_hash=?,password_iterations=?
 WHERE id=? AND active=1 AND revision=? AND password_salt=? AND password_hash=?
 AND EXISTS (SELECT 1 FROM sessions WHERE token=? AND user_id=users.id)`;
