import { EntradaInvalida } from './limites-entrada.ts';
import { isIsoDate } from './domain.ts';

// Historico de OS para a calculadora de reembolso: consultado no Qlik sob
// demanda, uma placa por vez, e guardado por algumas horas. O cache guarda a
// resposta inteira; os filtros valem na hora de responder, entao mudar um
// filtro vale ate para o que ja esta no cache.
export const SCHEMA_REEMBOLSO_HISTORICO = [
  `CREATE TABLE IF NOT EXISTS reembolso_historico_cache (
    placa TEXT PRIMARY KEY, linhas TEXT NOT NULL, itens INTEGER NOT NULL, consultado_em TEXT NOT NULL, user_id TEXT REFERENCES users(id))`,
  'CREATE INDEX IF NOT EXISTS idx_reembolso_historico_cache_data ON reembolso_historico_cache(consultado_em)',
  // O que nao entra no historico. Valor guardado como digitado e tambem
  // normalizado (sem acento/caixa), que e como a comparacao e feita.
  `CREATE TABLE IF NOT EXISTS reembolso_historico_filtros (
    id TEXT PRIMARY KEY, coluna TEXT NOT NULL CHECK(coluna IN ('grupo','produto','fornecedor','modelo','cliente')),
    modo TEXT NOT NULL CHECK(modo IN ('igual','contem')), valor TEXT NOT NULL, valor_norm TEXT NOT NULL,
    user_id TEXT REFERENCES users(id), criado_em TEXT NOT NULL, UNIQUE(coluna, modo, valor_norm))`,
];

// Colunas que aceitam filtro.
export const COLUNAS_FILTRO = {
  grupo: 'Grupo de despesa', produto: 'Descrição (produto)', fornecedor: 'Fornecedor', modelo: 'Modelo do veículo', cliente: 'Cliente',
} as const;
export type ColunaFiltro = keyof typeof COLUNAS_FILTRO;
export type ModoFiltro = 'igual' | 'contem';
export type FiltroHistorico = { coluna: ColunaFiltro; modo: ModoFiltro; valor: string; valorNorm: string };

export const LIMITE_LINHAS_PLACA = 20000;
export const VALIDADE_CACHE_MS = 6 * 60 * 60 * 1000;

export type LinhaHistorico = {
  data: string; os: string | null; produto: string; qtd: number | null; valorUnit: number | null;
  total: number | null; reembolso: number | null; km: number | null; fornecedor: string | null;
  grupo: string | null; modelo: string | null; cliente: string | null;
};

const comoTexto = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
export const placaNormalizada = (v: unknown) => comoTexto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
export const placaValida = (placa: string) => /^[A-Z0-9]{5,10}$/.test(placa);

const texto = (v: unknown, max: number, campo: string) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new EntradaInvalida(`Campo inválido no histórico: ${campo}.`);
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const numero = (v: unknown, campo: string) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EntradaInvalida(`Campo numérico inválido no histórico: ${campo}.`);
  return v;
};

// Resposta da consulta ao Qlik: confere cada linha antes de guardar.
export function validarLinhasConsulta(linhas: unknown): LinhaHistorico[] {
  if (!Array.isArray(linhas) || linhas.length > LIMITE_LINHAS_PLACA) throw new EntradaInvalida('Resposta do Qlik inválida.');
  return linhas.map((x): LinhaHistorico => {
    if (!x || typeof x !== 'object') throw new EntradaInvalida('Linha do histórico inválida.');
    const l = x as Record<string, unknown>;
    const produto = texto(l.produto, 200, 'produto');
    if (!isIsoDate(l.data) || !produto) throw new EntradaInvalida('Linha do histórico sem data ou produto.');
    const km = numero(l.km, 'km');
    return {
      data: l.data as string, os: texto(l.os, 30, 'os'), produto, qtd: numero(l.qtd, 'qtd'), valorUnit: numero(l.valorUnit, 'valorUnit'),
      total: numero(l.total, 'total'), reembolso: numero(l.reembolso, 'reembolso'), km: km !== null && km > 0 ? Math.round(km) : null,
      fornecedor: texto(l.fornecedor, 200, 'fornecedor'), grupo: texto(l.grupo, 200, 'grupo'),
      modelo: texto(l.modelo, 200, 'modelo'), cliente: texto(l.cliente, 200, 'cliente'),
    };
  });
}

