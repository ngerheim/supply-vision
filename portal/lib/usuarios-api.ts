import { LIMITES_CAMPO, exigeTexto } from './limites-entrada.ts';
import { isOneOf, ROLES, situacaoAtiva, validatePassword, type Role } from './domain.ts';
import { type ContextoApi, type User, textValue, ehErroUnique } from './api-compartilhada.ts';
import { revisaoConfere } from './controle-escrita.ts';
import { auditoriaNoLote } from './auditoria-api.ts';

// A condição usa o estado do banco no instante da escrita, não o snapshot
// consultado pela requisição. Duas desativações não removem o último admin.
export const ATUALIZAR_USUARIO_SQL = `UPDATE users
  SET name=?,role=?,active=?,daily_report_enabled=?,daily_report_time=?,revision=revision+1
  WHERE id=? AND revision=? AND (
    role<>'admin' OR active<>1 OR (?='admin' AND ?=1)
    OR EXISTS (SELECT 1 FROM users outro WHERE outro.role='admin' AND outro.active=1 AND outro.id<>users.id)
  )`;

// Dados cadastrais e credenciais mudam na mesma escrita, sob a mesma guarda.
export const ATUALIZAR_USUARIO_COM_SENHA_SQL = ATUALIZAR_USUARIO_SQL.replace(
  'daily_report_time=?', 'daily_report_time=?,password_salt=?,password_hash=?,password_iterations=?',
);

export const ENCERRAR_SESSOES_REDEFINIDAS_SQL = `DELETE FROM sessions WHERE user_id=? AND changes()=1
  AND EXISTS (SELECT 1 FROM users WHERE id=? AND password_salt=?)`;

// Desativacao ou troca de perfil encerra as sessoes, mas so se a atualizacao
// guardada acima realmente gravou o novo estado (guarda do ultimo admin).
export const ENCERRAR_SESSOES_ALTERADAS_SQL = `DELETE FROM sessions WHERE user_id=? AND changes()=1
  AND EXISTS (SELECT 1 FROM users WHERE id=? AND role=? AND active=?)`;

// Imediatamente depois do UPDATE no mesmo batch: guarda recusada nao gera
// auditoria, e a auditoria passa changes()=1 ao encerramento de sessoes.
export const AUDITAR_USUARIO_SQL = `INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at)
  SELECT ?,?,'UPDATE','user',?,?,? WHERE changes()=1`;

