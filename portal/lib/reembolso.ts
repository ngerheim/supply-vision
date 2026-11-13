import { EntradaInvalida } from './limites-entrada.ts';

// Aba Reembolso: calculo de manutencao reembolsavel de veiculos leves
// (substitui a calculadora em HTML que circulava por arquivo). Clientes,
// taxas e tabelas MTBF ficam no banco e valem na hora para todos; cada
// calculo salvo guarda a taxa e os valores usados no dia.
export const SCHEMA_REEMBOLSO = [
  `CREATE TABLE IF NOT EXISTS reembolso_tabelas (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE COLLATE NOCASE, padrao INTEGER NOT NULL DEFAULT 0 CHECK(padrao IN (0,1)),
    revision INTEGER NOT NULL DEFAULT 0, atualizado_em TEXT NOT NULL)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_reembolso_tabela_padrao ON reembolso_tabelas(padrao) WHERE padrao=1',
  `CREATE TABLE IF NOT EXISTS reembolso_itens (
    id TEXT PRIMARY KEY, tabela_id TEXT NOT NULL REFERENCES reembolso_tabelas(id) ON DELETE CASCADE, ordem INTEGER NOT NULL,
    descricao TEXT NOT NULL, tipo TEXT CHECK(tipo IN ('INTEGRAL','PROPORCIONAL')), valores TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_reembolso_itens_tabela ON reembolso_itens(tabela_id, ordem)',
  `CREATE TABLE IF NOT EXISTS reembolso_clientes (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE COLLATE NOCASE, taxa REAL CHECK(taxa IS NULL OR (taxa>=0 AND taxa<=1)),
    pneu_km INTEGER, observacao TEXT, executivo TEXT, tabela_id TEXT REFERENCES reembolso_tabelas(id),
    ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0,1)), revision INTEGER NOT NULL DEFAULT 0, atualizado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reembolso_calculos (
    id TEXT PRIMARY KEY, placa TEXT, cliente TEXT, taxa REAL NOT NULL, categoria TEXT NOT NULL, modelo TEXT, km_atual INTEGER NOT NULL,
    os_atual TEXT, observacao TEXT, tabela TEXT, itens TEXT NOT NULL, total_custo REAL NOT NULL, total_reembolso REAL NOT NULL, fornecedor TEXT,
    user_id TEXT NOT NULL REFERENCES users(id), criado_em TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_reembolso_calculos_placa ON reembolso_calculos(placa, criado_em DESC)',
  'CREATE INDEX IF NOT EXISTS idx_reembolso_calculos_data ON reembolso_calculos(criado_em DESC, id DESC)',
];

export const CATEGORIAS = [
  ['HATCH_SEDAN', 'Hatch e sedan'], ['PICKUP_LEVE', 'Pick-up leve'], ['SUV', 'SUV'], ['PICKUP_4X4', 'Pick-up 4x4'], ['VAN', 'Van'],
] as const;
export type Categoria = (typeof CATEGORIAS)[number][0];
export const CATEGORIAS_IDS: readonly string[] = CATEGORIAS.map(c => c[0]);
export const TIPOS = ['INTEGRAL', 'PROPORCIONAL'] as const;
export type Tipo = (typeof TIPOS)[number];
// Valor da MTBF por categoria: km, texto ("24 MESES", "Conforme manual") ou vazio.
export type ValorMtbf = number | string | null;
export type ItemMtbf = { descricao: string; tipo: Tipo | null; valores: Partial<Record<Categoria, ValorMtbf>> };
export const LIMITE_ITENS_TABELA = 500;
export const LIMITE_ITENS_CALCULO = 100;

// Mesmas formulas da planilha CALCULO_MANUTENCAO_REEMBOLSAVEL_LEVES:
// km restante = km de troca - (km atual - ultima troca); avaria = valor total
// / km de troca x km restante; base = valor total (integral) ou avaria
// (proporcional); reembolso = (base + diferenca de pneu) x (1 + taxa).
// Resultado negativo vira zero.
export type EntradaItem = { tipo: Tipo; kmTroca: number; ultimaTroca: number; qtd: number; valorUnit: number; diferencaPneu: number };
export function calcularItem(item: EntradaItem, kmAtual: number, taxa: number) {
  const valorTotal = item.qtd * item.valorUnit;
  const kmRestante = item.kmTroca > 0 ? item.kmTroca - (kmAtual - item.ultimaTroca) : 0;
  const valorPorKm = item.kmTroca > 0 ? valorTotal / item.kmTroca : 0;
  const avaria = valorPorKm * kmRestante;
  const base = (item.tipo === 'INTEGRAL' ? valorTotal : avaria) + item.diferencaPneu;
  let valorTaxa = base * taxa, reembolso = base * (1 + taxa);
  if (!(reembolso > 0)) { reembolso = 0; valorTaxa = 0; }
  return { valorTotal, kmRestante, valorPorKm, avaria, valorTaxa, reembolso };
}
export function calcularTotais(itens: readonly EntradaItem[], kmAtual: number, taxa: number) {
  let custo = 0, reembolso = 0, taxaTotal = 0;
  for (const item of itens) {
    const r = calcularItem(item, kmAtual, taxa);
    custo += r.valorTotal; reembolso += r.reembolso; taxaTotal += r.valorTaxa;
  }
  return { custo, reembolso, taxa: taxaTotal };
}
export const centavos = (v: number) => Math.round(v * 100) / 100;

const texto = (v: unknown, max: number, campo: string) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new EntradaInvalida(`Campo inválido: ${campo}.`);
  const t = v.trim();
  if (t.length > max) throw new EntradaInvalida(`${campo}: máximo de ${max} caracteres.`);
  return t || null;
};
const numero = (v: unknown, campo: string, { min = 0, max = 1e9 } = {}) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (n === null || n === undefined || n === '') return 0;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new EntradaInvalida(`Valor inválido: ${campo}.`);
  return n;
};
export const tipoValido = (v: unknown): Tipo | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw new EntradaInvalida('Tipo de ressarcimento inválido.');
  const t = v.trim().toUpperCase().replace('PRO-RATA', 'PROPORCIONAL');
  if (!TIPOS.includes(t as Tipo)) throw new EntradaInvalida('Tipo de ressarcimento inválido.');
  return t as Tipo;
};
export function valorMtbf(v: unknown): ValorMtbf {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0 || v > 10_000_000) throw new EntradaInvalida('KM da MTBF inválido.');
    return v;
  }
  if (typeof v !== 'string') throw new EntradaInvalida('Valor da MTBF inválido.');
  const t = v.trim();
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(t)) return valorMtbf(Number(t.replace(/\./g, '')));
  if (t.length > 40) throw new EntradaInvalida('Texto da MTBF: máximo de 40 caracteres.');
  return t;
}

export function validarItensTabela(v: unknown): ItemMtbf[] {
  if (!Array.isArray(v)) throw new EntradaInvalida('Envie a lista de itens da tabela.');
  if (v.length > LIMITE_ITENS_TABELA) throw new EntradaInvalida('Itens demais na tabela MTBF.');
  return v.map(x => {
    if (!x || typeof x !== 'object') throw new EntradaInvalida('Item da tabela inválido.');
    const i = x as Record<string, unknown>;
    const descricao = texto(i.descricao, 200, 'Peça/serviço');
    if (!descricao) throw new EntradaInvalida('Todo item da tabela precisa de descrição.');
    const valores: ItemMtbf['valores'] = {};
    const brutos = (i.valores && typeof i.valores === 'object' ? i.valores : {}) as Record<string, unknown>;
    for (const cat of CATEGORIAS_IDS) {
      const valor = valorMtbf(brutos[cat]);
      if (valor !== null) valores[cat as Categoria] = valor;
    }
    return { descricao, tipo: tipoValido(i.tipo), valores };
  });
}

export type ClienteEntrada = { nome: string; taxa: number | null; pneuKm: number | null; observacao: string | null; executivo: string | null; tabelaId: string | null; ativo: boolean };
export function validarCliente(v: unknown): ClienteEntrada {
  if (!v || typeof v !== 'object') throw new EntradaInvalida('Cliente inválido.');
  const c = v as Record<string, unknown>;
  const nome = texto(c.nome, 200, 'Cliente');
  if (!nome) throw new EntradaInvalida('Informe o nome do cliente.');
  const taxa = c.taxa === null || c.taxa === undefined || c.taxa === '' ? null : numero(c.taxa, 'taxa', { max: 1 });
  const pneuKm = c.pneuKm === null || c.pneuKm === undefined || c.pneuKm === '' ? null : Math.round(numero(c.pneuKm, 'KM do pneu', { max: 1e7 }));
  return {
    nome, taxa, pneuKm, observacao: texto(c.observacao, 500, 'Observação'), executivo: texto(c.executivo, 80, 'Executivo'),
    tabelaId: typeof c.tabelaId === 'string' && c.tabelaId ? c.tabelaId : null, ativo: c.ativo !== false,
  };
}

// precoAcordado/acordo: condicao do acordo do fornecedor escolhida para a linha
// (so conferencia interna; nao entra no calculo nem na impressao).
export type ItemCalculo = EntradaItem & { peca: string | null; referencia: string | null; origemUltimaTroca: string | null; precoAcordado: number | null; acordo: string | null };
export type CalculoEntrada = {
  placa: string | null; cliente: string | null; taxa: number; categoria: Categoria; modelo: string | null; kmAtual: number;
  osAtual: string | null; observacao: string | null; tabela: string | null; fornecedor: string | null; itens: ItemCalculo[];
};
export function validarCalculo(v: unknown): CalculoEntrada {
  if (!v || typeof v !== 'object') throw new EntradaInvalida('Cálculo inválido.');
  const c = v as Record<string, unknown>;
  if (!CATEGORIAS_IDS.includes(String(c.categoria))) throw new EntradaInvalida('Categoria inválida.');
  if (!Array.isArray(c.itens) || !c.itens.length) throw new EntradaInvalida('Inclua ao menos um item no cálculo.');
  if (c.itens.length > LIMITE_ITENS_CALCULO) throw new EntradaInvalida('Itens demais no cálculo.');
  const itens = c.itens.map((x): ItemCalculo => {
    if (!x || typeof x !== 'object') throw new EntradaInvalida('Item do cálculo inválido.');
    const i = x as Record<string, unknown>;
    return {
      peca: texto(i.peca, 200, 'Peça'), referencia: texto(i.referencia, 200, 'Referência MTBF'),
      tipo: tipoValido(i.tipo) ?? 'PROPORCIONAL', kmTroca: numero(i.kmTroca, 'KM de troca', { max: 1e7 }),
      ultimaTroca: numero(i.ultimaTroca, 'última troca', { max: 1e8 }), qtd: numero(i.qtd, 'quantidade', { max: 1e5 }),
      valorUnit: numero(i.valorUnit, 'valor unitário', { max: 1e8 }), diferencaPneu: numero(i.diferencaPneu, 'diferença de pneu', { min: -1e8, max: 1e8 }),
      origemUltimaTroca: texto(i.origemUltimaTroca, 80, 'Origem da última troca'),
      precoAcordado: i.precoAcordado === null || i.precoAcordado === undefined || i.precoAcordado === '' ? null : numero(i.precoAcordado, 'preço acordado', { max: 1e8 }),
      acordo: texto(i.acordo, 300, 'Condição do acordo'),
    };
  });
  const placa = texto(c.placa, 10, 'Placa')?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  return {
    placa, cliente: texto(c.cliente, 200, 'Cliente'), taxa: numero(c.taxa, 'taxa', { max: 1 }), categoria: c.categoria as Categoria,
    modelo: texto(c.modelo, 80, 'Modelo'), kmAtual: Math.round(numero(c.kmAtual, 'KM atual', { max: 1e8 })), osAtual: texto(c.osAtual, 30, 'OS'),
    observacao: texto(c.observacao, 2000, 'Observação'), tabela: texto(c.tabela, 200, 'Tabela MTBF'), fornecedor: texto(c.fornecedor, 200, 'Fornecedor'), itens,
  };
}

// Importacao unica da calculadora em HTML: le as constantes de dados do
// arquivo (sem executar nada) e devolve tabelas e clientes ja validados.
export type Importacao = {
  tabelas: { chave: string; nome: string; padrao: boolean; itens: ItemMtbf[] }[];
  clientes: (Omit<ClienteEntrada, 'tabelaId'> & { tabela: string | null })[];
};
function constante(html: string, nome: string): unknown {
  const m = new RegExp(`const ${nome} = (.*?);\\n`).exec(html);
  if (!m) throw new EntradaInvalida(`O arquivo não tem os dados ${nome} da calculadora.`);
  try { return JSON.parse(m[1]); } catch { throw new EntradaInvalida(`Dados ${nome} ilegíveis no arquivo.`); }
}
export function lerCalculadoraHtml(html: string): Importacao {
  const clientes = constante(html, 'CLIENTES'), mapa = constante(html, 'CLIENT_MTBF_MAP');
  const especifico = constante(html, 'MTBF_ESPECIFICO'), padrao = constante(html, 'MTBF_PADRAO');
  let rotulos: Record<string, string> = {};
  try { rotulos = constante(html, 'MTBF_ORIGEM_LABELS') as Record<string, string>; } catch { /* rotulos sao opcionais */ }
  if (!Array.isArray(clientes) || !mapa || typeof mapa !== 'object' || !especifico || typeof especifico !== 'object' || !padrao || typeof padrao !== 'object') {
    throw new EntradaInvalida('Estrutura de dados da calculadora não reconhecida.');
  }
  const p = padrao as Record<string, { desc: string; km: unknown; tipo: unknown; starred?: boolean }[]>;
  const base = p[CATEGORIAS_IDS[0]] ?? [];
  const tabelas: Importacao['tabelas'] = [{
    chave: 'PADRAO', nome: 'MTBF padrão', padrao: true,
    itens: validarItensTabela(base.map((it, i) => ({
      descricao: (it.starred ? '★ ' : '') + it.desc, tipo: it.tipo,
      valores: Object.fromEntries(CATEGORIAS_IDS.map(cat => [cat, p[cat]?.[i]?.desc === it.desc ? p[cat][i].km : null])),
    }))),
  }];
  for (const [chave, itens] of Object.entries(especifico as Record<string, { desc: string; tipo: unknown; km: Record<string, unknown> }[]>)) {
    tabelas.push({ chave, nome: String(rotulos[chave] || chave).slice(0, 200), padrao: false,
      itens: validarItensTabela(itens.map(it => ({ descricao: it.desc, tipo: it.tipo, valores: it.km }))) });
  }
  const vistos = new Set<string>();
  const lista = (clientes as Record<string, unknown>[]).flatMap(c => {
    const nome = typeof c.nome === 'string' ? c.nome.trim() : '';
    if (!nome || vistos.has(nome.toLowerCase())) return [];
    vistos.add(nome.toLowerCase());
    const obs = typeof c.obs === 'string' && !/^SEM OBSERVA/i.test(c.obs.trim()) ? c.obs : null;
    const { tabelaId: _ignorado, ...resto } = validarCliente({ nome, taxa: c.taxa, pneuKm: c.pneuKm, observacao: obs, executivo: c.executivo });
    void _ignorado;
    const chave = (mapa as Record<string, string>)[nome];
    return [{ ...resto, tabela: chave && tabelas.some(t => t.chave === chave) ? chave : null }];
  });
  return { tabelas, clientes: lista };
}