// ---- filtros do historico ----
// Comparacao sem acento, sem caixa e com espacos simples: "Lava Jato" casa
// com "LAVA  JATO". "igual" compara o valor inteiro; "contem", um trecho.
export const normalizarFiltro = (s: unknown) => comoTexto(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function validarFiltro(body: unknown): FiltroHistorico {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.coluna !== 'string' || !(b.coluna in COLUNAS_FILTRO)) throw new EntradaInvalida('Coluna do filtro inválida.');
  if (b.modo !== 'igual' && b.modo !== 'contem') throw new EntradaInvalida('Escolha "é igual a" ou "contém".');
  const valor = typeof b.valor === 'string' ? b.valor.trim().replace(/\s+/g, ' ') : '';
  const valorNorm = normalizarFiltro(valor);
  if (!valorNorm || valor.length > 200) throw new EntradaInvalida('Informe o valor do filtro (até 200 caracteres).');
  if (b.modo === 'contem' && valorNorm.length < 3) throw new EntradaInvalida('Para "contém", use ao menos 3 letras.');
  return { coluna: b.coluna as ColunaFiltro, modo: b.modo, valor, valorNorm };
}
export const valorCasa = (valor: string | null | undefined, f: Pick<FiltroHistorico, 'modo' | 'valorNorm'>) => {
  const v = normalizarFiltro(valor);
  return !!v && (f.modo === 'igual' ? v === f.valorNorm : v.includes(f.valorNorm));
};
export function aplicarFiltros(linhas: LinhaHistorico[], filtros: FiltroHistorico[]) {
  if (!filtros.length) return { mantidas: linhas, filtradas: 0 };
  const mantidas = linhas.filter(l => !filtros.some(f => valorCasa(l[f.coluna], f)));
  return { mantidas, filtradas: linhas.length - mantidas.length };
}

