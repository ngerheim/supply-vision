import { lerPermissoes, pode, type Permissoes } from './permissoes.ts';
import { comAcaoEscrita } from './autor-escrita.ts';
import type { Role } from './domain.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';
import { auditoriaNoLote } from './auditoria-api.ts';
import { prepararNotificacaoUsuario } from './central-notificacoes.ts';
import { DIAS_RETENCAO_ALERTAS, textoAviso, tituloRodada, totaisRodada, validarRodada } from './alertas-rodadas.ts';

type Pessoa = { id: string; name: string; email: string; role: Role; permissoes: Permissoes; recebe: boolean };
type RodadaRow = {
  id: string; contexto: string; datas: string; resumo: string; linhas: number; acima: number; abaixo: number;
  dif_acima: number; dif_abaixo: number; qualidade_pendente: number; recebida_em: string; atualizada_em: string;
};

const LIMITE_RODADAS_LISTA = 60;

export function alertasApi(contexto: ContextoApi) {
  const { rawDb, now, ok, fail, all, first, jsonBody } = contexto;

  // Usuarios ativos com o nivel efetivo de cada um; so quem le a aba pode receber.
  async function pessoas(): Promise<Pessoa[]> {
    const [usuarios, ajustes, marcados] = await Promise.all([
      all<{ id: string; name: string; email: string; role: Role }>('SELECT id,name,email,role FROM users WHERE active=1 ORDER BY name'),
      all<{ user_id: string; area: string; nivel: string }>('SELECT user_id,area,nivel FROM permissoes_usuario'),
      all<{ user_id: string }>('SELECT user_id FROM alertas_destinatarios'),
    ]);
    const recebem = new Set(marcados.map(m => m.user_id));
    return usuarios.map(u => ({ ...u, permissoes: lerPermissoes(ajustes.filter(a => a.user_id === u.id)), recebe: recebem.has(u.id) }));
  }

  // Rota interna (token do Alertas). Rodada nova avisa os destinatarios na
  // Central; a mesma chave de novo so troca o conteudo, sem novo aviso.
  async function receberRodada(request: Request) {
    const rodada = validarRodada(await jsonBody(request, 16 * 1024 * 1024));
    const ts = now(), totais = totaisRodada(rodada.linhas);
    const existente = await first<{ id: string }>('SELECT id FROM alertas_rodadas WHERE chave=?', [rodada.chave]);
    const rodadaId = existente?.id ?? contexto.id('alr');
    const db = rawDb();
    const statements = [];
    if (existente) {
      statements.push(db.prepare('DELETE FROM alertas_linhas WHERE rodada_id=?').bind(rodadaId));
      statements.push(db.prepare(`UPDATE alertas_rodadas SET contexto=?,datas=?,resumo=?,linhas=?,acima=?,abaixo=?,dif_acima=?,dif_abaixo=?,
        qualidade_pendente=?,atualizada_em=? WHERE id=?`).bind(rodada.contexto, JSON.stringify(rodada.datas), JSON.stringify(rodada.resumo),
        rodada.linhas.length, totais.acima, totais.abaixo, totais.difAcima, totais.difAbaixo, rodada.qualidadePendente ? 1 : 0, ts, rodadaId));
    } else {
      statements.push(db.prepare(`INSERT INTO alertas_rodadas(id,chave,contexto,datas,resumo,linhas,acima,abaixo,dif_acima,dif_abaixo,
        qualidade_pendente,recebida_em,atualizada_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rodadaId, rodada.chave, rodada.contexto,
        JSON.stringify(rodada.datas), JSON.stringify(rodada.resumo), rodada.linhas.length, totais.acima, totais.abaixo, totais.difAcima,
        totais.difAbaixo, rodada.qualidadePendente ? 1 : 0, ts, ts));
    }
    for (const l of rodada.linhas) {
      statements.push(db.prepare(`INSERT INTO alertas_linhas(rodada_id,data,os,criador,cidade,uf,fornecedor,cnpj,modelo,item,qtd,preco_os,
        preco_acordo,total_os,total_acordo,dif_unit,dif_total,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rodadaId, l.data, l.os,
        l.criador, l.cidade, l.uf, l.fornecedor, l.cnpj, l.modelo, l.item, l.qtd, l.precoOs, l.precoAcordo, l.totalOs, l.totalAcordo,
        l.difUnit, l.difTotal, l.status));
    }
    let avisados = 0;
    if (!existente) {
      const link = `/?aba=alertas&sub=rodadas&rodada=${rodadaId}`, texto = textoAviso(rodada.contexto, rodada.datas, rodada.linhas.length);
      for (const p of (await pessoas()).filter(p => p.recebe && pode({ ...p, active: 1 }, 'aba:alertas'))) {
        statements.push(prepararNotificacaoUsuario({ destinatario: p.id, tipo: 'alerta', texto, link, timestamp: ts }));
        avisados++;
      }
      const limite = new Date(Date.parse(ts) - DIAS_RETENCAO_ALERTAS * 86400000).toISOString();
      statements.push(db.prepare('DELETE FROM alertas_rodadas WHERE recebida_em<? AND id<>?').bind(limite, rodadaId));
    }
    await db.batch(statements);
    return ok({ success: true, id: rodadaId, nova: !existente, linhas: rodada.linhas.length, avisados });
  }

  const rodadaPublica = (r: RodadaRow) => ({
    id: r.id, contexto: r.contexto, titulo: tituloRodada(r.contexto, JSON.parse(r.datas) as string[]), datas: JSON.parse(r.datas) as string[],
    resumo: JSON.parse(r.resumo) as unknown, linhas: r.linhas, acima: r.acima, abaixo: r.abaixo, difAcima: r.dif_acima,
    difAbaixo: r.dif_abaixo, qualidadePendente: r.qualidade_pendente === 1, recebidaEm: r.recebida_em, atualizadaEm: r.atualizada_em,
  });

  async function listar(user: User) {
    if (!pode(user, 'alertas:consultar')) return fail('Seu perfil não permite consultar os alertas.', 403);
    const [rodadas, marcado] = await Promise.all([
      all<RodadaRow>(`SELECT * FROM alertas_rodadas ORDER BY recebida_em DESC, id DESC LIMIT ${LIMITE_RODADAS_LISTA}`),
      first('SELECT 1 ok FROM alertas_destinatarios WHERE user_id=?', [user.id]),
    ]);
    return ok({ rodadas: rodadas.map(rodadaPublica), recebeAviso: Boolean(marcado) });
  }

  async function detalhe(user: User, rodadaId: string) {
    if (!pode(user, 'alertas:consultar')) return fail('Seu perfil não permite consultar os alertas.', 403);
    const rodada = await first<RodadaRow>('SELECT * FROM alertas_rodadas WHERE id=?', [rodadaId]);
    if (!rodada) return fail('Rodada não encontrada. Ela pode ter saído do histórico.', 404);
    const linhas = await all(`SELECT data,os,criador,cidade,uf,fornecedor,cnpj,modelo,item,qtd,preco_os precoOs,preco_acordo precoAcordo,
      total_os totalOs,total_acordo totalAcordo,dif_unit difUnit,dif_total difTotal,status FROM alertas_linhas WHERE rodada_id=?
      ORDER BY CASE status WHEN 'ACIMA DO ACORDO' THEN 0 ELSE 1 END, dif_total DESC, id`, [rodadaId]);
    return ok({ rodada: rodadaPublica(rodada), linhas });
  }

  async function destinatarios(user: User) {
    if (!pode(user, 'alertas:destinatarios')) return fail('Seu perfil não permite escolher quem recebe os alertas.', 403);
    return ok({
      usuarios: (await pessoas()).map(p => ({
        id: p.id, name: p.name, email: p.email, role: p.role, recebe: p.recebe, podeLer: pode({ ...p, active: 1 }, 'aba:alertas'),
      })),
    });
  }

  // Grava a lista inteira. So entra quem le a aba; quem perdeu a leitura
  // depois continua na lista, mas nao e avisado ate voltar a ler.
  async function salvarDestinatarios(request: Request, user: User) {
    return comAcaoEscrita('alertas:destinatarios', async () => {
      if (!pode(user, 'alertas:destinatarios')) return fail('Seu perfil não permite escolher quem recebe os alertas.', 403);
      const body = await jsonBody<{ usuarios?: unknown }>(request);
      if (!Array.isArray(body.usuarios) || !body.usuarios.every(u => typeof u === 'string')) return fail('Envie a lista de usuários.');
      const pedidos = new Set(body.usuarios as string[]);
      const atuais = new Map((await pessoas()).map(p => [p.id, p]));
      for (const idUsuario of pedidos) {
        const p = atuais.get(idUsuario);
        if (!p) return fail('Usuário inexistente ou inativo na lista.', 409);
        if (!p.recebe && !pode({ ...p, active: 1 }, 'aba:alertas')) return fail(`${p.name} não tem acesso de leitura aos Alertas.`, 409);
      }
      const entram = [...pedidos].filter(i => !atuais.get(i)!.recebe);
      const saem = [...atuais.values()].filter(p => p.recebe && !pedidos.has(p.id));
      if (!entram.length && !saem.length) return ok({ success: true, alterados: 0 });
      const ts = now(), db = rawDb();
      const statements = [
        ...saem.map(p => db.prepare('DELETE FROM alertas_destinatarios WHERE user_id=?').bind(p.id)),
        ...entram.map(i => db.prepare('INSERT INTO alertas_destinatarios(user_id,incluido_por,incluido_em) VALUES (?,?,?)').bind(i, user.id, ts)),
      ];
      const nomes = (lista: string[]) => lista.map(i => atuais.get(i)!.name).join(', ');
      const detalhes = [entram.length ? `Passam a receber: ${nomes(entram)}` : '', saem.length ? `Deixam de receber: ${saem.map(p => p.name).join(', ')}` : '']
        .filter(Boolean).join(' · ');
      statements.push(auditoriaNoLote(contexto, user.id, 'UPDATE', 'alertas_destinatarios', null, detalhes));
      await db.batch(statements);
      return ok({ success: true, alterados: entram.length + saem.length });
    });
  }

  return { receberRodada, listar, detalhe, destinatarios, salvarDestinatarios };
}
