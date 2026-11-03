import { EntradaInvalida } from './limites-entrada.ts';

// Rodadas do alerta de conformidade de precos. Cada execucao agendada do
// Alertas publica aqui o mesmo conteudo que ia por e-mail: as linhas acima e
// abaixo do acordo e o resumo da comparacao. A chave e o horario agendado;
// reexecutar o mesmo horario substitui a rodada, sem duplicar nem avisar de novo.
export const SCHEMA_ALERTAS = [
  `CREATE TABLE IF NOT EXISTS alertas_rodadas (
    id TEXT PRIMARY KEY, chave TEXT NOT NULL UNIQUE, contexto TEXT NOT NULL, datas TEXT NOT NULL,
    resumo TEXT NOT NULL, linhas INTEGER NOT NULL, acima INTEGER NOT NULL, abaixo INTEGER NOT NULL,
    dif_acima REAL NOT NULL, dif_abaixo REAL NOT NULL, qualidade_pendente INTEGER NOT NULL DEFAULT 0,
    recebida_em TEXT NOT NULL, atualizada_em TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_alertas_rodadas_recentes ON alertas_rodadas(recebida_em DESC)',
  `CREATE TABLE IF NOT EXISTS alertas_linhas (
    id INTEGER PRIMARY KEY, rodada_id TEXT NOT NULL REFERENCES alertas_rodadas(id) ON DELETE CASCADE,
    data TEXT, os TEXT, criador TEXT, cidade TEXT, uf TEXT, fornecedor TEXT, cnpj TEXT, modelo TEXT, item TEXT,
    qtd REAL, preco_os REAL, preco_acordo REAL, total_os REAL, total_acordo REAL, dif_unit REAL, dif_total REAL,
    status TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_alertas_linhas_rodada ON alertas_linhas(rodada_id)',
  `CREATE TABLE IF NOT EXISTS alertas_destinatarios (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, incluido_por TEXT, incluido_em TEXT NOT NULL)`,
];

export const CONTEXTOS_ALERTA = {
  manha: 'Dia anterior',
  segunda_manha: 'Fim de semana',
  parcial: 'Parcial',
  compilado: 'Compilado final',
} as const;
export type ContextoAlerta = keyof typeof CONTEXTOS_ALERTA;
export const STATUS_ALERTA = ['ACIMA DO ACORDO', 'ABAIXO DO ACORDO'] as const;
export const LIMITE_LINHAS_RODADA = 20000;
// Rodadas antigas saem sozinhas; a Analise guarda o historico agregado.
export const DIAS_RETENCAO_ALERTAS = 180;

const CHAVE = /^[A-Za-z0-9_-]{1,80}$/;
const DATA_BR = /^\d{2}\/\d{2}\/\d{4}$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export type LinhaAlerta = {
  data: string | null; os: string | null; criador: string | null; cidade: string | null; uf: string | null;
  fornecedor: string | null; cnpj: string | null; modelo: string | null; item: string | null; qtd: number | null;
  precoOs: number | null; precoAcordo: number | null; totalOs: number | null; totalAcordo: number | null;
  difUnit: number | null; difTotal: number | null; status: (typeof STATUS_ALERTA)[number];
};
export type ResumoAlerta = {
  totalBruto: number; totalElegivel: number; conformes: number; acima: number; abaixo: number; semAcordo: number;
  pendencias: number; percentualPendencias: number; alertaPendencias: boolean;
};
export type RodadaAlerta = {
  chave: string; contexto: ContextoAlerta; datas: string[]; resumo: ResumoAlerta; qualidadePendente: boolean; linhas: LinhaAlerta[];
};

const texto = (v: unknown, max = 200) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') throw new EntradaInvalida('Campo de texto inválido no alerta.');
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const numero = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EntradaInvalida('Campo numérico inválido no alerta.');
  return v;
};
const contagem = (v: unknown) => {
  const n = v === undefined || v === null ? 0 : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new EntradaInvalida('Resumo do alerta inválido.');
  return n;
};