export function usuariosApi(contexto: ContextoApi) {
  const { id, now, rawDb, passwordHash, PBKDF2_ITERACOES_ATUAL, ok, fail, jsonBody, all, first } = contexto;

  type UserInput = { expectedRevision?: unknown; name?: unknown; email?: unknown; password?: unknown; role?: unknown; active?: unknown; dailyReportEnabled?: unknown; dailyReportTime?: unknown };

  async function createUser(request: Request, actor: User) {
    if (actor.role !== 'admin') return fail('Somente administradores podem criar usuários.', 403);
    const body = await jsonBody<UserInput>(request);
    const name = exigeTexto(body.name, LIMITES_CAMPO.nome, 'nome'), email = exigeTexto(body.email, LIMITES_CAMPO.email, 'e-mail').toLowerCase(), role = body.role ?? 'viewer';
    if (!name || !email || typeof body.password !== 'string') return fail('Nome, e-mail e senha são obrigatórios.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Informe um e-mail válido.');
    const passwordError = validatePassword(body.password);
    if (passwordError) return fail(passwordError);
    if (!isOneOf(role, ROLES)) return fail('Perfil de usuário inválido.');
    const salt = crypto.randomUUID(), hash = await passwordHash(body.password, salt, PBKDF2_ITERACOES_ATUAL), userId = id('usr');
    try {
      await rawDb().batch([
        rawDb().prepare('INSERT INTO users (id,name,email,password_salt,password_hash,password_iterations,role,active,created_at) VALUES (?,?,?,?,?,?,?,1,?)').bind(userId, name, email, salt, hash, PBKDF2_ITERACOES_ATUAL, role, now()),
        auditoriaNoLote(contexto, actor.id, 'CREATE', 'user', userId, `Usuário ${email} criado`),
      ]);
      return ok({ id: userId }, { status: 201 });
    } catch (erro: unknown) {
      // So a violacao de UNIQUE e e-mail repetido; o resto e falha real.
      if (ehErroUnique(erro)) return fail('Esse e-mail já está cadastrado.');
      throw erro;
    }
  }

  async function updateUser(request:Request,actor:User,userId:string){
    if(actor.role!=='admin') return fail('Somente administradores podem alterar usuários.',403);
    const body=await jsonBody<UserInput>(request);
    const target=await first<{id:string;name:string;email:string;role:Role;active:number;revision:number;dailyReportEnabled:number;dailyReportTime:string}>('SELECT id,name,email,role,active,revision,daily_report_enabled AS dailyReportEnabled,daily_report_time AS dailyReportTime FROM users WHERE id=?',[userId]);
    if(!target) return fail('Usuário não encontrado.',404);
    const role=body.role === undefined ? target.role : body.role;
    if(!isOneOf(role,ROLES)) return fail('Perfil de usuário inválido.');
    if(body.password !== undefined && body.password !== '' && typeof body.password !== 'string') return fail('A nova senha é inválida.');
    const password=typeof body.password === 'string' && body.password !== '' ? body.password : null;
    const passwordError=password === null ? null : validatePassword(password);
    if(passwordError) return fail(passwordError);
    const active=situacaoAtiva(body.active,target.active);
    const dailyReportEnabled=active===1 && role!=='viewer'
      ? (body.dailyReportEnabled === undefined ? target.dailyReportEnabled : body.dailyReportEnabled === true ? 1 : 0) : 0;
    const dailyReportTime=body.dailyReportTime === undefined ? target.dailyReportTime : textValue(body.dailyReportTime);
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyReportTime)) return fail('Informe um horário válido para o relatório diário.');
    const name=textValue(body.name) || target.name;
    if(target.id===actor.id&&(active===0||role!=='admin')) return fail('Você não pode desativar nem rebaixar a própria conta.');
    if(!revisaoConfere(body.expectedRevision,target.revision)) return fail('Este usuario foi alterado. Feche a edicao e atualize a lista antes de tentar novamente.',409);
    const changes:string[]=[];
    if(name!==target.name) changes.push(`nome: ${target.name} → ${name}`);
    if(role!==target.role) changes.push(`perfil: ${target.role} → ${role}`);
    if(active!==target.active) changes.push(active?'reativado':'desativado');
    if(dailyReportEnabled!==target.dailyReportEnabled) changes.push(dailyReportEnabled?'relatório diário ativado':'relatório diário desativado');
    if(dailyReportTime!==target.dailyReportTime) changes.push(`horário do relatório: ${target.dailyReportTime} → ${dailyReportTime}`);
    const baseValues=[exigeTexto(name,LIMITES_CAMPO.nome,'nome'),role,active,dailyReportEnabled,dailyReportTime];
    // O hash pode falhar: calcula-lo antes da escrita evita salvar metade do pedido.
    const salt=password !== null ? crypto.randomUUID() : null;
    const hash=password !== null ? await passwordHash(password,salt!,PBKDF2_ITERACOES_ATUAL) : null;
    const encerrarSessoes=(target.active===1&&active===0)||role!==target.role;
    if(password !== null) changes.push('senha redefinida (sessões encerradas)');
    else if(encerrarSessoes) changes.push('sessões encerradas');
    const statements=[rawDb().prepare(password !== null ? ATUALIZAR_USUARIO_COM_SENHA_SQL : ATUALIZAR_USUARIO_SQL)
      .bind(...baseValues,...(password !== null ? [salt,hash,PBKDF2_ITERACOES_ATUAL] : []),userId,target.revision,role,active),
      rawDb().prepare(AUDITAR_USUARIO_SQL).bind(id('aud'),actor.id,userId,`${target.email}: ${changes.join('; ')||'sem alterações'}`,now())];
    if(password !== null) statements.push(rawDb().prepare(ENCERRAR_SESSOES_REDEFINIDAS_SQL).bind(userId,userId,salt));
    // Desativar ou trocar o perfil derruba as sessoes abertas: o acesso antigo
    // nao pode continuar valendo ate o fim do prazo da sessao.
    if(password === null && encerrarSessoes) statements.push(rawDb().prepare(ENCERRAR_SESSOES_ALTERADAS_SQL).bind(userId,userId,role,active));
    statements.push(rawDb().prepare(`UPDATE daily_report_deliveries SET status='failed',locked_at=NULL,last_error='Permissão de relatório revogada.',updated_at=?
    WHERE user_id=? AND status IN ('pending','processing') AND EXISTS
    (SELECT 1 FROM users WHERE id=? AND revision=? AND (active<>1 OR role='viewer' OR daily_report_enabled<>1))`)
      .bind(now(),userId,userId,target.revision+1));
    const [atualizado]=await rawDb().batch(statements);
    if (!atualizado.meta.changes) return fail('O usuario foi alterado por outra operacao ou e o ultimo administrador ativo. Atualize a lista; promova outro administrador antes de rebaixar o ultimo.',409);
    return ok({ success:true });
  }

  async function userList(user: User) {
    return ok({ users: user.role === 'admin'
      ? await all('SELECT id,name,email,role,active,revision,daily_report_enabled AS dailyReportEnabled,daily_report_time AS dailyReportTime,created_at AS createdAt FROM users ORDER BY name')
      : await all('SELECT id,name FROM users WHERE active=1 ORDER BY name') });
  }

  return { createUser, updateUser, userList };
}
