'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Download, Info, LoaderCircle } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { Button } from '@/components/ui/button';
import { api, baixarArquivo, errorText } from '@/lib/api';
import { type AnyRow, FalhaDeCarregamento, Loading } from './portal-presentation';

// Painel de resultados. Os números vêm prontos do Alertas (painel.json); a
// tela só apresenta, para que o que se vê seja o mesmo que se baixa.

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mes = (m: string) => { const [a, mm] = m.split('-'); return `${MESES[Number(mm) - 1]}/${a.slice(2)}`; };
const dataBr = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const nada = (v: unknown) => v === null || v === undefined || Number.isNaN(Number(v));
const pct = (v: unknown, casas = 1) => (nada(v) ? '—' : `${(Number(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const sinal = (v: number) => (v > 0 ? '+' : '');
const inteiro = (v: unknown) => (nada(v) ? '—' : Number(v).toLocaleString('pt-BR'));
const moeda = (v: unknown) => (nada(v) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
function moedaCurta(v: unknown) {
  if (nada(v)) return '—';
  const n = Number(v), abs = Math.abs(n);
  if (abs >= 1e6) return `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`;
  if (abs >= 1e3) return `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return moeda(n);
}
const reduzirMovimento = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Número que sobe até o valor ao aparecer (sem animação para quem pediu menos movimento).
function useContagem(alvo: number | null, duracao = 900) {
  const [valor, setValor] = useState(0);
  useEffect(() => {
    if (alvo === null) return;
    const imediato = reduzirMovimento();
    let quadro = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const t = imediato ? 1 : Math.min(1, (agora - inicio) / duracao);
      setValor(alvo * (1 - Math.pow(1 - t, 3)));
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [alvo, duracao]);
  return alvo === null ? null : valor;
}

// Dica do (i) em posição fixa na tela: assim nenhum bloco vizinho a corta.
function Dica({ texto }: { texto?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  if (!texto) return null;
  const abrir = (e: React.SyntheticEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - 328, r.left - 150)) });
  };
  return (
    <button type="button" className="inline-flex shrink-0 items-center self-center" aria-label={texto} onMouseEnter={abrir} onFocus={abrir} onMouseLeave={() => setPos(null)} onBlur={() => setPos(null)}>
      <Info className="size-3.5 text-muted-foreground" />
      {pos && <span role="tooltip" className="pointer-events-none fixed z-50 w-80 rounded border bg-card p-2.5 text-left text-[13px] font-normal leading-snug text-foreground shadow-lg" style={pos}>{texto}</span>}
    </button>
  );
}

function Indicador({ rotulo, valor, formatar, detalhe, dica, serie, atraso = 0 }: {
  rotulo: string; valor: number | null; formatar: (v: number) => string; detalhe?: ReactNode; dica?: string; serie?: number[]; atraso?: number;
}) {
  const animado = useContagem(valor);
  return (
    <div className="painel-surgir min-w-0 rounded border bg-card p-3" style={{ animationDelay: `${atraso}ms` }}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">{rotulo}<Dica texto={dica} /></div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{animado === null ? '—' : formatar(animado)}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="min-h-4 text-[12.5px] text-muted-foreground">{detalhe}</div>
        {serie && serie.length > 1 && <Faisca valores={serie} />}
      </div>
    </div>
  );
}

function Faisca({ valores }: { valores: number[] }) {
  const min = Math.min(...valores), max = Math.max(...valores), faixa = max - min || 1;
  const pontos = valores.map((v, i) => `${(i / (valores.length - 1)) * 80},${22 - ((v - min) / faixa) * 20}`).join(' ');
  return <svg viewBox="0 0 80 24" className="h-6 w-20 shrink-0" aria-hidden><polyline points={pontos} fill="none" stroke="var(--marinho)" strokeWidth="1.5" pathLength={1} className="painel-traco" /></svg>;
}