export function validarRodada(body: unknown): RodadaAlerta {
  if (!body || typeof body !== 'object') throw new EntradaInvalida('Corpo inválido.');
  const b = body as Record<string, unknown>;
  if (typeof b.chave !== 'string' || !CHAVE.test(b.chave)) throw new EntradaInvalida('Chave da rodada inválida.');
  if (typeof b.contexto !== 'string' || !Object.hasOwn(CONTEXTOS_ALERTA, b.contexto)) throw new EntradaInvalida('Contexto da rodada inválido.');
  if (!Array.isArray(b.datas) || !b.datas.length || b.datas.length > 7 || !b.datas.every(d => typeof d === 'string' && DATA_BR.test(d))) {
    throw new EntradaInvalida('Datas da rodada inválidas.');
  }
  if (!Array.isArray(b.linhas)) throw new EntradaInvalida('Envie a lista de linhas.');
  if (b.linhas.length > LIMITE_LINHAS_RODADA) throw new EntradaInvalida('Linhas demais para uma rodada.');
  const r = (b.resumo && typeof b.resumo === 'object' ? b.resumo : {}) as Record<string, unknown>;
  const c = (r.contagens && typeof r.contagens === 'object' ? r.contagens : {}) as Record<string, unknown>;
  const resumo: ResumoAlerta = {
    totalBruto: contagem(r.total_bruto), totalElegivel: contagem(r.total_elegivel),
    conformes: contagem(c['CONFORME']), acima: contagem(c['ACIMA DO ACORDO']), abaixo: contagem(c['ABAIXO DO ACORDO']),
    semAcordo: contagem(c['SEM ACORDO']), pendencias: contagem(r.total_quarentena),
    percentualPendencias: contagem(r.percentual_quarentena_bruto), alertaPendencias: r.alerta_pendencias === true,
  };
  const linhas = b.linhas.map((l): LinhaAlerta => {
    if (!l || typeof l !== 'object') throw new EntradaInvalida('Linha do alerta inválida.');
    const x = l as Record<string, unknown>;
    const status = texto(x.status, 60);
    if (!STATUS_ALERTA.includes(status as LinhaAlerta['status'])) throw new EntradaInvalida('Situação inválida na linha do alerta.');
    const data = texto(x.data, 10);
    if (data !== null && !DATA_ISO.test(data)) throw new EntradaInvalida('Data inválida na linha do alerta.');
    return {
      data, os: texto(x.os, 60), criador: texto(x.criador, 120), cidade: texto(x.cidade), uf: texto(x.uf, 2),
      fornecedor: texto(x.fornecedor), cnpj: texto(x.cnpj, 20), modelo: texto(x.modelo), item: texto(x.item),
      qtd: numero(x.qtd), precoOs: numero(x.precoOs), precoAcordo: numero(x.precoAcordo), totalOs: numero(x.totalOs),
      totalAcordo: numero(x.totalAcordo), difUnit: numero(x.difUnit), difTotal: numero(x.difTotal),
      status: status as LinhaAlerta['status'],
    };
  });
  return { chave: b.chave, contexto: b.contexto as ContextoAlerta, datas: b.datas as string[], resumo, qualidadePendente: b.qualidadePendente === true, linhas };
}

// "Parcial · 30/10/2026", "Fim de semana · 24/10/2026 a 26/10/2026".
export function tituloRodada(contexto: string, datas: readonly string[]) {
  const nome = CONTEXTOS_ALERTA[contexto as ContextoAlerta] ?? contexto;
  if (!datas.length) return nome;
  return `${nome} · ${datas.length === 1 ? datas[0] : `${datas[0]} a ${datas[datas.length - 1]}`}`;
}

export function textoAviso(contexto: string, datas: readonly string[], linhas: number) {
  const fora = linhas === 1 ? '1 registro fora do acordo' : `${linhas.toLocaleString('pt-BR')} registros fora do acordo`;
  return `Alertas atualizados (${tituloRodada(contexto, datas)}): ${linhas ? fora : 'nenhum registro fora do acordo'}.`;
}

export function totaisRodada(linhas: readonly LinhaAlerta[]) {
  let acima = 0, abaixo = 0, difAcima = 0, difAbaixo = 0;
  for (const l of linhas) {
    if (l.status === 'ACIMA DO ACORDO') { acima++; difAcima += l.difTotal ?? 0; }
    else { abaixo++; difAbaixo += l.difTotal ?? 0; }
  }
  return { acima, abaixo, difAcima, difAbaixo };
}
