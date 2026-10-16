import { ipConexao } from '../scripts/ip-conexao.mjs';
import { IpConcurrencyGate, KeyedConcurrencyGate } from './concurrency.ts';
import { corpoLimitado } from './corpo-limitado.ts';
import { CORPO_MAX_LOGIN } from './limites-entrada.ts';
import { isRecord } from './domain.ts';
import { type ContextoApi, textValue } from './api-compartilhada.ts';

// A sessao so nasce se a conta ainda corresponde ao snapshot autenticado.
export const CRIAR_SESSAO_AUTENTICADA_SQL = `INSERT INTO sessions (token,user_id,expires_at,last_seen_at)
 SELECT ?,id,?,? FROM users WHERE id=? AND active=1 AND revision=? AND password_salt=? AND password_hash=?`;
export const MIGRAR_SENHA_AUTENTICADA_SQL = `UPDATE users SET password_salt=?,password_hash=?,password_iterations=?
 WHERE id=? AND active=1 AND revision=? AND password_salt=? AND password_hash=?
 AND EXISTS (SELECT 1 FROM sessions WHERE token=? AND user_id=users.id)`;

export function sessaoApi(contexto: ContextoApi) {
  const { audit, currentUser, id, now, rawDb, parseCookies, passwordHash, tokenHash, PBKDF2_ITERACOES_ATUAL, ok, fail, first } = contexto;

  // A origem vem exclusivamente do socket; cabecalhos enviados pelo cliente nao a alteram.
  const clientIp = (_request: Request) => ipConexao();

  function equalHex(left: string, right: string) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return difference === 0;
  }

  const LOGIN_WINDOW_MIN = 15;
  const LOGIN_SOFT_LIMIT = 5;    // a partir daqui, atraso progressivo
  const LOGIN_DELAY_MAX_MS = 4000;

  // Salt usado quando a conta nao existe ou esta inativa. Precisa ser um valor
  // proprio e constante: usar o salt de um usuario real daria pista sobre a base.
  const SALT_INEXISTENTE = 'conta-inexistente-salt-fixo-nao-usar-em-usuario-real';

  // Limites conservadores por processo, a calibrar na homologação do servidor.
  const loginGate = new KeyedConcurrencyGate(4, 16);
  const loginIpGate = new IpConcurrencyGate(2);
  async function login(request: Request) {
    const texto = await corpoLimitado(request, CORPO_MAX_LOGIN);
    if (texto === null) return fail('E-mail ou senha inválidos.', 401);
    let body: unknown;
    try { body = JSON.parse(texto || '{}'); } catch { return fail('E-mail ou senha inválidos.', 401); }
    if (!isRecord(body)) return fail('E-mail ou senha inválidos.', 401);
    const alvo = textValue(body.email).toLowerCase();
    if (alvo.length > 254) return fail('E-mail ou senha inválidos.', 401);
    const ocupado = () => ok({ error: 'Muitos acessos simultâneos. Tente novamente em alguns segundos.' }, { status: 429, headers: { 'Retry-After': '5' } });
    const ip=clientIp(request);
    // Sem origem verificavel, nao confundir toda a LAN com um unico cliente.
    const releaseIp=ip==='local'?()=>{}:loginIpGate.acquire(ip);
    if (!releaseIp) return ocupado();
    try {
      const release = await loginGate.acquire(alvo);
      if (!release) return ocupado();
      try { return await authenticate(request, texto); }
      finally { release(); }
    } finally { releaseIp(); }

  }

  async function authenticate(request: Request, texto: string) {
    const ip = clientIp(request);
    const agora = now();
    const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60 * 1000).toISOString();

    let body: { email?: unknown; password?: unknown };
    try { body = JSON.parse(texto || '{}'); }
    catch { return fail('E-mail ou senha inválidos.', 401); }
    if (!isRecord(body)) return fail('E-mail ou senha inválidos.', 401);

    const email = textValue(body.email).toLowerCase();
    // Mede a senha CRUA, nao a aparada: "espacos + texto" passaria pelo limite se
    // o tamanho fosse medido depois do trim, e o PBKDF2 receberia o valor inteiro.
    const senhaCrua = typeof body.password === 'string' ? body.password : '';
    if (email.length > 254 || senhaCrua.length > 200) {
      return fail('E-mail ou senha inválidos.', 401);
    }

    // Registra a tentativa ANTES de contar. Contar e depois inserir permitia que
    // varias requisicoes paralelas lessem a mesma contagem antiga e escapassem
    // todas do atraso; inserindo primeiro, cada uma enxerga as anteriores.
    const idTentativa = id('att');
    await rawDb().prepare('INSERT INTO login_attempts (id,ip,email,success,created_at) VALUES (?,?,?,0,?)')
      .bind(idTentativa, ip, email || null, agora).run();

    // Limpeza deterministica, no lugar do sorteio de 5%: roda sempre, e o indice
    // por (ip, created_at) mantem o custo baixo.
    await rawDb().prepare('DELETE FROM login_attempts WHERE created_at<?')
      .bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).run();

    // Duas contagens. A do e-mail freia o ataque a uma conta especifica; a global
    // freia o atacante que troca de e-mail a cada tentativa justamente para nunca
    // acionar o contador por conta.
    const [porEmail, global] = await Promise.all([
      first<{ n: number }>('SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND email IS ? AND success=0 AND created_at>?', [ip, email || null, since]),
      first<{ n: number }>('SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND success=0 AND created_at>?', [ip, since]),
    ]);
    const fails = Math.max(Number(porEmail?.n || 0), Math.floor(Number(global?.n || 0) / 1.5));

    const record = await first<{ id: string; name: string; email: string; role: string; password_salt: string; password_hash: string; password_iterations: number; revision: number }>('SELECT * FROM users WHERE lower(email)=? AND active=1', [email]);

    // Custo do hash. Para conta inexistente ou inativa usa o custo ATUAL, nao o
    // legado: com o legado, e-mail que nao existe respondia sempre rapido e
    // e-mail migrado sempre devagar, o que permitia enumerar contas pelo tempo.
    //
    // RISCO ACEITO ate a migracao terminar: as contas ainda em 120 mil respondem
    // mais rapido que as demais, e isso identifica que o e-mail EXISTE e e uma
    // conta antiga. Some sozinho conforme cada usuario entra e tem o hash
    // regravado com 600 mil. Enquanto houver conta legada, a enumeracao e
    // possivel para esse subconjunto.
    const iteracoesDoHash = Number(record?.password_iterations) || PBKDF2_ITERACOES_ATUAL;
    // Salt ficticio proprio: nunca o de um usuario real, para nao dar pista
    // alguma sobre a base.
    const candidate = await passwordHash(typeof body.password === 'string' ? body.password : '', record?.password_salt || SALT_INEXISTENTE, iteracoesDoHash);
    const okLogin = !!record && equalHex(candidate, record.password_hash);

    // Mantem a reserva durante o atraso: paralelismo nao contorna a vazao.
    if (!okLogin && fails >= LOGIN_SOFT_LIMIT) {
      await new Promise((r) => setTimeout(r, Math.min(LOGIN_DELAY_MAX_MS, 400 * (fails - LOGIN_SOFT_LIMIT + 1))));
    }

    if (!okLogin) {
      // Audita so na virada do limite, nao a cada tentativa: antes, um ataque
      // longo enchia a auditoria de linhas repetidas e escondia o resto.
      if (fails === LOGIN_SOFT_LIMIT || fails === LOGIN_SOFT_LIMIT * 4) {
        await audit(null, 'BLOCKED', 'session', null, `${fails} tentativas malsucedidas em ${LOGIN_WINDOW_MIN} min (alvo: ${email || 'sem e-mail'})`);
      }
      return fail('E-mail ou senha inválidos.', 401);
    }

    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const guardado = await tokenHash(token);
    const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const migrar = iteracoesDoHash < PBKDF2_ITERACOES_ATUAL;
    const salNovo = migrar ? crypto.randomUUID() : record!.password_salt;
    const hashNovo = migrar ? await passwordHash(senhaCrua, salNovo, PBKDF2_ITERACOES_ATUAL) : record!.password_hash;
    const lote = [
      rawDb().prepare(CRIAR_SESSAO_AUTENTICADA_SQL).bind(guardado, expires, agora, record!.id, record!.revision, record!.password_salt, record!.password_hash),
      rawDb().prepare(MIGRAR_SENHA_AUTENTICADA_SQL).bind(salNovo, hashNovo, PBKDF2_ITERACOES_ATUAL, record!.id, record!.revision, record!.password_salt, record!.password_hash, guardado),
      rawDb().prepare('UPDATE login_attempts SET success=1 WHERE id=? AND EXISTS (SELECT 1 FROM sessions WHERE token=?)').bind(idTentativa, guardado),
      rawDb().prepare('DELETE FROM login_attempts WHERE ip=? AND email IS ? AND success=0 AND EXISTS (SELECT 1 FROM sessions WHERE token=?)').bind(ip, email || null, guardado),
      rawDb().prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),
      rawDb().prepare('DELETE FROM login_attempts WHERE created_at<?').bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ];
    if (!migrar) lote.splice(1, 1);
    const resultados = await rawDb().batch(lote);
    if (!resultados[0].meta.changes) return fail('As credenciais mudaram. Entre novamente.', 401);

    await audit(record!.id, 'LOGIN', 'session', null, `Acesso realizado de ${ip}`);
    const response = ok({ user: { id: record!.id, name: record!.name, email: record!.email, role: record!.role } });
    response.cookies.set('acordos_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: 43200,
    });
    return response;
  }

  async function logout(request: Request) {
    // Mesmo leitor do currentUser. A expressao regular que estava aqui casava
    // tambem com um cookie como x_acordos_session vindo antes: o navegador
    // perdia o cookie, mas a sessao verdadeira continuava valida no banco.
    const token = parseCookies(request).acordos_session;
    const user = token ? await currentUser(request) : null;
    if (token) await rawDb().prepare('DELETE FROM sessions WHERE token=?').bind(await tokenHash(token)).run();
    if (user) await audit(user.id, 'LOGOUT', 'session', null, 'Sessão encerrada pelo usuário');
    const response = ok({ success: true });
    response.cookies.set('acordos_session', '', {
      httpOnly: true,
      sameSite: 'strict',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: 0,
    });
    return response;
  }

  return { login, logout };
}