type Serie = { nome: string; cor: string; valores: (number | null)[] };
// Gráfico de linhas em SVG puro: eixo Y com 3 marcas, rótulos de mês
// espaçados, linha de referência opcional e dica no ponto mais próximo.
function GraficoLinha({ meses, series, formatar, referencia, parcial, altura = 220, rotulosFinais = false, largura = 640 }: {
  meses: string[]; series: Serie[]; formatar: (v: number) => string; referencia?: { valor: number; rotulo: string }; parcial?: string | null; altura?: number; rotulosFinais?: boolean; largura?: number;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  const caixa = useRef<SVGSVGElement>(null);
  const moldura = useRef<HTMLDivElement>(null);
  // O desenho acompanha a largura real do bloco: assim o texto dos eixos fica
  // no tamanho escrito, sem crescer junto com o gráfico na tela grande.
  const [larg, setLarg] = useState(largura);
  useEffect(() => {
    const el = moldura.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(([e]) => setLarg(Math.max(320, Math.round(e.contentRect.width))));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const L = larg, A = altura, m = { e: 56, d: rotulosFinais ? 150 : 12, t: 12, b: 26 };
  const todos = series.flatMap(s => s.valores).filter((v): v is number => v !== null);
  if (referencia) todos.push(referencia.valor);
  if (!meses.length || !todos.length) return <p className="py-10 text-center text-sm text-muted-foreground">Sem dados no período.</p>;
  let min = Math.min(...todos), max = Math.max(...todos);
  const folga = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1;
  min -= folga; max += folga;
  const x = (i: number) => m.e + (meses.length === 1 ? (L - m.e - m.d) / 2 : (i / (meses.length - 1)) * (L - m.e - m.d));
  const y = (v: number) => m.t + (1 - (v - min) / (max - min)) * (A - m.t - m.b);
  const marcas = [min + folga, (min + max) / 2, max - folga];
  const passo = Math.max(1, Math.ceil(meses.length / 8));
  const mover = (evento: React.MouseEvent<SVGSVGElement>) => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((evento.clientX - r.left) / r.width) * L;
    let melhor = 0;
    meses.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(melhor) - px)) melhor = i; });
    setFoco(melhor);
  };
  return (
    <div ref={moldura} className="relative">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- passar o mouse só mostra a dica; os valores também estão nas tabelas e no arquivo da base */}
      <svg ref={caixa} viewBox={`0 0 ${L} ${A}`} className="w-full" aria-hidden onMouseMove={mover} onMouseLeave={() => setFoco(null)}>
        {marcas.map(v => (
          <g key={v}>
            <line x1={m.e} x2={L - m.d} y1={y(v)} y2={y(v)} stroke="var(--divisoria)" />
            <text x={m.e - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[11px]">{formatar(v)}</text>
          </g>
        ))}
        {referencia && (
          <g>
            <line x1={m.e} x2={L - m.d} y1={y(referencia.valor)} y2={y(referencia.valor)} stroke="var(--ambar)" strokeDasharray="4 4" />
          </g>
        )}
        {meses.map((mm, i) => (i % passo === 0 || (i === meses.length - 1 && i % passo >= passo / 2)) && (
          <text key={mm} x={x(i)} y={A - 8} textAnchor={meses.length > 1 && i === meses.length - 1 ? 'end' : meses.length > 1 && i === 0 ? 'start' : 'middle'} className="fill-muted-foreground text-[11px]">{mes(mm)}</text>
        ))}
        {series.map(s => {
          const trechos: string[] = [];
          let atual = '';
          // Mês ainda em andamento: o último trecho sai tracejado.
          const ultimo = meses.length - 1;
          const tracejar = !!parcial && meses[ultimo] === parcial && ultimo > 0 && s.valores[ultimo] !== null && s.valores[ultimo - 1] !== null;
          const valores = tracejar ? s.valores.slice(0, ultimo) : s.valores;
          valores.forEach((v, i) => {
            if (v === null) { if (atual) trechos.push(atual); atual = ''; return; }
            atual += `${atual ? 'L' : 'M'}${x(i)},${y(v)}`;
          });
          if (atual) trechos.push(atual);
          return [...trechos.map(d => <path key={s.nome + d} d={d} fill="none" stroke={s.cor} strokeWidth="2.25" strokeLinejoin="round" pathLength={1} className="painel-traco" />),
            tracejar && <line key={`${s.nome}-parcial`} x1={x(ultimo - 1)} y1={y(s.valores[ultimo - 1] as number)} x2={x(ultimo)} y2={y(s.valores[ultimo] as number)} stroke={s.cor} strokeWidth="2" strokeDasharray="4 3" />];
        })}
        {rotulosFinais && series.map(s => {
          const i = s.valores.findLastIndex(v => v !== null);
          if (i < 0) return null;
          const yy = y(s.valores[i] as number);
          return (
            <text key={`${s.nome}-fim`} x={x(i) + 8} y={yy + 4} className="text-[13px] font-semibold" fill={s.cor}>
              {s.nome} {formatar(s.valores[i] as number)}
              {meses[i] === parcial && <tspan x={x(i) + 8} dy="15" className="text-[11px] font-normal">{mes(parcial)} parcial</tspan>}
            </text>
          );
        })}
        {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={m.t} y2={A - m.b} stroke="var(--borda)" />}
        {foco !== null && series.map(s => s.valores[foco] !== null && <circle key={s.nome} cx={x(foco)} cy={y(s.valores[foco] as number)} r="3.5" fill={s.cor} />)}
      </svg>
      {foco !== null && (
        <div className="pointer-events-none absolute top-1 rounded border bg-card px-2 py-1 text-xs shadow-sm" style={{ left: `${Math.min(80, (x(foco) / L) * 100)}%` }}>
          <div className="font-medium">{mes(meses[foco])}{meses[foco] === parcial ? ' (parcial)' : ''}</div>
          {series.map(s => <div key={s.nome} className="flex items-center gap-1.5 tabular-nums"><span className="size-2 rounded-full" style={{ background: s.cor }} />{s.nome}: {s.valores[foco] === null ? '—' : formatar(s.valores[foco] as number)}</div>)}
        </div>
      )}
      {((series.length > 1 && !rotulosFinais) || referencia || (parcial && meses.at(-1) === parcial && !rotulosFinais)) && (
        <div className="mt-1 flex flex-wrap gap-4 text-[13px] text-muted-foreground">
          {series.length > 1 && !rotulosFinais && series.map(s => <span key={s.nome} className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: s.cor }} />{s.nome}</span>)}
          {referencia && <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[var(--ambar)]" />{referencia.rotulo}</span>}
          {parcial && meses.at(-1) === parcial && !rotulosFinais && <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[var(--aco)]" />{mes(parcial)} parcial</span>}
        </div>
      )}
    </div>
  );
}

