import { pode } from './permissoes.ts';
import { dataDeNegocio } from './data-negocio.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';
import { comAcaoEscrita } from './autor-escrita.ts';
import { EntradaInvalida } from './limites-entrada.ts';
import { isIsoDate } from './domain.ts';
import { curvaAbc, filtroSql, lerFiltros, mediana, pareto, validarDia, variacaoPorCidade, type FiltrosAnalise } from './analise.ts';
import { DIAS_ADIAMENTO, STATUS_ACAO, TIPOS_ACAO, candidatas, conciliar, type AcaoAtual, type StatusAcao } from './analise-acoes.ts';

type Num = number | null;
const n = (v: Num | undefined) => Number(v ?? 0);
const razao = (a: number, b: number) => (b ? a / b : null);
// Mesmo periodo um ano antes (29/02 vira 28/02).
const anoAntes = (d: string) => { const [a, m, dia] = d.split('-'); return `${Number(a) - 1}-${m}-${m === '02' && dia === '29' ? '28' : dia}`; };
const somarDias = (data: string, dias: number) => { const d = new Date(`${data}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };

type AcaoRow = { id: string; chave: string; tipo: string; titulo: string; detalhe: string; impacto: number; filtro: string; status: StatusAcao;
  adiada_ate: string | null; motivo: string | null; criada_em: string; atualizada_em: string; resolvida_em: string | null; resolvida_por: string | null; resolvidaPorNome?: string | null };
const acaoPublica = (a: AcaoRow) => ({
  id: a.id, tipo: a.tipo, tipoLabel: TIPOS_ACAO[a.tipo as keyof typeof TIPOS_ACAO] ?? a.tipo, titulo: a.titulo, detalhe: a.detalhe,
  impacto: a.impacto, filtro: JSON.parse(a.filtro) as Record<string, string>, status: a.status, adiadaAte: a.adiada_ate, motivo: a.motivo,
  criadaEm: a.criada_em, atualizadaEm: a.atualizada_em, resolvidaEm: a.resolvida_em, resolvidaPor: a.resolvidaPorNome ?? null,
});

export function analiseApi(contexto: ContextoApi) {
  const { rawDb, now, ok, fail, all, first, jsonBody } = contexto;

  const parametro = async (chave: string) => (await first<{ valor: string }>('SELECT valor FROM analise_parametros WHERE chave=?', [chave]))?.valor ?? null;

  // Rota interna (token do Alertas): troca todas as linhas da data recebida.
  async function receberDia(request: Request) {
    const { data, linhas } = validarDia(await jsonBody(request, 16 * 1024 * 1024));
    const ts = now();
    const statements = [rawDb().prepare('DELETE FROM compras_comparadas WHERE data=?').bind(data)];
    for (const l of linhas) {
      statements.push(rawDb().prepare(`INSERT INTO compras_comparadas
        (data,grupo,os,cidade,fornecedor,cnpj,modelo,item,qtd,preco_os,preco_acordo,total_os,total_acordo,dif_total,
         status,motivo,tinha_acordo,menor_preco,fornecedor_acordo,dif_menor,recebido_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        data, l.grupo, l.os, l.cidade, l.fornecedor, l.cnpj, l.modelo, l.item, l.qtd, l.precoOs, l.precoAcordo,
        l.totalOs, l.totalAcordo, l.difTotal, l.status, l.motivo, l.tinhaAcordo ? 1 : 0, l.menorPreco, l.fornecedorAcordo,
        l.difMenor, ts));
    }
    await rawDb().batch(statements);
    return ok({ success: true, data, linhas: linhas.length });
  }

  async function painel(user: User, params: URLSearchParams) {
    if (!pode(user, 'analise:consultar')) return fail('Seu perfil não permite consultar a Análise.', 403);
    const limites = await first<{ min: string | null; max: string | null; recebido: string | null }>(
      'SELECT MIN(data) min,MAX(data) max,MAX(recebido_em) recebido FROM compras_comparadas');
    const corte = await parametro('corte_vigencia');
    const f = lerFiltros(params, limites?.max || dataDeNegocio(), corte);
    const { where, values } = filtroSql(f);
    const de = `FROM compras_comparadas c WHERE ${where}`;
    const COM = "c.status<>'SEM ACORDO'";
    const CONF = "c.status IN ('CONFORME','ABAIXO DO ACORDO')";
    const ACIMA = "c.status='ACIMA DO ACORDO'";
    const ECON = 'CASE WHEN c.dif_menor>0 THEN c.dif_menor ELSE 0 END';

    const [resumo] = await all<Record<string, Num>>(`SELECT COUNT(*) linhas, SUM(c.total_os) gasto,
      SUM(CASE WHEN ${COM} THEN c.total_os END) gastoComAcordo,
      SUM(CASE WHEN ${COM} THEN 1 ELSE 0 END) linhasComAcordo,
      SUM(CASE WHEN ${CONF} THEN 1 ELSE 0 END) linhasConformes,
      SUM(CASE WHEN ${CONF} THEN c.total_os END) gastoConforme,
      SUM(CASE WHEN ${ACIMA} THEN c.dif_total END) pagoAcima,
      SUM(CASE WHEN ${ACIMA} THEN 1 ELSE 0 END) linhasAcima,
      SUM(CASE WHEN c.status='ABAIXO DO ACORDO' THEN -c.dif_total END) pagoAbaixo,
      SUM(CASE WHEN c.status='SEM ACORDO' THEN c.total_os END) gastoSemAcordo,
      SUM(CASE WHEN c.status='SEM ACORDO' THEN 1 ELSE 0 END) linhasSemAcordo,
      SUM(CASE WHEN c.status='SEM ACORDO' AND c.tinha_acordo=1 THEN c.total_os END) semAcordoComOpcao,
      SUM(${ECON}) economiaPotencial ${de}`, values);

    const gasto = n(resumo.gasto), comAcordo = n(resumo.gastoComAcordo), economia = n(resumo.economiaPotencial);
    const indicadores = {
      linhas: n(resumo.linhas), gasto, gastoComAcordo: comAcordo,
      utilizacao: razao(comAcordo, gasto),
      conformidadeQtd: razao(n(resumo.linhasConformes), n(resumo.linhasComAcordo)),
      conformidadeRs: razao(n(resumo.gastoConforme), comAcordo),
      pagoAcima: n(resumo.pagoAcima), linhasAcima: n(resumo.linhasAcima), pagoAbaixo: n(resumo.pagoAbaixo),
      gastoSemAcordo: n(resumo.gastoSemAcordo), linhasSemAcordo: n(resumo.linhasSemAcordo),
      semAcordoComOpcao: n(resumo.semAcordoComOpcao),
      economiaPotencial: economia, gastoComMelhorAcordo: gasto - economia,
    };

    const fAnterior: FiltrosAnalise = { ...f, de: anoAntes(f.de), ate: anoAntes(f.ate) };
    const anterior = filtroSql(fAnterior);
    const [mensal, acima, semFornecedores, semItens, motivos, fornecedores, precos, opcoes, itens, [passado]] = await Promise.all([
      all(`SELECT substr(c.data,1,7) mes, SUM(c.total_os) gasto, SUM(CASE WHEN ${COM} THEN c.total_os END) comAcordo,
        SUM(CASE WHEN ${CONF} THEN c.total_os END) conforme, SUM(CASE WHEN ${ACIMA} THEN c.dif_total END) pagoAcima,
        SUM(${ECON}) economia ${de} GROUP BY mes ORDER BY mes`, values),
      all(`SELECT c.fornecedor, COUNT(*) linhas, SUM(c.dif_total) pagoAcima, SUM(c.total_os) gasto
        ${de} AND ${ACIMA} GROUP BY c.fornecedor ORDER BY pagoAcima DESC LIMIT 10`, values),
      all(`SELECT c.fornecedor, MIN(c.cidade) cidade, COUNT(*) linhas, SUM(c.total_os) gasto,
        SUM(CASE WHEN c.tinha_acordo=1 THEN 1 ELSE 0 END) linhasComOpcao
        ${de} AND c.status='SEM ACORDO' GROUP BY c.fornecedor ORDER BY gasto DESC LIMIT 10`, values),
      all(`SELECT c.item, COUNT(*) linhas, SUM(c.total_os) gasto, COUNT(DISTINCT c.cidade) cidades
        ${de} AND c.status='SEM ACORDO' GROUP BY c.item ORDER BY gasto DESC LIMIT 10`, values),
      all(`SELECT COALESCE(c.motivo,'Não informado') motivo, COUNT(*) linhas, SUM(c.total_os) gasto
        ${de} AND c.status='SEM ACORDO' GROUP BY 1 ORDER BY gasto DESC`, values),
      all<{ fornecedor: string; gasto: number; linhas: number; comAcordo: Num; pagoAcima: Num }>(`SELECT c.fornecedor, SUM(c.total_os) gasto, COUNT(*) linhas,
        SUM(CASE WHEN ${COM} THEN c.total_os END) comAcordo, SUM(CASE WHEN ${ACIMA} THEN c.dif_total END) pagoAcima
        ${de} AND c.fornecedor IS NOT NULL GROUP BY c.fornecedor HAVING SUM(c.total_os)>0 ORDER BY gasto DESC`, values),
      // Preco unitario de cada compra; a mediana por cidade e calculada abaixo.
      // Uma linha por preco distinto, com a contagem: a mediana sai igual e o
      // processo nao carrega cada compra do periodo.
      all<{ item: string; modelo: string; cidade: string; preco: number; n: number }>(`SELECT c.item, c.modelo, c.cidade, c.preco_os preco, COUNT(*) n
        ${de} AND c.qtd>0 AND c.preco_os>0 AND c.item IS NOT NULL AND c.cidade IS NOT NULL GROUP BY c.item, c.modelo, c.cidade, c.preco_os`, values),
      all<{ campo: string; valor: string }>(`SELECT 'cidade' campo, cidade valor FROM compras_comparadas WHERE cidade IS NOT NULL GROUP BY cidade
        UNION ALL SELECT 'fornecedor', fornecedor FROM compras_comparadas WHERE fornecedor IS NOT NULL GROUP BY fornecedor
        UNION ALL SELECT 'grupo', grupo FROM compras_comparadas WHERE grupo IS NOT NULL GROUP BY grupo ORDER BY 1,2`),
      all<{ item: string; gasto: number; linhas: number; comAcordo: Num; cidades: number }>(`SELECT c.item, SUM(c.total_os) gasto, COUNT(*) linhas,
        SUM(CASE WHEN ${COM} THEN c.total_os END) comAcordo, COUNT(DISTINCT c.cidade) cidades
        ${de} AND c.item IS NOT NULL GROUP BY c.item HAVING SUM(c.total_os)>0 ORDER BY gasto DESC`, values),
      all<Record<string, Num>>(`SELECT COUNT(*) linhas, SUM(c.total_os) gasto FROM compras_comparadas c WHERE ${anterior.where}`, anterior.values),
    ]);

    const classesDe = <T extends { gasto: number; classe: string }>(lista: T[]) => ['A', 'B', 'C'].map(classe => {
      const da = lista.filter(l => l.classe === classe);
      return { classe, quantidade: da.length, gasto: da.reduce((s, l) => s + l.gasto, 0) };
    });
    const abc = curvaAbc(fornecedores.map(l => ({ ...l, gasto: Number(l.gasto), comAcordo: n(l.comAcordo), pagoAcima: n(l.pagoAcima) })));
    const abcItens = curvaAbc(itens.map(l => ({ ...l, gasto: Number(l.gasto), comAcordo: n(l.comAcordo) })));
    const variacaoPreco = variacaoPorCidade(precos.map(p => ({ ...p, preco: Number(p.preco), n: Number(p.n) })));
    const antesDoCorte = (mes: string) => Boolean(corte && `${mes}-01` < corte);

    const listas: Record<string, string[]> = { cidade: [], fornecedor: [], grupo: [] };
    for (const o of opcoes) listas[o.campo]?.push(o.valor);

    return ok({
      filtros: f, corteVigencia: corte,
      disponivel: { de: limites?.min ?? null, ate: limites?.max ?? null, atualizadoEm: limites?.recebido ?? null },
      indicadores, anoAnterior: { de: fAnterior.de, ate: fAnterior.ate, linhas: n(passado?.linhas), gasto: n(passado?.gasto) },
      mensal: mensal.map(m => ({ ...m, antesDoCorte: antesDoCorte(String(m.mes)) })),
      acimaPorFornecedor: acima, semAcordoFornecedores: semFornecedores, semAcordoItens: semItens, motivosSemAcordo: motivos,
      abc: { classes: classesDe(abc), fornecedores: abc.slice(0, 1000) },
      abcItens: { classes: classesDe(abcItens), itens: abcItens.slice(0, 1000) },
      pareto: { fornecedores: pareto(abc.map(l => l.gasto)), itens: pareto(abcItens.map(l => l.gasto)) },
      variacaoPreco, opcoes: listas,
    });
  }

  // Painel de um fornecedor: de onde vem o gasto, o que tem acordo, onde cobra acima.
  async function fornecedor(user: User, params: URLSearchParams) {
    if (!pode(user, 'analise:consultar')) return fail('Seu perfil não permite consultar a Análise.', 403);
    const nome = params.get('nome')?.trim();
    if (!nome) throw new EntradaInvalida('Informe o fornecedor.');
    const max = (await first<{ max: string | null }>('SELECT MAX(data) max FROM compras_comparadas'))?.max;
    const f = lerFiltros(params, max || dataDeNegocio(), await parametro('corte_vigencia'));
    const { where, values } = filtroSql({ ...f, fornecedor: [nome] });
    const de = `FROM compras_comparadas c WHERE ${where}`;
    const COM = "c.status<>'SEM ACORDO'", CONF = "c.status IN ('CONFORME','ABAIXO DO ACORDO')", ACIMA = "c.status='ACIMA DO ACORDO'";
    const [[r], mensal, itens, cidades, precos, acoes] = await Promise.all([
      all<Record<string, Num>>(`SELECT COUNT(*) linhas, SUM(c.total_os) gasto, SUM(CASE WHEN ${COM} THEN c.total_os END) comAcordo,
        SUM(CASE WHEN ${CONF} THEN c.total_os END) conforme, SUM(CASE WHEN ${ACIMA} THEN c.dif_total END) pagoAcima,
        SUM(CASE WHEN ${ACIMA} THEN 1 ELSE 0 END) linhasAcima, SUM(CASE WHEN c.status='SEM ACORDO' AND c.tinha_acordo=1 THEN c.total_os END) semAcordoComOpcao,
        COUNT(DISTINCT c.cnpj) cnpjs, MIN(c.cnpj) cnpj ${de}`, values),
      all(`SELECT substr(c.data,1,7) mes, SUM(c.total_os) gasto, SUM(CASE WHEN ${COM} THEN c.total_os END) comAcordo,
        SUM(CASE WHEN ${ACIMA} THEN c.dif_total END) pagoAcima ${de} GROUP BY mes ORDER BY mes`, values),
      all<{ item: string; modelo: string | null; linhas: number; gasto: number; comAcordo: Num; pagoAcima: Num; semAcordo: number; motivo: string | null }>(`SELECT c.item, c.modelo,
        COUNT(*) linhas, SUM(c.total_os) gasto, SUM(CASE WHEN ${COM} THEN c.total_os END) comAcordo, SUM(CASE WHEN ${ACIMA} THEN c.dif_total END) pagoAcima,
        SUM(CASE WHEN c.status='SEM ACORDO' THEN 1 ELSE 0 END) semAcordo, MAX(c.motivo) motivo ${de} GROUP BY c.item, c.modelo ORDER BY gasto DESC LIMIT 50`, values),
      all(`SELECT c.cidade, COUNT(*) linhas, SUM(c.total_os) gasto, SUM(CASE WHEN ${COM} THEN c.total_os END) comAcordo,
        SUM(CASE WHEN ${CONF} THEN c.total_os END) conforme, SUM(CASE WHEN ${ACIMA} THEN c.dif_total END) pagoAcima
        ${de} GROUP BY c.cidade ORDER BY gasto DESC LIMIT 30`, values),
      all<{ item: string; modelo: string | null; preco: number; acordo: Num }>(`SELECT c.item, c.modelo, c.preco_os preco, c.preco_acordo acordo
        ${de} AND c.qtd>0 AND c.preco_os>0`, values),
      all<AcaoRow>(`SELECT * FROM analise_acoes WHERE status IN ('pendente','pulada') AND json_extract(filtro,'$.fornecedor')=? ORDER BY impacto DESC`, [nome]),
    ]);
    const porItem = new Map<string, { os: number[]; acordo: number[] }>();
    for (const p of precos) {
      const chave = `${p.item}\u0000${p.modelo ?? ''}`;
      if (!porItem.has(chave)) porItem.set(chave, { os: [], acordo: [] });
      porItem.get(chave)!.os.push(Number(p.preco));
      if (p.acordo !== null && p.acordo !== undefined) porItem.get(chave)!.acordo.push(Number(p.acordo));
    }
    const gasto = n(r?.gasto), comAcordo = n(r?.comAcordo);
    return ok({
      fornecedor: nome, filtros: f, cnpj: r?.cnpjs === 1 ? r?.cnpj ?? null : null,
      indicadores: {
        linhas: n(r?.linhas), gasto, comAcordo, utilizacao: razao(comAcordo, gasto), conformidadeRs: razao(n(r?.conforme), comAcordo),
        pagoAcima: n(r?.pagoAcima), linhasAcima: n(r?.linhasAcima), semAcordoComOpcao: n(r?.semAcordoComOpcao),
      },
      mensal,
      itens: itens.map(i => {
        const p = porItem.get(`${i.item}\u0000${i.modelo ?? ''}`);
        return { ...i, medianaPreco: p ? mediana(p.os) : null, medianaAcordo: p ? mediana(p.acordo) : null };
      }),
      cidades, acoes: acoes.map(acaoPublica),
    });
  }

  // Fim de um envio do Alertas (rodada diaria, recorte ou reprocessamento):
  // guarda o corte de vigencia e refaz as proximas acoes.
  async function concluirEnvio(request: Request) {
    const body = await jsonBody<{ corteVigencia?: unknown }>(request);
    const ts = now(), statements = [];
    if (body.corteVigencia !== undefined && body.corteVigencia !== null) {
      if (!isIsoDate(body.corteVigencia)) throw new EntradaInvalida('Data de corte inválida.');
      statements.push(rawDb().prepare(`INSERT INTO analise_parametros(chave,valor,atualizado_em) VALUES('corte_vigencia',?,?)
        ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor,atualizado_em=excluded.atualizado_em`).bind(body.corteVigencia, ts));
    }
    if (statements.length) await rawDb().batch(statements);
    return ok({ success: true, ...(await gerarAcoes(ts)) });
  }

  async function gerarAcoes(ts = now()) {
    const ultimo = (await first<{ max: string | null }>('SELECT MAX(data) max FROM compras_comparadas'))?.max;
    if (!ultimo) return { novas: 0, encerradas: 0 };
    const hoje = dataDeNegocio();
    const lista = await candidatas(all, ultimo);
    const atuais = await all<AcaoAtual & { atualizada_em: string }>('SELECT id,chave,status,adiada_ate,resolvida_em,atualizada_em FROM analise_acoes');
    const revisao = new Map(atuais.map(a => [a.id, a]));
    const plano = conciliar(atuais, lista, hoje);
    const db = rawDb(), statements = [];
    // Cada mudanca so grava se a sugestao ainda esta como foi lida: uma decisao
    // humana tomada no meio da conciliacao prevalece, e o evento so entra junto.
    const evento = (acaoId: string, de: string | null, para: string, motivo: string) => db.prepare(
      'INSERT INTO analise_acoes_eventos(id,acao_id,user_id,de,para,motivo,criado_em) SELECT ?,?,NULL,?,?,?,? WHERE changes()=1').bind(contexto.id('aev'), acaoId, de, para, motivo, ts);
    const comoLida = (id: string) => [revisao.get(id)!.status, revisao.get(id)!.atualizada_em];
    for (const c of plano.inserir) {
      const novaId = contexto.id('aca');
      statements.push(db.prepare(`INSERT OR IGNORE INTO analise_acoes(id,chave,tipo,titulo,detalhe,impacto,filtro,status,criada_em,atualizada_em,vista_em)
        VALUES (?,?,?,?,?,?,?,'pendente',?,?,?)`).bind(novaId, c.chave, c.tipo, c.titulo, c.detalhe, c.impacto, JSON.stringify(c.filtro), ts, ts, ts));
      statements.push(evento(novaId, null, 'pendente', 'Sugerida a partir dos dados.'));
    }
    for (const u of plano.atualizar) {
      statements.push(db.prepare(`UPDATE analise_acoes SET titulo=?,detalhe=?,impacto=?,filtro=?,vista_em=?${u.para ? ",status=?,adiada_ate=NULL,atualizada_em=?" : ''}
        WHERE id=? AND status=? AND atualizada_em=?`)
        .bind(u.c.titulo, u.c.detalhe, u.c.impacto, JSON.stringify(u.c.filtro), ts, ...(u.para ? [u.para, ts] : []), u.id, ...comoLida(u.id)));
      if (u.para) statements.push(evento(u.id, revisao.get(u.id)!.status, u.para, u.motivo ?? ''));
    }
    for (const a of plano.encerrar) {
      statements.push(db.prepare("UPDATE analise_acoes SET status='encerrada',adiada_ate=NULL,atualizada_em=? WHERE id=? AND status=? AND atualizada_em=?").bind(ts, a.id, ...comoLida(a.id)));
      statements.push(evento(a.id, a.status, 'encerrada', 'A condição deixou de aparecer nos dados dos últimos 90 dias.'));
    }
    if (statements.length) await db.batch(statements);
    return { novas: plano.inserir.length, encerradas: plano.encerrar.length };
  }

  async function listarAcoes(user: User, params: URLSearchParams) {
    if (!pode(user, 'analise:consultar')) return fail('Seu perfil não permite consultar a Análise.', 403);
    const lista = params.get('lista') || 'pendente';
    const [contagem] = await all<Record<string, number>>(`SELECT SUM(CASE WHEN status='pendente' THEN 1 ELSE 0 END) pendentes,
      SUM(CASE WHEN status='pulada' THEN 1 ELSE 0 END) puladas, SUM(CASE WHEN status='pendente' THEN impacto ELSE 0 END) impactoPendente FROM analise_acoes`);
    const base = { contagem: { pendentes: n(contagem?.pendentes), puladas: n(contagem?.puladas), impactoPendente: n(contagem?.impactoPendente) },
      geradasEm: (await first<{ m: string | null }>('SELECT MAX(vista_em) m FROM analise_acoes'))?.m ?? null, podeResolver: pode(user, 'analise:acoes') };
    if (lista === 'historico') {
      const eventos = await all(`SELECT e.id, e.de, e.para, e.motivo, e.criado_em criadoEm, u.name usuario, a.titulo, a.tipo
        FROM analise_acoes_eventos e JOIN analise_acoes a ON a.id=e.acao_id LEFT JOIN users u ON u.id=e.user_id
        ORDER BY e.criado_em DESC, e.id DESC LIMIT 300`);
      return ok({ ...base, eventos });
    }
    if (lista !== 'pendente' && lista !== 'pulada') throw new EntradaInvalida('Lista inválida.');
    const limite = Math.min(200, Math.max(1, Number(params.get('limite')) || 200));
    const acoes = await all<AcaoRow>(`SELECT a.*, u.name resolvidaPorNome FROM analise_acoes a LEFT JOIN users u ON u.id=a.resolvida_por
      WHERE a.status=? ORDER BY ${lista === 'pulada' ? 'a.adiada_ate, ' : ''}a.impacto DESC, a.id LIMIT ${limite}`, [lista]);
    return ok({ ...base, acoes: acoes.map(acaoPublica) });
  }

  // Feito, pular (adia N dias), rejeitar (motivo obrigatorio) ou reabrir.
  async function resolverAcao(request: Request, user: User, acaoId: string) {
    return comAcaoEscrita('analise:acoes', async () => {
      if (!pode(user, 'analise:acoes')) return fail('Seu perfil não permite resolver as próximas ações.', 403);
      const body = await jsonBody<{ para?: unknown; de?: unknown; motivo?: unknown; dias?: unknown }>(request);
      const para = body.para as StatusAcao;
      if (!['feita', 'pulada', 'rejeitada', 'pendente'].includes(para)) return fail('Escolha feito, pular, rejeitar ou reabrir.');
      if (!STATUS_ACAO.includes(body.de as StatusAcao)) return fail('Situação de origem inválida. Atualize a tela.');
      const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
      if (para === 'rejeitada' && !motivo) return fail('Informe por que a sugestão foi rejeitada.');
      if (motivo.length > 500) return fail('Motivo acima de 500 caracteres.');
      const dias = Number(body.dias ?? 30);
      if (para === 'pulada' && !DIAS_ADIAMENTO.includes(dias as (typeof DIAS_ADIAMENTO)[number])) return fail('Adiamento inválido.');
      const acao = await first<AcaoRow>('SELECT * FROM analise_acoes WHERE id=?', [acaoId]);
      if (!acao) return fail('Sugestão não encontrada.', 404);
      if (acao.status !== body.de) return ok({ error: 'A sugestão mudou de situação. Atualize a tela.', codigo: 'revisao' }, { status: 409 });
      if (para === 'pendente' && !['feita', 'rejeitada', 'pulada'].includes(acao.status)) return fail('Só dá para reabrir sugestão feita, pulada ou rejeitada.');
      if (para !== 'pendente' && acao.status !== 'pendente' && !(acao.status === 'pulada' && para !== 'pulada')) return fail('Esta sugestão não está pendente.');
      const ts = now(), adiada = para === 'pulada' ? somarDias(dataDeNegocio(), dias) : null;
      const texto = para === 'pulada' ? `Adiada por ${dias} dias${motivo ? `: ${motivo}` : ''}` : motivo || null;
      const db = rawDb(), eventoId = contexto.id('aev');
      const r = await db.batch([
        db.prepare(`UPDATE analise_acoes SET status=?,adiada_ate=?,motivo=?,atualizada_em=?,resolvida_em=?,resolvida_por=? WHERE id=? AND status=?`)
          .bind(para, adiada, para === 'pendente' ? null : texto, ts, para === 'pendente' ? null : ts, para === 'pendente' ? null : user.id, acaoId, acao.status),
        db.prepare('INSERT INTO analise_acoes_eventos(id,acao_id,user_id,de,para,motivo,criado_em) SELECT ?,?,?,?,?,?,? WHERE changes()=1')
          .bind(eventoId, acaoId, user.id, acao.status, para, texto, ts),
        db.prepare(`INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at)
          SELECT ?,?,'UPDATE','analise_acao',?,?,? WHERE EXISTS(SELECT 1 FROM analise_acoes_eventos WHERE id=?)`)
          .bind(contexto.id('aud'), user.id, acaoId, `${acao.titulo}: ${acao.status} → ${para}${texto ? ` (${texto})` : ''}`, ts, eventoId),
      ]);
      return r[0].meta.changes ? ok({ success: true, status: para, adiadaAte: adiada }) : ok({ error: 'A sugestão mudou de situação. Atualize a tela.', codigo: 'revisao' }, { status: 409 });
    });
  }

  return { receberDia, painel, fornecedor, concluirEnvio, gerarAcoes, listarAcoes, resolverAcao };
}