// ---- busca da ultima troca (mesmas regras da calculadora antiga) ----
// Os termos vem da Referencia MTBF (ou do nome da peca) e podem ser
// editados: palavras = todas precisam aparecer; "|" = alternativa;
// "-palavra" = excluir.
export const normalizar = (s: unknown) => comoTexto(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const REGRAS: [RegExp, string][] = [
  [/particulad|dpf/, 'particulado | dpf'],
  [/filtro.*oleo|oleo.*filtro/, 'filtro oleo -cambio -caixa -transmissao | elemento oleo'],
  [/filtro.*(condicionado|cabine|polen)/, 'filtro condicionado | filtro cabine | filtro polen | filtro antipolen | elemento condicionado'],
  [/filtro.*combust/, 'filtro combustivel | elemento combustivel | filtro diesel | filtro separador'],
  [/filtro.*\bar\b/, 'filtro ar -condicionado -cabine -polen -antipolen | elemento ar -condicionado'],
  [/oleo.*(marcha|cambio)/, 'oleo cambio | oleo caixa marcha | oleo transmissao | oleo 75w | oleo 80w'],
  [/oleo.*transfer/, 'oleo transferencia'],
  [/oleo.*diferenc/, 'oleo diferencial'],
  [/oleo.*direc/, 'oleo direcao | fluido direcao | oleo atf'],
  [/oleo.*motor/, 'oleo motor -filtro -elemento | oleo lubrificante -filtro -elemento -cambio -diferencial -direcao -transmissao | oleo 0w | oleo 5w | oleo 10w | oleo 15w | oleo 20w'],
  [/fluido.*freio|oleo.*freio/, 'fluido freio | oleo freio | dot4 | dot 4'],
  [/aditivo|arrefec/, 'aditivo -combustivel -diesel | liquido arrefecimento'],
  [/pastilha/, 'pastilha'],
  [/disco.*freio/, 'disco freio | disco -embreagem'],
  [/sapata/, 'sapata | lona freio'],
  [/tambor/, 'tambor'],
  [/cilindro.*roda/, 'cilindro roda'],
  [/cilindro mestre/, 'cilindro mestre'],
  [/pinca/, 'pinca'],
  [/regulagem.*freio/, 'regulagem freio'],
  [/cabo.*freio/, 'cabo freio'],
  [/regulador.*freio/, 'regulador freio'],
  [/correia dentada/, 'correia dentada | kit correia dentada | kit distribuicao | correia sincronizadora'],
  [/correia/, 'correia -dentada'],
  [/corrente.*comando/, 'corrente comando | corrente distribuicao'],
  [/vela.*aquec/, 'vela aquecedora | vela aquecimento | vela incandescencia'],
  [/vela/, 'vela -aquecedora -aquecimento -incandescencia'],
  [/bateria/, 'bateria -cabo -borne -terminal -recarga -teste -carga'],
  [/valvula.*pneu/, 'valvula pneu | bico pneu'],
  [/alinhamento/, 'alinhamento'],
  [/balanceamento/, 'balanceamento'],
  [/cambagem|caster/, 'cambagem | caster | camber'],
  [/pneu/, 'pneu -valvula -reparo -conserto -montagem -desmontagem -balanceamento -alinhamento -rodizio -calibragem -vulcanizacao'],
  [/amortecedor/, 'amortecedor'],
  [/embreagem/, 'embreagem | plato | kit embreagem'],
  [/palheta/, 'palheta'],
  [/lampada/, 'lampada'],
  [/terminal.*direc/, 'terminal direcao'],
  [/caixa.*direc/, 'caixa direcao'],
  [/bomba.*direc/, 'bomba direcao'],
  [/bieleta/, 'bieleta'],
  [/articulac/, 'articulacao | pivo'],
  [/bandeja/, 'bandeja'],
  [/cubo.*roda/, 'cubo roda | cubo -embreagem'],
  [/rolamento.*roda/, 'rolamento roda | rolamento cubo'],
  [/carga.*gas|gas.*condicionado/, 'carga gas | recarga gas | gas refrigerante | r134 | gas condicionado'],
  [/limpeza.*radiador/, 'limpeza radiador'],
  [/mangueira.*radiador/, 'mangueira radiador'],
  [/^radiador/, 'radiador -limpeza -mangueira -aditivo -tampa'],
  [/bomba.*agua/, 'bomba agua | bomba dagua'],
  [/bomba.*combust/, 'bomba combustivel'],
  [/bomba.*oleo/, 'bomba oleo'],
  [/coxim.*cambio/, 'coxim cambio'],
  [/caixa.*(marcha|cambio)/, 'caixa marcha | caixa cambio'],
  [/homocinetica/, 'homocinetica'],
  [/coifa/, 'coifa'],
  [/semieixo/, 'semieixo | semi eixo'],
  [/cruzeta/, 'cruzeta'],
  [/motor.*partida/, 'motor partida | motor arranque'],
  [/alternador/, 'alternador -correia'],
  [/bico.*injet/, 'bico injetor | injetor'],
  [/eletro ?ventilador/, 'eletroventilador | eletro ventilador | ventoinha'],
  [/tacografo/, 'tacografo'],
  [/opacidade/, 'opacidade'],
  [/guincho/, 'guincho | reboque'],
  [/compressor/, 'compressor'],
  [/condensador/, 'condensador'],
  [/turbina/, 'turbina | turbo'],
  [/\begr\b/, 'egr'],
  [/arla/, 'arla'],
  [/catalisador/, 'catalisador'],
  [/escapamento|silencios/, 'escapamento | silencioso | abafador'],
  [/feixe.*mola|^molas?$/, 'mola'],
  [/sensor abs/, 'sensor abs'],
  [/modulo abs/, 'modulo abs'],
  [/trava.*roda/, 'trava roda | parafuso antifurto'],
];
const PARADAS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'ou', 'em', 'para', 'com', 'o', 'a', 'os', 'as', 'seu', 'seus', 'sua', 'suas',
  'componentes', 'componente', 'pecas', 'peca', 'geral', 'troca', 'substituicao', 'caso', 'natureza', 'veiculo', 'veiculos']);

export function termosPadrao(textoItem: string) {
  const t = normalizar(textoItem);
  if (!t) return '';
  for (const [re, q] of REGRAS) if (re.test(t)) return q;
  return t.split(' ').filter(x => x && !PARADAS.has(x) && !/^\d+$/.test(x)).slice(0, 3).map(x => (x.length > 7 ? x.slice(0, 6) : x)).join(' ');
}
type Alternativa = { inc: string[]; exc: string[] };
export function lerTermos(q: string): Alternativa[] {
  return q.split('|').map(alt => {
    const inc: string[] = [], exc: string[] = [];
    for (const palavra of alt.trim().split(/\s+/)) {
      if (!palavra) continue;
      const neg = palavra.startsWith('-');
      for (const t of normalizar(neg ? palavra.slice(1) : palavra).split(' ').filter(Boolean)) (neg ? exc : inc).push(t);
    }
    return { inc, exc };
  }).filter(a => a.inc.length);
}
// Palavra curta so de letras (ar, gas, mao...) precisa bater inteira; as
// demais valem como inicio de palavra (pastilha -> pastilhas).
const bate = (palavras: string[], t: string) => (t.length <= 3 && /^[a-z]+$/.test(t) ? palavras.includes(t) : palavras.some(w => w.startsWith(t)));
export const produtoCasa = (produto: string, alts: Alternativa[]) => {
  const palavras = normalizar(produto).split(' ');
  return alts.some(a => a.inc.every(t => bate(palavras, t)) && !a.exc.some(t => bate(palavras, t)));
};

