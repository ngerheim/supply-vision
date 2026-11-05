// Configuracao ficticia do Reembolso: tabela padrao, uma tabela de cliente,
// clientes com taxas diferentes e um calculo salvo. Idempotente.
const km = (a, b = a) => ({ HATCH_SEDAN: a, PICKUP_LEVE: a, SUV: a, PICKUP_4X4: b, VAN: b });
const PADRAO = [
  ['Filtro de ar', 'INTEGRAL', km(10000, 20000)], ['Filtro de óleo do motor', 'INTEGRAL', km(10000)], ['Óleo do motor', 'INTEGRAL', km(10000)],
  ['Alinhamento de eixo', 'PROPORCIONAL', km(15000, 20000)], ['Pastilha de freio', 'PROPORCIONAL', km(30000, 40000)], ['Disco de freio', 'PROPORCIONAL', km(60000)],
  ['Pneu', 'PROPORCIONAL', km(40000)], ['Bateria', 'PROPORCIONAL', km('24 MESES')], ['Correia dentada', 'PROPORCIONAL', km(60000, 'Conforme manual')],
  ['Amortecedor', 'PROPORCIONAL', km(60000, 80000)], ['Kit embreagem', 'PROPORCIONAL', km(80000, 100000)], ['Palheta do limpador', 'INTEGRAL', km('12 MESES')],
].map(([descricao, tipo, valores]) => ({ descricao, tipo, valores }));
const CLIENTES = [
  ['Cliente Exemplo Mineração', 0.15, 'Tabela Exemplo Mineração', 'EXECUTIVO A'], ['Cliente Exemplo Agro', 0.25, null, 'EXECUTIVO B'],
  ['Cliente Exemplo Construtora', 0.1, null, 'EXECUTIVO A'], ['Cliente Exemplo Saneamento', 0.2, null, 'EXECUTIVO C'],
  ['Cliente Exemplo Energia', 0.25, 'Tabela Exemplo Mineração', 'EXECUTIVO B'], ['Cliente Exemplo Sem Taxa', null, null, null],
];
export async function semearReembolso(api) {
  let config = await api('/reembolso/config');
  if (!config.tabelas.length) {
    await api('/reembolso/tabelas', 'POST', { nome: 'MTBF padrão', itens: PADRAO });
    await api('/reembolso/tabelas', 'POST', { nome: 'Tabela Exemplo Mineração', itens: PADRAO.slice(0, 8).map(i => ({ ...i, valores: km(20000, 30000) })) });
    config = await api('/reembolso/config');
  }
  for (const [nome, taxa, tabela, executivo] of CLIENTES) {
    if (config.clientes.some(c => c.nome === nome)) continue;
    await api('/reembolso/clientes', 'POST', { nome, taxa, pneuKm: 40000, executivo, tabelaId: config.tabelas.find(t => t.nome === tabela)?.id ?? null,
      observacao: taxa === null ? 'Demonstração: cliente sem taxa cadastrada' : null });
  }
  if (!(await api('/reembolso/calculos')).total) {
    await api('/reembolso/calculos', 'POST', { placa: 'EXE1A23', cliente: 'Cliente Exemplo Agro', taxa: 0.25, categoria: 'PICKUP_LEVE', modelo: 'PICAPE EXEMPLO', kmAtual: 52000,
      itens: [{ peca: 'Pastilha dianteira', referencia: 'Pastilha de freio', tipo: 'PROPORCIONAL', kmTroca: 30000, ultimaTroca: 31000, qtd: 1, valorUnit: 420 },
        { peca: 'Filtro de ar', referencia: 'Filtro de ar', tipo: 'INTEGRAL', kmTroca: 10000, ultimaTroca: 45000, qtd: 1, valorUnit: 65 }] });
  }
}

// Historico de OS ficticio da placa do calculo de exemplo, com datas
// relativas a hoje, para a busca da ultima troca na calculadora.
const HISTORICO = [
  [400, '900101', 21000, [['FILTRO DE AR MOTOR', 1, 58], ['FILTRO DE OLEO', 1, 42], ['OLEO MOTOR 5W30', 4, 39.9]]],
  [300, '900102', 31000, [['PASTILHA FREIO DIANTEIRA', 1, 390], ['ALINHAMENTO', 1, 90]]],
  [200, '900103', 38500, [['FILTRO DE AR MOTOR', 1, 61], ['FILTRO DE OLEO', 1, 45], ['OLEO MOTOR 5W30', 4, 41.5], ['PNEU 205/60 R16', 2, 610], ['LAVAGEM COMPLETA', 1, 80, 'Lavagem (exemplo)']]],
  [90, '900104', 45000, [['FILTRO AR CONDICIONADO', 1, 49], ['FILTRO DE AR MOTOR', 1, 63], ['PALHETA LIMPADOR', 2, 35]]],
  [10, '900105', 51800, [['DISCO FREIO DIANTEIRO', 2, 280], ['PASTILHA FREIO DIANTEIRA', 1, 420]]],
];
export function historicoReembolso(hoje = new Date()) {
  const dia = d => new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - d)).toISOString().slice(0, 10);
  const linhas = HISTORICO.flatMap(([d, os, kmOs, itens]) => itens.map(([produto, qtd, valorUnit, grupo = 'Manutenção de veículos (exemplo)']) => ({
    data: dia(d), placa: 'EXE1A23', os, produto, qtd, valorUnit, total: qtd * valorUnit, reembolso: 0, km: kmOs, fornecedor: 'Oficina Exemplo', grupo, modelo: 'Picape Exemplo', cliente: 'Cliente Exemplo Agro' })));
  return { datas: [...new Set(linhas.map(l => l.data))], linhas };
}
export async function semearHistoricoReembolso(base, token, estado, salvar) {
  if (estado.historicoReembolsoConcluido || !token) return;
  const resposta = await fetch(`${base}/api/internal/reembolso-historico`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(historicoReembolso()) });
  if (!resposta.ok) throw new Error(`Falha ao semear o histórico de OS fictício (${resposta.status}).`);
  estado.historicoReembolsoConcluido = true; salvar();
}
