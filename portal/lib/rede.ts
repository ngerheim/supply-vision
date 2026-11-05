import { EntradaInvalida } from './limites-entrada.ts';
import { MUNICIPIOS_IBGE } from './municipios-ibge.ts';

// Aba Rede: fornecedores disponiveis do ERP (copia diaria vinda do Qlik pelo
// Alertas), por cidade e cidades proximas, com os acordos em destaque.
// A copia inteira e trocada de uma vez; exclusoes do admin ficam em tabelas
// proprias e sobrevivem a troca.
export const SCHEMA_REDE = [
  `CREATE TABLE IF NOT EXISTS rede_fornecedores (
    codigo TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL, razao_social TEXT, cidade TEXT, uf TEXT, ibge TEXT,
    cnpj TEXT, telefone TEXT, email TEXT, ultimo_pedido TEXT, busca TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rede_segmentos (
    codigo TEXT NOT NULL REFERENCES rede_fornecedores(codigo) ON DELETE CASCADE, segmento TEXT NOT NULL,
    PRIMARY KEY(codigo, segmento))`,
  'CREATE INDEX IF NOT EXISTS idx_rede_segmentos_segmento ON rede_segmentos(segmento)',
  `CREATE TABLE IF NOT EXISTS rede_atualizacao (
    id INTEGER PRIMARY KEY CHECK(id=1), recebida_em TEXT NOT NULL, linhas INTEGER NOT NULL, sem_coordenada INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rede_exclusoes (
    codigo TEXT PRIMARY KEY, nome TEXT NOT NULL, motivo TEXT, user_id TEXT REFERENCES users(id), criado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rede_segmentos_excluidos (
    segmento TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), criado_em TEXT NOT NULL)`,
];

export const RAIOS_REDE = [50, 100, 200, 300] as const;
export const RAIO_PADRAO_REDE = 100;
export const POR_PAGINA_REDE = 100;
export const LIMITE_FORNECEDORES_REDE = 30000;
// Uma extracao que encolhe pela metade costuma ser filtro esquecido na pasta
// do Qlik, nao fornecedores bloqueados de verdade. Mantem a copia anterior.
export const FRACAO_MINIMA_REDE = 0.5;