function Barras({ itens, formatar, rotulo = '12rem', embacar = false, barraMax }: {
  itens: { nome: string; valor: number }[]; formatar: (v: number) => string; rotulo?: string; embacar?: boolean; barraMax?: string;
}) {
  const [pronto, setPronto] = useState(reduzirMovimento());
  const [todos, setTodos] = useState(false);
  useEffect(() => { const t = setTimeout(() => setPronto(true), 60); return () => clearTimeout(t); }, []);
  const max = Math.max(...itens.map(i => i.valor), 1);
  if (!itens.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nada a mostrar no período.</p>;
  const visiveis = todos ? itens : itens.slice(0, 5);
  return (
    <div>
      <ul className="space-y-2.5">
        {visiveis.map((i, n) => (
          <li key={i.nome} className="grid items-center gap-3 text-[13px]" style={{ gridTemplateColumns: `minmax(0,${rotulo}) minmax(0,${barraMax ?? '1fr'}) auto` }}>
            <span className={`truncate ${embacar ? 'text-muted-foreground' : ''}`} title={embacar ? undefined : i.nome}>{embacar ? `${n + 1}º lugar` : i.nome}</span>
            <span className="h-2.5 rounded-sm bg-muted"><span className="block h-2.5 rounded-sm bg-primary transition-[width] duration-700 ease-out" style={{ width: pronto ? `${Math.max(2, (i.valor / max) * 100)}%` : '0%' }} /></span>
            <span className="tabular-nums text-muted-foreground">{formatar(i.valor)}</span>
          </li>
        ))}
      </ul>
      {itens.length > 5 && (
        <button type="button" className="mt-3 text-xs font-medium text-[var(--link)] hover:underline" onClick={() => setTodos(t => !t)}>
          {todos ? 'Ver só os 5 primeiros' : `Ver todos (${itens.length})`}
        </button>
      )}
    </div>
  );
}

function Secao({ titulo, dica, children, acoes, className = '' }: { titulo: string; dica?: string; children: ReactNode; acoes?: ReactNode; className?: string }) {
  return (
    <section className={`painel-surgir min-w-0 rounded border bg-card p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">{titulo}<Dica texto={dica} /></h2>
        {acoes}
      </div>
      {children}
    </section>
  );
}

function Variacao({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
  if (Math.abs(v) < 0.0005) return <span className="inline-flex w-[4.75rem] justify-end rounded px-1.5 py-0.5 tabular-nums text-muted-foreground">0,0%</span>;
  const caiu = v < 0;
  const Icone = caiu ? ArrowDownRight : ArrowUpRight;
  return <span className={`inline-flex w-[4.75rem] items-center justify-end gap-0.5 rounded px-1.5 py-0.5 tabular-nums ${caiu ? 'bg-[var(--status-done-bg)] text-[var(--concluido)]' : 'bg-[var(--status-cancelled-bg)] text-[var(--cancelado)]'}`}><Icone className="size-3" />{sinal(v)}{pct(v)}</span>;
}

// Faixa do topo: período, data de geração e o botão da base. Onda chapada
// (sem degradê), na cor do fundo da página.
function Faixa({ d, baixando, baixar }: { d: AnyRow; baixando: boolean; baixar: () => void }) {
  return (
    <div className="relative overflow-hidden rounded bg-[var(--marinho)] px-5 pb-9 pt-4 text-[var(--branco)]">
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--sidebar-muted)]">Período analisado</p>
          <p className="text-lg font-semibold">{dataBr(d.periodo?.inicio)} a {dataBr(d.periodo?.fim)}</p>
          <p className="text-[13px] text-[var(--branco)]/85">Gerado em {dataBr(d.geradoEm?.slice(0, 10))} às {d.geradoEm?.slice(11, 16)} · controle de vigência desde {dataBr(d.controleDesde)}</p>
        </div>
        <Button onClick={baixar} disabled={baixando} variant="outline" className="border-[var(--branco)]/60 bg-transparent text-[var(--branco)] hover:bg-[var(--branco)]/10 hover:text-[var(--branco)]">
          {baixando ? <LoaderCircle className="animate-spin" /> : <Download />} Baixar base
        </Button>
      </div>
      <svg viewBox="0 0 1440 120" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-8 w-full" aria-hidden>
        <path d="M0,64 C240,112 480,112 720,72 C960,32 1200,32 1440,72 L1440,120 L0,120 Z" fill="var(--chao)" />
      </svg>
    </div>
  );
}

export function Painel() {
  const [d, setD] = useState<AnyRow | null>(null);
  const [erro, setErro] = useState('');
  const [baixando, setBaixando] = useState(false);
  const [itemSel, setItemSel] = useState(0);
  const [nomesVisiveis, setNomesVisiveis] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => { api('/api/painel').then(setD).catch(e => setErro(errorText(e))); }, [tentativa]);
  const carregar = () => { setErro(''); setD(null); setTentativa(t => t + 1); };
  const metodo = useMemo(() => Object.fromEntries((d?.metodo ?? []).map((m: AnyRow) => [m.indicador, m.texto])), [d]);
  const baixar = async () => {
    setBaixando(true);
    try { await baixarArquivo('/api/painel/base'); } catch (e) { setErro(errorText(e)); } finally { setBaixando(false); }
  };

  if (erro && !d) return <><LinhaDeAba /><FalhaDeCarregamento erro={erro} tentar={carregar} /></>;
  if (!d) return <><LinhaDeAba /><Loading label="Carregando painel" compact /></>;
  if (!d.disponivel) return (
    <><LinhaDeAba />
      <div className="rounded border bg-card p-6 text-sm text-muted-foreground">O painel aparece depois do primeiro recorte que comece em 01/01/2025 ou antes (Administração › Relatórios).</div>
    </>
  );

  const r = d.resumo ?? {};
  // Cartão do índice mostra o último mês fechado; o mês em andamento fica só no gráfico.
  const fechados = (d.indice ?? []).filter((i: AnyRow) => i.mes !== d.mesParcial);
  const indiceFechado = fechados.at(-1);
  const indice: AnyRow[] = d.indice ?? [];
  const acordos: AnyRow[] = d.acordos ?? [];
  const itens: AnyRow[] = d.itens ?? [];
  const item = itens[Math.min(itemSel, Math.max(0, itens.length - 1))];
  const reaj = d.reajuste;
  const qual = d.qualidade ?? {};
  const universo = qual.universo;
  const funil = [
    universo && { rotulo: 'Linhas baixadas do Locavia', valor: universo.linhasCruas },
    universo && { rotulo: 'Dentro do escopo de Suprimentos', valor: universo.entraram },
    { rotulo: 'Usadas nos indicadores', valor: r.linhas - r.descartadas },
  ].filter(Boolean) as { rotulo: string; valor: number }[];
  const topo = funil[0]?.valor || 1;

  return (
    <>
      <LinhaDeAba />
      <div className="space-y-3">
        {erro && <p className="rounded border border-[var(--cancelado)] bg-[var(--status-cancelled-bg)] px-3 py-2 text-xs text-[var(--cancelado)]">{erro}</p>}
        <Faixa d={d} baixando={baixando} baixar={baixar} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Indicador rotulo={indiceFechado ? `Índice de preço · ${mes(indiceFechado.mes)}` : 'Índice de preço'} valor={indiceFechado?.valor ?? r.indice ?? null} formatar={v => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            detalhe={(() => { const v = indiceFechado?.valor ?? r.indice; return v === null || v === undefined ? null : v < 100 ? `${pct(1 - v / 100)} abaixo de ${d.anoBase ?? 2025}` : `${pct(v / 100 - 1)} acima de ${d.anoBase ?? 2025}`; })()}
            dica={metodo['Índice de preço']} serie={indice.map(i => i.valor)} />
          <Indicador rotulo="Custo evitado (reajuste)" valor={reaj?.custoEvitado ?? null} formatar={moedaCurta} atraso={60}
            detalhe={reaj ? `oficinas com acordo ${sinal(reaj.comAcordo)}${pct(reaj.comAcordo)} · sem ${sinal(reaj.semAcordo)}${pct(reaj.semAcordo)}` : 'precisa de dois anos'} dica={metodo['Reajuste contido']} />
          <Indicador rotulo="Gasto com acordo" valor={r.pctAcordo ?? null} formatar={v => pct(v)} atraso={120}
            detalhe="desde o controle" dica={metodo['Acordos']} serie={acordos.map(a => a.pctAcordo)} />
          <Indicador rotulo="Conformidade" valor={r.conformidade ?? null} formatar={v => pct(v)} atraso={180}
            detalhe="no preço ou abaixo" dica={metodo['Acordos']} serie={acordos.map(a => a.conformidade)} />
          <Indicador rotulo="Pago acima do acordo" valor={r.pagoAcima ?? null} formatar={moedaCurta} atraso={240}
            detalhe="desde o controle" dica={metodo['Acordos']} serie={acordos.map(a => a.pagoAcima)} />
          <Indicador rotulo="Perda de direcionamento" valor={r.perdaDirecionamento ?? null} formatar={moedaCurta} atraso={300}
            detalhe="oficina sem acordo onde havia" dica={metodo['Direcionamento cidade']} />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Secao titulo="Índice de preço" dica={metodo['Índice de preço']}>
            <GraficoLinha meses={indice.map(i => i.mes)} series={[{ nome: 'Índice', cor: 'var(--marinho)', valores: indice.map(i => i.valor) }]}
              formatar={v => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} referencia={{ valor: 100, rotulo: `100 = ${d.anoBase ?? 2025}` }} parcial={d.mesParcial} altura={300} />
          </Secao>
          <Secao titulo="Acordos" dica={metodo['Acordos']}>
            <GraficoLinha meses={acordos.map(a => a.mes)} formatar={v => pct(v, 0)} parcial={d.mesParcial} rotulosFinais altura={300} largura={460}
              series={[{ nome: 'Conformidade', cor: 'var(--marinho)', valores: acordos.map(a => a.conformidade) },
                { nome: 'Gasto com acordo', cor: 'var(--link)', valores: acordos.map(a => a.pctAcordo) }]} />
          </Secao>
        </div>

        <Secao titulo="Preço por item" dica={metodo['Medianas top 20']}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="max-h-[22rem] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card text-muted-foreground">
                  <tr><th className="py-1 text-left font-medium">Item</th><th className="text-left font-medium">Modelo</th><th className="text-right font-medium">Gasto</th>
                    <th className="text-right font-medium">Início</th><th className="text-right font-medium">Fim</th><th className="pr-1 text-right font-medium">Variação</th></tr>
                </thead>
                <tbody>
                  {itens.map((it, i) => (
                    <tr key={`${it.item}|${it.modelo}`} onClick={() => setItemSel(i)} aria-selected={i === itemSel}
                      className={`cursor-pointer border-t ${i === itemSel ? 'bg-[var(--status-open-bg)] shadow-[inset_3px_0_0_var(--link)]' : 'hover:bg-muted'}`}>
                      <td className="py-1 pl-2 pr-2">{it.item}</td><td className="pr-2 text-muted-foreground">{it.modelo}</td>
                      <td className="text-right tabular-nums">{moedaCurta(it.gasto)}</td><td className="text-right tabular-nums">{moeda(it.inicio)}</td>
                      <td className="text-right tabular-nums">{moeda(it.fim)}</td><td className="pr-1 text-right"><Variacao v={it.variacao} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              {item && <p className="mb-2 text-[13px] text-muted-foreground"><span className="text-[15px] font-semibold text-foreground">{item.item}</span> · {item.modelo} · mediana por mês</p>}
              {item && <GraficoLinha key={`${item.item}|${item.modelo}`} meses={item.serie.map((s: AnyRow) => s.mes)} formatar={v => moeda(v)} altura={200}
                parcial={d.mesParcial} series={[{ nome: 'Mediana', cor: 'var(--marinho)', valores: item.serie.map((s: AnyRow) => s.valor) }]} />}
            </div>
          </div>
        </Secao>

        <div className="grid gap-3 xl:grid-cols-3">
          <Secao titulo="Direcionamento por cidade" dica={metodo['Direcionamento cidade']}>
            <Barras itens={d.direcionamento?.cidades ?? []} formatar={moedaCurta} />
          </Secao>
          <Secao titulo="Direcionamento por agendador" dica={metodo['Direcionamento agendador']}
            acoes={<button type="button" className="text-xs font-medium text-[var(--link)] hover:underline" onClick={() => setNomesVisiveis(v => !v)}>{nomesVisiveis ? 'Ocultar nomes' : 'Mostrar nomes'}</button>}>
            <Barras itens={d.direcionamento?.agendadores ?? []} formatar={moedaCurta} embacar={!nomesVisiveis} />
          </Secao>
          <Secao titulo="Cobrado acima do acordo" dica={metodo['Acordos']}>
            <Barras itens={(d.fornecedoresAcima ?? []).map((f: AnyRow) => ({ nome: `${f.fornecedor} · ${f.cidade}`, valor: f.valor }))} formatar={moedaCurta} />
          </Secao>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Secao titulo="Confiabilidade dos dados" dica={metodo['Qualidade dos dados']}>
            <div className="space-y-2">
              {funil.map(f => (
                <div key={f.rotulo} className="text-[13px]">
                  <div className="mb-0.5 flex justify-between"><span>{f.rotulo}</span><span className="tabular-nums text-muted-foreground">{inteiro(f.valor)}</span></div>
                  <div className="h-3 rounded-sm bg-muted"><div className="h-3 rounded-sm bg-primary" style={{ width: `${Math.max(1, (f.valor / topo) * 100)}%` }} /></div>
                </div>
              ))}
              <p className="pt-1 text-[13px] text-muted-foreground">{pct(r.pctMantidas)} das linhas do escopo entraram nas contas; {inteiro(r.descartadas)} saíram como erro de lançamento.</p>
              <ul className="space-y-0.5 border-t pt-2 text-[13px]">
                {(universo?.filtros ?? []).map((f: AnyRow) => <li key={f.motivo} className="flex justify-between"><span>Fora do escopo: {f.motivo}</span><span className="tabular-nums text-muted-foreground">{inteiro(f.linhas)}</span></li>)}
                {(qual.motivos ?? []).map((f: AnyRow) => <li key={f.motivo} className="flex justify-between"><span>Limpeza: {f.motivo}</span><span className="tabular-nums text-muted-foreground">{inteiro(f.linhas)}</span></li>)}
                {(qual.quarentena ?? []).map((f: AnyRow) => <li key={f.motivo} className="flex justify-between"><span>Sem comparação: {f.motivo}</span><span className="tabular-nums text-muted-foreground">{inteiro(f.linhas)}</span></li>)}
              </ul>
            </div>
          </Secao>
          {d.abaixo && (
            <Secao titulo="Abaixo do acordo" dica={metodo['Abaixo do acordo']}>
              <div className="space-y-4">
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                  <dt className="text-muted-foreground">Compras abaixo</dt><dd className="text-right tabular-nums">{inteiro(d.abaixo.linhas)} ({pct(d.abaixo.pctComAcordo)} das com acordo)</dd>
                  <dt className="text-muted-foreground">Abaixo do acordo</dt><dd className="text-right tabular-nums">{moedaCurta(d.abaixo.valor)}</dd>
                  <dt className="text-muted-foreground">Prováveis pares lançados como unidade</dt><dd className="text-right tabular-nums">{inteiro(d.abaixo.suspeitaUnidade)} · {moedaCurta(d.abaixo.valorSuspeitaUnidade)}</dd>
                  <dd className="col-span-2 pt-1 text-muted-foreground">Contam como conformes e não entram como economia.</dd>
                </dl>
                <Barras itens={d.abaixo.itens ?? []} formatar={moedaCurta} rotulo="18rem" />
              </div>
            </Secao>
          )}
        </div>
          <details className="painel-surgir rounded border bg-card p-4">
          <summary className="cursor-pointer text-[15px] font-semibold">Como cada número é calculado</summary>
          <div className="mt-3 grid gap-1 text-[13px] lg:grid-cols-2">
            {(d.metodo ?? []).map((m: AnyRow) => (
              <details key={m.indicador} className="rounded border px-2 py-1">
                <summary className="cursor-pointer font-medium">{m.indicador}</summary>
                <p className="pt-1 leading-snug text-muted-foreground">{m.texto}</p>
              </details>
            ))}
            {(d.saude ?? []).length > 0 && (
              <div className="rounded border px-2 py-1">
                <p className="font-medium">Carteira de acordos</p>
                {(d.saude as AnyRow[]).map(s => <p key={s.indicador} className="flex justify-between text-muted-foreground"><span>{s.indicador}</span><span className="tabular-nums">{String(s.indicador).startsWith('%') ? pct(s.valor) : inteiro(s.valor)}</span></p>)}
              </div>
            )}
          </div>
        </details>
      </div>
    </>
  );
}
