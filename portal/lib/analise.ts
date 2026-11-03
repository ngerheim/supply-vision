import { EntradaInvalida } from './limites-entrada.ts';

// Compras ja comparadas pelo Alertas (uma linha por item de OS). O Alertas
// reenvia cada dia inteiro; o Portal troca as linhas daquela data de uma vez.
export const SCHEMA_ANALISE = [
  `CREATE TABLE IF NOT EXISTS compras_comparadas (
    id INTEGER PRIMARY KEY, data TEXT NOT NULL, grupo TEXT, os TEXT, cidade TEXT, fornecedor TEXT, cnpj TEXT,
    modelo TEXT, item TEXT, qtd REAL, preco_os REAL, preco_acordo REAL, total_os REAL, total_acordo REAL,
    dif_total REAL, status TEXT NOT NULL, motivo TEXT, tinha_acordo INTEGER NOT NULL DEFAULT 0,
    menor_preco REAL, fornecedor_acordo TEXT, dif_menor REAL, recebido_em TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_compras_comparadas_data ON compras_comparadas(data)',
];

export const STATUS_ELEGIVEIS = ['CONFORME', 'ACIMA DO ACORDO', 'ABAIXO DO ACORDO', 'SEM ACORDO'] as const;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const LIMITE_LINHAS_DIA = 20000;

export type LinhaCompra = {
  grupo: string | null; os: string | null; cidade: string | null; fornecedor: string | null; cnpj: string | null;
  modelo: string | null; item: string | null; qtd: number | null; precoOs: number | null; precoAcordo: number | null;
  totalOs: number | null; totalAcordo: number | null; difTotal: number | null; status: string; motivo: string | null;
  tinhaAcordo: boolean; menorPreco: number | null; fornecedorAcordo: string | null; difMenor: number | null;
};

const texto = (v: unknown, max = 200) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new EntradaInvalida('Campo de texto inválido na compra.');
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const numero = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EntradaInvalida('Campo numérico inválido na compra.');
  return v;
};

export function validarDia(body: unknown): { data: string; linhas: LinhaCompra[] } {
  if (!body || typeof body !== 'object') throw new EntradaInvalida('Corpo inválido.');
  const { data, linhas } = body as { data?: unknown; linhas?: unknown };
  if (typeof data !== 'string' || !DATA.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) throw new EntradaInvalida('Data inválida.');
  if (!Array.isArray(linhas)) throw new EntradaInvalida('Envie a lista de linhas.');
  if (linhas.length > LIMITE_LINHAS_DIA) throw new EntradaInvalida('Linhas demais para um dia.');
  return { data, linhas: linhas.map(l => {
    if (!l || typeof l !== 'object') throw new EntradaInvalida('Linha de compra inválida.');
    const r = l as Record<string, unknown>;
    const status = texto(r.status, 60);
    if (!status) throw new EntradaInvalida('Linha de compra sem situação.');
    return {
      grupo: texto(r.grupo), os: texto(r.os, 60), cidade: texto(r.cidade), fornecedor: texto(r.fornecedor), cnpj: texto(r.cnpj, 20),
      modelo: texto(r.modelo), item: texto(r.item), qtd: numero(r.qtd), precoOs: numero(r.precoOs), precoAcordo: numero(r.precoAcordo),
      totalOs: numero(r.totalOs), totalAcordo: numero(r.totalAcordo), difTotal: numero(r.difTotal), status, motivo: texto(r.motivo),
      tinhaAcordo: r.tinhaAcordo === 'SIM' || r.tinhaAcordo === true, menorPreco: numero(r.menorPreco),
      fornecedorAcordo: texto(r.fornecedorAcordo), difMenor: numero(r.difMenor),
    };
  }) };
}

export type FiltrosAnalise = { de: string; ate: string; cidade: string[]; fornecedor: string[]; grupo: string[] };

// Sem periodo informado: ultimos 90 dias, mas nunca antes do corte de
// vigencia. Antes dele as compras sao comparadas com a tabela atual de
// acordos e nao medem o desempenho daquele mes.
export function lerFiltros(params: URLSearchParams, padraoAte: string, corte: string | null = null): FiltrosAnalise {
  const ate = params.get('ate') || padraoAte;
  const noventa = subtrairDias(ate, 89);
  const de = params.get('de') || (corte && corte > noventa && corte <= ate ? corte : noventa);
  if (!DATA.test(de) || !DATA.test(ate) || de > ate) throw new EntradaInvalida('Período inválido.');
  const lista = (nome: string) => [...new Set(params.getAll(nome).filter(Boolean))].slice(0, 50);
  return { de, ate, cidade: lista('cidade'), fornecedor: lista('fornecedor'), grupo: lista('grupo') };
}

export function subtrairDias(data: string, dias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

// WHERE comum: periodo, filtros e somente situacoes comparaveis.
export function filtroSql(f: FiltrosAnalise) {
  const where = ['c.data BETWEEN ? AND ?', `c.status IN (${STATUS_ELEGIVEIS.map(() => '?').join(',')})`];
  const values: unknown[] = [f.de, f.ate, ...STATUS_ELEGIVEIS];
  for (const [coluna, lista] of [['c.cidade', f.cidade], ['c.fornecedor', f.fornecedor], ['c.grupo', f.grupo]] as const) {
    if (!lista.length) continue;
    where.push(`${coluna} IN (${lista.map(() => '?').join(',')})`);
    values.push(...lista);
  }
  return { where: where.join(' AND '), values };
}

// Classe ABC pelo acumulado do gasto: A ate 80%, B ate 95%, C o resto.
export function curvaAbc<T extends { gasto: number }>(linhas: readonly T[]) {
  const total = linhas.reduce((s, l) => s + l.gasto, 0);
  let acumulado = 0;
  return linhas.map(l => {
    const antes = acumulado;
    acumulado += l.gasto;
    const pct = total ? l.gasto / total : 0;
    const classe = total && antes / total < 0.8 ? 'A' : total && antes / total < 0.95 ? 'B' : 'C';
    return { ...l, pct, acumulado: total ? acumulado / total : 0, classe };
  });
}

// Mediana, nunca media: lancamentos errados no sistema (unidade trocada, mao
// de obra embutida) deformam a media e mal mexem na mediana.
export function mediana(valores: readonly number[]): number | null {
  const v = valores.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

// Pareto 20/80: quanto do gasto vem dos 20% maiores e quantos fazem 80%.
export function pareto(gastos: readonly number[]) {
  const v = gastos.filter(g => g > 0).sort((a, b) => b - a);
  const total = v.reduce((s, g) => s + g, 0);
  const top20 = Math.ceil(v.length * 0.2);
  let acumulado = 0, ate80 = 0;
  for (const g of v) {
    if (total && acumulado / total >= 0.8) break;
    acumulado += g;
    ate80++;
  }
  return {
    total: v.length,
    top20: { quantidade: top20, participacao: total ? v.slice(0, top20).reduce((s, g) => s + g, 0) / total : null },
    ate80: { quantidade: ate80, percentual: v.length ? ate80 / v.length : null },
  };
}

export const MINIMO_COMPRAS_PRECO = 3;
type PrecoLinha = { item: string; modelo: string; cidade: string; preco: number };
// Mesmo item e modelo, mediana do preco unitario por cidade. Cidade com menos
// de tres compras fica de fora: um lancamento so nao vira referencia.
export function variacaoPorCidade(linhas: readonly PrecoLinha[], limite = 10) {
  const grupos = new Map<string, { item: string; modelo: string; cidades: Map<string, number[]> }>();
  for (const l of linhas) {
    if (!(l.preco > 0) || !l.item || !l.cidade) continue;
    const chave = `${l.item}\u0000${l.modelo ?? ''}`;
    if (!grupos.has(chave)) grupos.set(chave, { item: l.item, modelo: l.modelo, cidades: new Map() });
    const g = grupos.get(chave)!;
    if (!g.cidades.has(l.cidade)) g.cidades.set(l.cidade, []);
    g.cidades.get(l.cidade)!.push(l.preco);
  }
  const resultado = [];
  for (const g of grupos.values()) {
    const cidades = [...g.cidades].filter(([, p]) => p.length >= MINIMO_COMPRAS_PRECO)
      .map(([cidade, p]) => ({ cidade, preco: mediana(p)!, compras: p.length }))
      .sort((a, b) => a.preco - b.preco);
    if (cidades.length < 2 || !cidades[0].preco) continue;
    const menor = cidades[0], maior = cidades[cidades.length - 1];
    resultado.push({ item: g.item, modelo: g.modelo, cidades: cidades.length, menor, maior, variacao: maior.preco / menor.preco - 1 });
  }
  return resultado.sort((a, b) => b.variacao - a.variacao).slice(0, limite);
}

export const SCHEMA_ANALISE_ACOES = [
  'CREATE TABLE IF NOT EXISTS analise_parametros (chave TEXT PRIMARY KEY, valor TEXT NOT NULL, atualizado_em TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS analise_acoes (
    id TEXT PRIMARY KEY, chave TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL, titulo TEXT NOT NULL, detalhe TEXT NOT NULL,
    impacto REAL NOT NULL, filtro TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pendente','feita','pulada','rejeitada','encerrada')),
    adiada_ate TEXT, motivo TEXT, criada_em TEXT NOT NULL, atualizada_em TEXT NOT NULL, vista_em TEXT NOT NULL,
    resolvida_em TEXT, resolvida_por TEXT REFERENCES users(id))`,
  'CREATE INDEX IF NOT EXISTS idx_analise_acoes_status ON analise_acoes(status, impacto DESC)',
  `CREATE TABLE IF NOT EXISTS analise_acoes_eventos (
    id TEXT PRIMARY KEY, acao_id TEXT NOT NULL REFERENCES analise_acoes(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id), de TEXT, para TEXT NOT NULL, motivo TEXT, criado_em TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_analise_acoes_eventos_recentes ON analise_acoes_eventos(criado_em DESC)',
];
