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

export function lerFiltros(params: URLSearchParams, padraoAte: string): FiltrosAnalise {
  const ate = params.get('ate') || padraoAte;
  const de = params.get('de') || subtrairDias(ate, 89);
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
