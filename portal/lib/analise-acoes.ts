import { subtrairDias } from './analise.ts';

// Proximas acoes de Suprimentos, geradas por regras simples sobre as compras
// comparadas dos ultimos 90 dias. Cada sugestao tem uma chave estavel (tipo +
// alvo); o historico de cada uma sobrevive aos reprocessamentos.
export const TIPOS_ACAO = {
  fechar_acordo: 'Fechar acordo',
  direcionar: 'Direcionar compras',
  cobrar: 'Cobrar e renegociar',
  ampliar_item: 'Incluir item no acordo',
  ampliar_modelo: 'Incluir modelo no acordo',
  ampliar_cidade: 'Estender acordo para a cidade',
  acordo_amplo: 'Negociar acordo do item',
  sinonimo: 'Atualizar De/Para',
} as const;
export type TipoAcao = keyof typeof TIPOS_ACAO;
export const STATUS_ACAO = ['pendente', 'feita', 'pulada', 'rejeitada', 'encerrada'] as const;
export type StatusAcao = (typeof STATUS_ACAO)[number];
export const JANELA_ACOES_DIAS = 90;
// "Feito" que continua aparecendo nos dados volta para a fila depois disso.
export const DIAS_REABRIR_FEITA = 60;
export const DIAS_ADIAMENTO = [7, 30, 90] as const;

export type Candidata = { chave: string; tipo: TipoAcao; titulo: string; detalhe: string; impacto: number; filtro: Record<string, string> };

type Num = number | null | undefined;
const brl = (v: Num) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const int = (v: Num) => Number(v ?? 0).toLocaleString('pt-BR');
const compras = (n: Num) => `${int(n)} ${Number(n) === 1 ? 'compra' : 'compras'}`;
const ondeCidades = (cidades: Num, cidade: string | null) => Number(cidades) > 1 ? `em ${int(cidades)} cidades` : cidade ? `em ${cidade}` : '';

export type Consultar = <T>(sql: string, values?: unknown[]) => Promise<T[]>;

export function janelaAcoes(ultimoDia: string) {
  return { de: subtrairDias(ultimoDia, JANELA_ACOES_DIAS - 1), ate: ultimoDia };
}

// Limiar de relevancia proporcional ao gasto da janela (0,1%, minimo R$ 1.000):
// modelo, item ou cidade com gasto pequeno nao justificam negociar acordo.
export const limiarRelevancia = (gastoJanela: number) => Math.max(1000, gastoJanela * 0.001);

