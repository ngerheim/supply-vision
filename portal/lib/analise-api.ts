import { pode } from './permissoes.ts';
import { dataDeNegocio } from './data-negocio.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';
import { curvaAbc, filtroSql, lerFiltros, validarDia } from './analise.ts';

type Num = number | null;
const n = (v: Num | undefined) => Number(v ?? 0);
const razao = (a: number, b: number) => (b ? a / b : null);

export function analiseApi(contexto: ContextoApi) {
  const { rawDb, now, ok, fail, all, first, jsonBody } = contexto;

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
    const f = lerFiltros(params, limites?.max || dataDeNegocio());
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

    const [mensal, acima, semFornecedores, semItens, motivos, fornecedores, precos, opcoes] = await Promise.all([
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
      all<{ fornecedor: string; gasto: number; linhas: number }>(`SELECT c.fornecedor, SUM(c.total_os) gasto, COUNT(*) linhas
        ${de} GROUP BY c.fornecedor HAVING SUM(c.total_os)>0 ORDER BY gasto DESC`, values),
      // Mesmo item e modelo, preco medio por cidade: onde a diferenca e maior.
      all<{ item: string; modelo: string; cidade: string; preco: number; linhas: number }>(`SELECT c.item, c.modelo, c.cidade,
        SUM(c.total_os)/SUM(c.qtd) preco, COUNT(*) linhas ${de} AND c.qtd>0
        GROUP BY c.item, c.modelo, c.cidade`, values),
      all<{ campo: string; valor: string }>(`SELECT 'cidade' campo, cidade valor FROM compras_comparadas WHERE cidade IS NOT NULL GROUP BY cidade
        UNION ALL SELECT 'fornecedor', fornecedor FROM compras_comparadas WHERE fornecedor IS NOT NULL GROUP BY fornecedor
        UNION ALL SELECT 'grupo', grupo FROM compras_comparadas WHERE grupo IS NOT NULL GROUP BY grupo ORDER BY 1,2`),
    ]);

    const abc = curvaAbc(fornecedores.map(l => ({ ...l, gasto: Number(l.gasto) })));
    const classes = ['A', 'B', 'C'].map(classe => {
      const da = abc.filter(l => l.classe === classe);
      return { classe, fornecedores: da.length, gasto: da.reduce((s, l) => s + l.gasto, 0) };
    });

    const porItem = new Map<string, { item: string; modelo: string; cidades: { cidade: string; preco: number; linhas: number }[] }>();
    for (const p of precos) {
      const chave = `${p.item}\u0000${p.modelo}`;
      if (!porItem.has(chave)) porItem.set(chave, { item: p.item, modelo: p.modelo, cidades: [] });
      porItem.get(chave)!.cidades.push({ cidade: p.cidade, preco: Number(p.preco), linhas: Number(p.linhas) });
    }
    const variacaoPreco = [...porItem.values()].filter(i => i.cidades.length > 1).map(i => {
      const ordenadas = [...i.cidades].sort((a, b) => a.preco - b.preco);
      const menor = ordenadas[0], maior = ordenadas[ordenadas.length - 1];
      return { item: i.item, modelo: i.modelo, cidades: i.cidades.length, menor, maior, variacao: menor.preco ? maior.preco / menor.preco - 1 : null };
    }).filter(v => v.variacao !== null).sort((a, b) => (b.variacao ?? 0) - (a.variacao ?? 0)).slice(0, 10);

    const listas: Record<string, string[]> = { cidade: [], fornecedor: [], grupo: [] };
    for (const o of opcoes) listas[o.campo]?.push(o.valor);

    return ok({
      filtros: f, disponivel: { de: limites?.min ?? null, ate: limites?.max ?? null, atualizadoEm: limites?.recebido ?? null },
      indicadores, mensal, acimaPorFornecedor: acima, semAcordoFornecedores: semFornecedores, semAcordoItens: semItens,
      motivosSemAcordo: motivos, abc: { classes, fornecedores: abc.slice(0, 20) }, variacaoPreco, opcoes: listas,
    });
  }

  return { receberDia, painel };
}
