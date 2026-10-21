import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { localizarBanco } from './banco-local.mjs';
import { PBKDF2_ITERACOES_LEGADO } from '../lib/criptografia.ts';

export function listarUsuariosLegados(arquivo = localizarBanco()) {
  if (!arquivo) throw new Error('Banco local nao encontrado.');
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const colunas = tabela => new Set(db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name));
    const usuarios = colunas('users'), sessoes = colunas('sessions'), acessos = colunas('login_attempts');
    const fontes = [];
    if (sessoes.has('last_seen_at')) fontes.push('SELECT last_seen_at acesso FROM sessions WHERE user_id=u.id');
    if (acessos.has('success')) fontes.push('SELECT created_at acesso FROM login_attempts WHERE lower(email)=lower(u.email) AND success=1');
    const ultimo = fontes.length ? `(SELECT MAX(acesso) FROM (${fontes.join(' UNION ALL ')}))` : 'NULL';
    const filtro = usuarios.has('password_iterations') ? 'u.password_iterations=?' : '?=?';
    return db.prepare(`SELECT u.name nome,u.role perfil,u.active ativo,${ultimo} ultimoAcesso FROM users u WHERE ${filtro} ORDER BY u.name,u.id`)
      .all(...(usuarios.has('password_iterations') ? [PBKDF2_ITERACOES_LEGADO] : [PBKDF2_ITERACOES_LEGADO, PBKDF2_ITERACOES_LEGADO]))
      .map(u => ({ ...u, nome: String(u.nome).replace(/[^\s<>]+@[^\s<>]+/g, '[email omitido]').replace(/[\r\n\t]/g, ' '), ativo: u.ativo === 1 }));
  } finally { db.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const usuarios = listarUsuariosLegados();
    console.log('Nome | Perfil | Ativo | Ultimo acesso conhecido');
    for (const u of usuarios) console.log(`${u.nome} | ${u.perfil} | ${u.ativo ? 'Sim' : 'Nao'} | ${u.ultimoAcesso || 'indisponivel'}`);
    if (!usuarios.length) console.log('Nenhum usuario com iteracoes legadas.');
  } catch (erro) { console.error(erro.message); process.exitCode = 1; }
}