export async function candidatas(all: Consultar, ultimoDia: string): Promise<Candidata[]> {
  const { de, ate } = janelaAcoes(ultimoDia);
  const J = "c.data BETWEEN ? AND ? AND c.status IN ('CONFORME','ACIMA DO ACORDO','ABAIXO DO ACORDO','SEM ACORDO')";
  const p = [de, ate];
  const [total] = await all<{ gasto: Num }>(`SELECT SUM(c.total_os) gasto FROM compras_comparadas c WHERE ${J}`, p);
  const limiar = limiarRelevancia(Number(total?.gasto ?? 0));
  const SEM = `${J} AND c.status='SEM ACORDO'`;
  const lista: Candidata[] = [];

  type G = { fornecedor: string; n: number; gasto: number; cidades: number; cidade: string | null };
  for (const r of await all<G>(`SELECT c.fornecedor, COUNT(*) n, SUM(c.total_os) gasto, COUNT(DISTINCT c.cidade) cidades, MIN(c.cidade) cidade
    FROM compras_comparadas c WHERE ${SEM} AND c.motivo='Fornecedor' AND c.tinha_acordo=0 AND c.fornecedor IS NOT NULL
    GROUP BY c.fornecedor HAVING SUM(c.total_os)>=?`, [...p, limiar])) {
    lista.push({ chave: `fechar_acordo|${r.fornecedor}`, tipo: 'fechar_acordo', titulo: `Fechar acordo com ${r.fornecedor}`,
      detalhe: `${brl(r.gasto)} em ${compras(r.n)} sem acordo nos últimos ${JANELA_ACOES_DIAS} dias ${ondeCidades(r.cidades, r.cidade)}.`.replace(' .', '.'),
      impacto: r.gasto, filtro: { fornecedor: r.fornecedor } });
  }

  type D = { cidade: string; fornecedor: string; n: number; gasto: number; economia: number; fornecedorAcordo: string | null };
  for (const r of await all<D>(`SELECT c.cidade, c.fornecedor, COUNT(*) n, SUM(c.total_os) gasto,
      SUM(CASE WHEN c.dif_menor>0 THEN c.dif_menor ELSE 0 END) economia,
      (SELECT x.fornecedor_acordo FROM compras_comparadas x WHERE x.cidade=c.cidade AND x.fornecedor=c.fornecedor AND x.tinha_acordo=1
        AND x.status='SEM ACORDO' AND x.data BETWEEN ? AND ? AND x.fornecedor_acordo IS NOT NULL
        GROUP BY x.fornecedor_acordo ORDER BY COUNT(*) DESC, x.fornecedor_acordo LIMIT 1) fornecedorAcordo
    FROM compras_comparadas c WHERE ${SEM} AND c.tinha_acordo=1 AND c.cidade IS NOT NULL AND c.fornecedor IS NOT NULL
    GROUP BY c.cidade, c.fornecedor HAVING SUM(c.total_os)>=?`, [de, ate, ...p, limiar])) {
    const destino = r.fornecedorAcordo ? ` para ${r.fornecedorAcordo}` : ' para o fornecedor com acordo';
    lista.push({ chave: `direcionar|${r.cidade}|${r.fornecedor}`, tipo: 'direcionar', titulo: `Direcionar compras de ${r.cidade}${destino}`,
      detalhe: `${compras(r.n)} em ${r.fornecedor} (${brl(r.gasto)}) tinham acordo com outro fornecedor. Economia estimada: ${brl(r.economia)}.`,
      impacto: r.gasto, filtro: { fornecedor: r.fornecedor, cidade: r.cidade } });
  }

  type C = { fornecedor: string; n: number; gasto: number; acima: number };
  for (const r of await all<C>(`SELECT c.fornecedor, COUNT(*) n, SUM(c.total_os) gasto, SUM(c.dif_total) acima
    FROM compras_comparadas c WHERE ${J} AND c.status='ACIMA DO ACORDO' AND c.fornecedor IS NOT NULL
    GROUP BY c.fornecedor HAVING SUM(c.dif_total)>=?`, [...p, Math.max(300, limiar * 0.2)])) {
    lista.push({ chave: `cobrar|${r.fornecedor}`, tipo: 'cobrar', titulo: `Cobrar e renegociar com ${r.fornecedor}`,
      detalhe: `${brl(r.acima)} pagos acima do acordo em ${compras(r.n)} nos últimos ${JANELA_ACOES_DIAS} dias.`,
      impacto: r.gasto, filtro: { fornecedor: r.fornecedor } });
  }

  // Cobertura do acordo: item, modelo ou cidade fora do acordo que o
  // fornecedor ja tem. So entra o que tem gasto relevante.
  const cobertura = [
    { tipo: 'ampliar_item', motivo: 'Item', campo: 'item', titulo: (f: string, v: string) => `Incluir ${v} no acordo com ${f}` },
    { tipo: 'ampliar_modelo', motivo: 'Modelo', campo: 'modelo', titulo: (f: string, v: string) => `Incluir o modelo ${v} no acordo com ${f}` },
    { tipo: 'ampliar_cidade', motivo: 'Cidade', campo: 'cidade', titulo: (f: string, v: string) => `Estender o acordo com ${f} para ${v}` },
  ] as const;
  for (const regra of cobertura) {
    for (const r of await all<{ fornecedor: string; valor: string; n: number; gasto: number }>(`SELECT c.fornecedor, c.${regra.campo} valor,
      COUNT(*) n, SUM(c.total_os) gasto FROM compras_comparadas c WHERE ${SEM} AND c.motivo=? AND c.fornecedor IS NOT NULL AND c.${regra.campo} IS NOT NULL
      GROUP BY c.fornecedor, c.${regra.campo} HAVING SUM(c.total_os)>=?`, [...p, regra.motivo, limiar])) {
      lista.push({ chave: `${regra.tipo}|${r.fornecedor}|${r.valor}`, tipo: regra.tipo, titulo: regra.titulo(r.fornecedor, r.valor),
        detalhe: `O fornecedor já tem acordo, mas ${brl(r.gasto)} em ${compras(r.n)} ficaram de fora nos últimos ${JANELA_ACOES_DIAS} dias.`,
        impacto: r.gasto, filtro: { fornecedor: r.fornecedor } });
    }
  }

  // Item sem acordo espalhado por muitas cidades: a sugestao aponta o fornecedor
  // que mais vendeu o item sem acordo, para a negociacao ter um alvo concreto.
  const jaSugerido = new Set(lista.map(c => c.chave));
  type A = { item: string; gasto: number; cidades: number; fornecedor: string | null; gastoFornecedor: number | null; cidadesFornecedor: number | null; cidadeFornecedor: string | null };
  for (const r of await all<A>(`WITH sem AS (SELECT c.item, c.fornecedor, c.cidade, c.total_os FROM compras_comparadas c WHERE ${SEM} AND c.item IS NOT NULL),
    itens AS (SELECT item, SUM(total_os) gasto, COUNT(DISTINCT cidade) cidades FROM sem GROUP BY item
      HAVING COUNT(DISTINCT cidade)>=10 AND SUM(total_os)>=?),
    porFornecedor AS (SELECT item, fornecedor, SUM(total_os) gasto, COUNT(DISTINCT cidade) cidades, MIN(cidade) cidade,
      ROW_NUMBER() OVER (PARTITION BY item ORDER BY SUM(total_os) DESC, fornecedor) ordem
      FROM sem WHERE fornecedor IS NOT NULL AND item IN (SELECT item FROM itens) GROUP BY item, fornecedor)
    SELECT i.item, i.gasto, i.cidades, f.fornecedor, f.gasto gastoFornecedor, f.cidades cidadesFornecedor, f.cidade cidadeFornecedor
    FROM itens i LEFT JOIN porFornecedor f ON f.item=i.item AND f.ordem=1`, [...p, limiar * 5])) {
    if (!r.fornecedor || Number(r.gastoFornecedor) < limiar) continue;
    if (jaSugerido.has(`ampliar_item|${r.fornecedor}|${r.item}`)) continue;
    lista.push({ chave: `acordo_amplo|${r.item}|${r.fornecedor}`, tipo: 'acordo_amplo', titulo: `Negociar acordo de ${r.item} com ${r.fornecedor}`,
      detalhe: `${r.fornecedor} vendeu ${brl(r.gastoFornecedor)} sem acordo ${ondeCidades(r.cidadesFornecedor, r.cidadeFornecedor)} nos últimos ${JANELA_ACOES_DIAS} dias, de ${brl(r.gasto)} do item sem acordo em ${int(r.cidades)} cidades.`.replace('  ', ' '),
      impacto: Number(r.gastoFornecedor), filtro: { fornecedor: r.fornecedor } });
  }

  // Sinonimo faltando: o termo da compra nao casa com nenhum acordo. Ou o
  // De/Para precisa do termo, ou o termo deve sair dos filtros.
  for (const r of await all<{ item: string; n: number; gasto: number }>(`SELECT c.item, COUNT(*) n, SUM(c.total_os) gasto
    FROM compras_comparadas c WHERE ${SEM} AND c.motivo='Sinonimo' AND c.item IS NOT NULL
    GROUP BY c.item HAVING SUM(c.total_os)>=?`, [...p, limiar * 0.5])) {
    lista.push({ chave: `sinonimo|${r.item}`, tipo: 'sinonimo', titulo: `Atualizar o De/Para ou excluir dos filtros: ${r.item}`,
      detalhe: `${brl(r.gasto)} em ${compras(r.n)} não foram comparados porque o termo não casa com nenhum acordo.`,
      impacto: r.gasto, filtro: {} });
  }
  return lista;
}

