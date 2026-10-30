import { AREAS, AREAS_IDS, NIVEIS, ROTULO_NIVEL, ajustesDiferentesDoPadrao, lerPermissoes, nivelPadrao, pode, type Area, type Nivel, type Permissoes } from './permissoes.ts';
import { comAcaoEscrita } from './autor-escrita.ts';
import { isRecord, type Role } from './domain.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';
import { auditoriaNoLote } from './auditoria-api.ts';

type Linha = { id: string; name: string; email: string; role: Role };
type Ajuste = { user_id: string; area: string; nivel: string };

const rotuloArea = (area: Area) => {
  const definicao = AREAS.find(a => a.area === area)!;
  return definicao.aba === definicao.label ? definicao.label : `${definicao.aba} › ${definicao.label}`;
};

// Texto legivel para o Historico: "Chamados › Pagamentos: Sem acesso → Ler e editar".
export function descreverMudancas(role: Role, antes: Permissoes, depois: Permissoes): string[] {
  const mudancas: string[] = [];
  for (const area of AREAS_IDS) {
    const de = antes[area] ?? nivelPadrao(role, area), para = depois[area] ?? nivelPadrao(role, area);
    if (de !== para) mudancas.push(`${rotuloArea(area)}: ${ROTULO_NIVEL[de]} → ${ROTULO_NIVEL[para]}`);
  }
  return mudancas;
}

const mesmosAjustes = (a: Permissoes, b: Permissoes) =>
  AREAS_IDS.every(area => a[area] === b[area]);

export function permissoesApi(contexto: ContextoApi) {
  const { rawDb, now, ok, fail, jsonBody, all } = contexto;

  async function carregar() {
    const [usuarios, ajustes] = await Promise.all([
      all<Linha>('SELECT id,name,email,role FROM users WHERE active=1 ORDER BY name'),
      all<Ajuste>('SELECT user_id,area,nivel FROM permissoes_usuario'),
    ]);
    // Acesso total (admin) nao passa pelo painel.
    return usuarios.map(u => ({ ...u, total: pode({ role: u.role }, 'permissao:gerenciar'), ajustes: lerPermissoes(ajustes.filter(a => a.user_id === u.id)) }));
  }

  async function matriz(user: User) {
    if (!pode(user, 'permissao:gerenciar')) return fail('Somente administradores podem consultar as permissões.', 403);
    const usuarios = await carregar();
    return ok({
      areas: AREAS,
      niveis: NIVEIS.map(nivel => ({ nivel, label: ROTULO_NIVEL[nivel] })),
      usuarios: usuarios.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role, acessoTotal: u.total,
        niveis: Object.fromEntries(AREAS_IDS.map(area => [area, u.total ? 'edicao' : u.ajustes[area] ?? nivelPadrao(u.role, area)])),
        padrao: Object.fromEntries(AREAS_IDS.map(area => [area, u.total ? 'edicao' : nivelPadrao(u.role, area)])),
      })),
    });
  }

  // Grava a matriz inteira de uma vez. So os niveis diferentes do padrao do
  // perfil viram linhas; quem teve mudanca perde as sessoes abertas.
  async function salvar(request: Request, user: User) {
    return comAcaoEscrita('permissao:gerenciar', async () => {
      if (!pode(user, 'permissao:gerenciar')) return fail('Somente administradores podem alterar as permissões.', 403);
      const body = await jsonBody<{ usuarios?: unknown }>(request);
      if (!Array.isArray(body.usuarios)) return fail('Envie a lista de usuários.');
      const atuais = new Map((await carregar()).map(u => [u.id, u]));
      const pedidos = new Map<string, Permissoes>();
      for (const item of body.usuarios) {
        if (!isRecord(item) || typeof item.id !== 'string' || !isRecord(item.niveis)) return fail('Lista de permissões inválida.');
        if (!atuais.has(item.id)) return fail('Usuário inexistente ou inativo na lista de permissões.', 409);
        const niveis: Permissoes = {};
        for (const [area, nivel] of Object.entries(item.niveis)) {
          if (!AREAS_IDS.includes(area as Area) || !NIVEIS.includes(nivel as Nivel)) return fail('Nível de permissão inválido.');
          niveis[area as Area] = nivel as Nivel;
        }
        pedidos.set(item.id, niveis);
      }
      const ts = now(), statements = [];
      let alterados = 0;
      for (const [userId, niveis] of pedidos) {
        const atual = atuais.get(userId)!;
        // Admin tem sempre acesso total; o painel nao o rebaixa.
        if (atual.total) continue;
        const novos = ajustesDiferentesDoPadrao(atual.role, { ...atual.ajustes, ...niveis });
        if (mesmosAjustes(novos, atual.ajustes)) continue;
        alterados++;
        statements.push(rawDb().prepare('DELETE FROM permissoes_usuario WHERE user_id=?').bind(userId));
        for (const [area, nivel] of Object.entries(novos)) {
          statements.push(rawDb().prepare('INSERT INTO permissoes_usuario (user_id,area,nivel,atualizado_em,atualizado_por) VALUES (?,?,?,?,?)').bind(userId, area, nivel, ts, user.id));
        }
        statements.push(rawDb().prepare('DELETE FROM sessions WHERE user_id=?').bind(userId));
        const mudancas = descreverMudancas(atual.role, atual.ajustes, novos);
        statements.push(auditoriaNoLote(contexto, user.id, 'UPDATE', 'user', userId, `${atual.email}: permissões alteradas (${mudancas.join('; ')}); sessões encerradas`));
      }
      if (statements.length) await rawDb().batch(statements);
      return ok({ success: true, alterados });
    });
  }

  return { matriz, salvar };
}