export type LinhaPlaca = { data: string; os: string | null; produto: string; qtd: number | null; valorUnit: number | null; total: number | null; reembolso: number | null; km: number | null; fornecedor: string | null };
export type Candidato = { os: string | null; data: string; km: number | null; produtos: string[]; total: number; reembolso: number; fornecedor: string | null;
  atual: boolean; acimaDoKm: boolean; recente: boolean; serve: boolean };

const diaCivil = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 864e5);

export function resumoPlaca(linhas: LinhaPlaca[]) {
  if (!linhas.length) return null;
  const oss = new Set<string>();
  let primeira = '', ultima = '', ultimoKm: number | null = null, dataUltimoKm = '';
  for (const l of linhas) {
    if (l.os) oss.add(l.os);
    if (!primeira || l.data < primeira) primeira = l.data;
    if (!ultima || l.data > ultima) ultima = l.data;
    if (l.km && (l.data > dataUltimoKm || (l.data === dataUltimoKm && l.km > (ultimoKm ?? 0)))) { ultimoKm = l.km; dataUltimoKm = l.data; }
  }
  return { os: oss.size, primeira, ultima, ultimoKm, dataUltimoKm };
}

// OS com itens que casam com os termos, da mais recente para a mais antiga.
// "serve" = pode virar a ultima troca automatica: nao e a OS atual, tem km
// abaixo do km atual e, sem a OS atual informada, nao e dos ultimos 30 dias
// (pode ser a propria OS em analise).
export function candidatos(linhas: LinhaPlaca[], q: string, contexto: { kmAtual: number; osAtual: string; hoje: string }): Candidato[] {
  const alts = lerTermos(q);
  if (!alts.length) return [];
  const kmDaOs = new Map<string, number>();
  for (const l of linhas) if (l.os && l.km && l.km > (kmDaOs.get(l.os) ?? 0)) kmDaOs.set(l.os, l.km);
  const porOs = new Map<string, Candidato>(), cache = new Map<string, boolean>();
  linhas.forEach((l, i) => {
    let casa = cache.get(l.produto);
    if (casa === undefined) { casa = produtoCasa(l.produto, alts); cache.set(l.produto, casa); }
    if (!casa) return;
    const chave = l.os ?? `linha-${i}`;
    let g = porOs.get(chave);
    if (!g) {
      g = { os: l.os, data: l.data, km: (l.os && kmDaOs.get(l.os)) || l.km, produtos: [], total: 0, reembolso: 0, fornecedor: l.fornecedor,
        atual: false, acimaDoKm: false, recente: false, serve: false };
      porOs.set(chave, g);
    }
    g.total += l.total ?? 0; g.reembolso += l.reembolso ?? 0;
    if (l.data > g.data) g.data = l.data;
    if (!g.km && l.km) g.km = l.km;
    if (!g.fornecedor && l.fornecedor) g.fornecedor = l.fornecedor;
    if (!g.produtos.includes(l.produto)) g.produtos.push(l.produto);
  });
  const osAtual = contexto.osAtual.replace(/\D/g, ''), hoje = diaCivil(contexto.hoje);
  return [...porOs.values()].map(c => {
    const atual = !!osAtual && (c.os ?? '').replace(/\D/g, '') === osAtual;
    const acimaDoKm = contexto.kmAtual > 0 && !!c.km && c.km >= contexto.kmAtual;
    const recente = !osAtual && hoje - diaCivil(c.data) <= 30;
    return { ...c, atual, acimaDoKm, recente, serve: !atual && !acimaDoKm && !recente && !!c.km };
  }).sort((a, b) => b.data.localeCompare(a.data) || (b.km ?? 0) - (a.km ?? 0));
}