// Sem acento, minusculo, pontuacao vira espaco: "Olhos-D'Água" = "olhos d agua".
export function chaveTexto(valor: string) {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export const chaveCidade = (cidade: string, uf: string) => `${chaveTexto(cidade)}|${uf.toUpperCase()}`;

export type Municipio = { ibge: string; nome: string; uf: string; lat: number; lon: number };
let indice: { porCodigo: Map<string, Municipio>; porChave: Map<string, Municipio>; opcoes: { id: string; name: string }[] } | null = null;
export function municipios() {
  if (indice) return indice;
  const porCodigo = new Map<string, Municipio>(), porChave = new Map<string, Municipio>();
  for (const linha of MUNICIPIOS_IBGE.split('\n')) {
    if (!linha) continue;
    const [ibge, nome, uf, lat, lon] = linha.split(';');
    const m = { ibge, nome, uf, lat: Number(lat), lon: Number(lon) };
    porCodigo.set(ibge, m);
    porChave.set(chaveCidade(nome, uf), m);
  }
  const opcoes = [...porCodigo.values()].map(m => ({ id: m.ibge, name: `${m.nome}/${m.uf}` }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return (indice = { porCodigo, porChave, opcoes });
}
export function localizarMunicipio(cidade: string | null, uf: string | null) {
  return cidade && uf ? municipios().porChave.get(chaveCidade(cidade, uf)) ?? null : null;
}

// Distancia em linha reta (haversine), em km.
export function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type FornecedorRede = {
  codigo: string; nomeFantasia: string; razaoSocial: string | null; cidade: string | null; uf: string | null;
  cnpj: string | null; telefone: string | null; email: string | null; ultimoPedido: string | null; segmentos: string[];
};

const texto = (v: unknown, max = 200) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') throw new EntradaInvalida('Campo de texto inválido na lista de fornecedores.');
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

export function validarSnapshotRede(body: unknown): { linhas: FornecedorRede[]; aceitarQueda: boolean } {
  if (!body || typeof body !== 'object') throw new EntradaInvalida('Corpo inválido.');
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.linhas)) throw new EntradaInvalida('Envie a lista de fornecedores.');
  if (b.linhas.length > LIMITE_FORNECEDORES_REDE) throw new EntradaInvalida('Fornecedores demais numa só lista.');
  const vistos = new Set<string>();
  const linhas = b.linhas.map((l): FornecedorRede => {
    if (!l || typeof l !== 'object') throw new EntradaInvalida('Fornecedor inválido na lista.');
    const x = l as Record<string, unknown>;
    const codigo = texto(x.codigo, 40);
    if (!codigo || !/^[\w.-]+$/.test(codigo)) throw new EntradaInvalida('Código de fornecedor inválido.');
    if (vistos.has(codigo)) throw new EntradaInvalida(`Código de fornecedor repetido: ${codigo}.`);
    vistos.add(codigo);
    const razaoSocial = texto(x.razaoSocial), nomeFantasia = texto(x.nomeFantasia) ?? razaoSocial;
    if (!nomeFantasia) throw new EntradaInvalida(`Fornecedor ${codigo} sem nome.`);
    // UF fora do padrao nao derruba a lista: o fornecedor fica sem coordenada.
    const ufTexto = texto(x.uf, 10)?.toUpperCase() ?? null, uf = ufTexto && /^[A-Z]{2}$/.test(ufTexto) ? ufTexto : null;
    const cnpj = texto(x.cnpj, 20)?.replace(/\D/g, '') || null;
    const ultimoPedido = texto(x.ultimoPedido, 10);
    if (ultimoPedido !== null && !/^\d{4}-\d{2}-\d{2}$/.test(ultimoPedido)) throw new EntradaInvalida(`Data do último pedido inválida no fornecedor ${codigo}.`);
    if (x.segmentos !== undefined && x.segmentos !== null && !Array.isArray(x.segmentos)) throw new EntradaInvalida(`Segmentos inválidos no fornecedor ${codigo}.`);
    const segmentos = [...new Set(((x.segmentos ?? []) as unknown[]).map(s => texto(s, 100)).filter((s): s is string => Boolean(s)))].slice(0, 30);
    return {
      codigo, nomeFantasia, razaoSocial, cidade: texto(x.cidade, 120), uf, cnpj: cnpj && cnpj.length === 14 ? cnpj : null,
      telefone: texto(x.telefone, 120), email: texto(x.email, 200), ultimoPedido, segmentos,
    };
  });
  return { linhas, aceitarQueda: b.aceitarQueda === true };
}

export const buscaFornecedor = (f: Pick<FornecedorRede, 'nomeFantasia' | 'razaoSocial' | 'cidade' | 'cnpj'>) =>
  chaveTexto([f.nomeFantasia, f.razaoSocial, f.cidade, f.cnpj].filter(Boolean).join(' '));

export type LinhaRede = {
  codigo: string; nome: string; razaoSocial: string | null; cidade: string | null; uf: string | null; ibge: string | null;
  cnpj: string | null; telefone: string | null; email: string | null; ultimoPedido: string | null; busca: string;
  segmentos: string[]; acordos: string[];
};
export type FiltroRede = { centro: Municipio | null; raioKm: number; segmentos: string[]; texto: string; soAcordo: boolean };
export type ResultadoRede = LinhaRede & { distanciaKm: number | null; mesmaCidade: boolean };

const porNome = (a: LinhaRede, b: LinhaRede) => (b.acordos.length ? 1 : 0) - (a.acordos.length ? 1 : 0) || a.nome.localeCompare(b.nome, 'pt-BR');

// Com cidade: primeiro a propria cidade, depois as proximas por distancia.
// Em cada cidade, quem tem acordo vem primeiro.
export function filtrarRede(linhas: readonly LinhaRede[], filtro: FiltroRede): ResultadoRede[] {
  const termos = chaveTexto(filtro.texto).split(' ').filter(Boolean);
  const segmentos = new Set(filtro.segmentos);
  const { porCodigo } = municipios();
  const resultado: ResultadoRede[] = [];
  for (const l of linhas) {
    if (filtro.soAcordo && !l.acordos.length) continue;
    if (segmentos.size && !l.segmentos.some(s => segmentos.has(s))) continue;
    if (termos.length && !termos.every(t => l.busca.includes(t))) continue;
    if (!filtro.centro) { resultado.push({ ...l, distanciaKm: null, mesmaCidade: false }); continue; }
    const local = l.ibge ? porCodigo.get(l.ibge) : undefined;
    if (!local) continue;
    if (local.ibge === filtro.centro.ibge) { resultado.push({ ...l, distanciaKm: 0, mesmaCidade: true }); continue; }
    const km = Math.round(distanciaKm(filtro.centro, local));
    if (km <= filtro.raioKm) resultado.push({ ...l, distanciaKm: km, mesmaCidade: false });
  }
  return resultado.sort((a, b) => {
    if (a.mesmaCidade !== b.mesmaCidade) return a.mesmaCidade ? -1 : 1;
    return (a.distanciaKm ?? 0) - (b.distanciaKm ?? 0) || (a.ibge ?? '').localeCompare(b.ibge ?? '') || porNome(a, b);
  });
}