export type AcaoAtual = { id: string; chave: string; status: StatusAcao; adiada_ate: string | null; resolvida_em: string | null };
export type Plano = {
  inserir: Candidata[];
  atualizar: { id: string; c: Candidata; para?: StatusAcao; motivo?: string }[];
  encerrar: AcaoAtual[];
};

// Concilia as sugestoes da rodada com o que ja existe. Rejeitada nunca volta;
// pulada volta no fim do adiamento; feita volta se a condicao persistir;
// pendente que sumiu dos dados e encerrada pelo sistema.
export function conciliar(atuais: readonly AcaoAtual[], novas: readonly Candidata[], hoje: string): Plano {
  const porChave = new Map(atuais.map(a => [a.chave, a]));
  const vistas = new Set<string>();
  const plano: Plano = { inserir: [], atualizar: [], encerrar: [] };
  for (const c of novas) {
    vistas.add(c.chave);
    const a = porChave.get(c.chave);
    if (!a) { plano.inserir.push(c); continue; }
    if (a.status === 'pulada' && a.adiada_ate && a.adiada_ate <= hoje) plano.atualizar.push({ id: a.id, c, para: 'pendente', motivo: 'Fim do adiamento.' });
    else if (a.status === 'encerrada') plano.atualizar.push({ id: a.id, c, para: 'pendente', motivo: 'A condição voltou a aparecer nos dados.' });
    else if (a.status === 'feita' && a.resolvida_em && subtrairDias(hoje, DIAS_REABRIR_FEITA) >= a.resolvida_em.slice(0, 10)) {
      plano.atualizar.push({ id: a.id, c, para: 'pendente', motivo: `A condição continua nos dados ${DIAS_REABRIR_FEITA} dias depois de marcada como feita.` });
    } else plano.atualizar.push({ id: a.id, c });
  }
  for (const a of atuais) if (!vistas.has(a.chave) && (a.status === 'pendente' || a.status === 'pulada')) plano.encerrar.push(a);
  return plano;
}
