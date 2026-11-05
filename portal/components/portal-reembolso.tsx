'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Pencil, Plus, Printer, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { TabelaPadrao } from './tela-padrao';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { dataHoraSolicitacao } from '@/lib/solicitacoes-cliente';
import { CATEGORIAS, calcularItem, type Tipo } from '@/lib/reembolso';
import { type AnyRow, Field, Loading, FalhaDeCarregamento, PaginacaoDeLista } from './portal-presentation';

type Executar = (acao: () => Promise<unknown>, mensagem?: string) => unknown;
type ItemTabela = { id: string; descricao: string; tipo: Tipo | null; valores: Record<string, number | string> };
type Tabela = { id: string; nome: string; padrao: boolean; revision: number; itens: ItemTabela[] };
type Cliente = { id: string; nome: string; taxa: number | null; pneuKm: number | null; observacao: string | null; executivo: string | null; tabelaId: string | null; ativo: boolean; revision: number };
type Config = { podeConfigurar: boolean; tabelas: Tabela[]; clientes: Cliente[] };
type Foto = { url: string; nome: string; video: boolean };
type ItemForm = { chave: number; peca: string; referencia: string; tipo: Tipo; kmTroca: string; ultimaTroca: string; qtd: string; valorUnit: string; diferencaPneu: string; dica: string; fotos: Foto[] };
type Form = { clienteId: string; clienteNome: string; taxaPct: string; categoria: string; modelo: string; placa: string; kmAtual: string; osAtual: string; observacao: string };

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');
const ROTULO_CAT: Record<string, string> = Object.fromEntries(CATEGORIAS);
const num = (v: string | number | null | undefined) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const pct = (t: number | null) => (t === null ? '—' : `${inteiro.format(Math.round(t * 10000) / 100)}%`);
const valorTxt = (v: number | string | null | undefined) => (typeof v === 'number' ? `${inteiro.format(v)} km` : v ? String(v) : '—');
const json = (method: string, corpo: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
const formVazio = (): Form => ({ clienteId: '', clienteNome: '', taxaPct: '', categoria: 'HATCH_SEDAN', modelo: '', placa: '', kmAtual: '', osAtual: '', observacao: '' });
let proximaChave = 1;
const itemVazio = (): ItemForm => ({ chave: proximaChave++, peca: '', referencia: '', tipo: 'PROPORCIONAL', kmTroca: '', ultimaTroca: '', qtd: '1', valorUnit: '', diferencaPneu: '0', dica: '', fotos: [] });

function tabelaAtiva(config: Config | null, clienteId: string) {
  if (!config) return null;
  const cliente = config.clientes.find(c => c.id === clienteId);
  return config.tabelas.find(t => t.id === cliente?.tabelaId) ?? config.tabelas.find(t => t.padrao) ?? null;
}
// Mesma ordem da calculadora antiga: km crescente, depois meses, "conforme manual", outros e sem MTBF.
function grupoValor(v: number | string | undefined) {
  if (typeof v === 'number') return { ordem: v, rotulo: `${inteiro.format(v)} km` };
  if (!v) return { ordem: 9e12, rotulo: 'Sem MTBF definida' };
  const meses = /^(\d+)\s*MESES/i.exec(v);
  if (meses) return { ordem: 1e9 + Number(meses[1]), rotulo: `${meses[1]} meses` };
  if (/manual/i.test(v)) return { ordem: 2e9, rotulo: 'Conforme manual' };
  return { ordem: 3e9, rotulo: v };
}
function aplicarReferencia(item: ItemForm, ref: ItemTabela | undefined, categoria: string): ItemForm {
  if (!ref) return { ...item, referencia: '', kmTroca: '', dica: '' };
  const v = ref.valores[categoria];
  return { ...item, referencia: ref.descricao, tipo: ref.tipo ?? item.tipo, kmTroca: typeof v === 'number' ? String(v) : '',
    dica: typeof v === 'string' ? `referência: ${v} — não é km; preencha à mão ou use o tipo Integral` : '' };
}

export function Reembolso({ nav, busy, run }: { nav: string; busy: boolean; run: Executar }) {
  const [config, setConfig] = useState<Config | null>(null), [erro, setErro] = useState('');
  const [form, setForm] = useState<Form>(formVazio), [itens, setItens] = useState<ItemForm[]>(() => [itemVazio()]);
  const carregar = useCallback(async (signal?: AbortSignal) => {
    const dados = await api('/api/reembolso/config', { signal }) as Config;
    if (signal?.aborted) return;
    setConfig(dados); setErro('');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void carregar(controller.signal).catch(f => { if (!controller.signal.aborted) setErro(errorText(f)); }); });
    return () => controller.abort();
  }, [carregar]);
  const abrirCalculo = (calc: AnyRow) => {
    for (const i of itens) for (const f of i.fotos) URL.revokeObjectURL(f.url);
    const cliente = config?.clientes.find(c => c.nome.toLowerCase() === String(calc.cliente ?? '').toLowerCase());
    setForm({ clienteId: cliente?.id ?? '', clienteNome: calc.cliente ?? '', taxaPct: String(Math.round(calc.taxa * 10000) / 100), categoria: calc.categoria,
      modelo: calc.modelo ?? '', placa: calc.placa ?? '', kmAtual: String(calc.kmAtual ?? ''), osAtual: calc.osAtual ?? '', observacao: calc.observacao ?? '' });
    setItens((calc.itens as AnyRow[]).map(i => ({ ...itemVazio(), peca: i.peca ?? '', referencia: i.referencia ?? '', tipo: i.tipo, kmTroca: String(i.kmTroca || ''),
      ultimaTroca: String(i.ultimaTroca || ''), qtd: String(i.qtd ?? 1), valorUnit: String(i.valorUnit || ''), diferencaPneu: String(i.diferencaPneu ?? 0) })));
  };

  if (erro && !config) return <FalhaDeCarregamento erro={erro} tentar={() => void carregar().catch(f => setErro(errorText(f)))} />;
  if (!config) return <Loading label="Carregando reembolso…" compact />;
  const vazio = !config.tabelas.length;
  return <>
    <div className={nav === 'reembolso' ? '' : 'hidden'}>
      <Calculadora config={config} form={form} setForm={setForm} itens={itens} setItens={setItens} busy={busy} run={run} vazio={vazio} />
    </div>
    {nav === 'reembolso-salvos' && <Salvos busy={busy} run={run} abrir={abrirCalculo} />}
    {nav === 'reembolso-tabelas' && <Tabelas config={config} />}
    {nav === 'reembolso-config' && config.podeConfigurar && <Configuracao config={config} recarregar={() => carregar()} busy={busy} run={run} />}
  </>;
}

function Calculadora({ config, form, setForm, itens, setItens, busy, run, vazio }: {
  config: Config; form: Form; setForm: (f: Form | ((f: Form) => Form)) => void; itens: ItemForm[]; setItens: (i: ItemForm[] | ((i: ItemForm[]) => ItemForm[])) => void;
  busy: boolean; run: Executar; vazio: boolean;
}) {
  const tabela = tabelaAtiva(config, form.clienteId);
  const cliente = config.clientes.find(c => c.id === form.clienteId);
  const taxa = num(form.taxaPct) / 100, kmAtual = num(form.kmAtual);
  const opcoes = useMemo(() => {
    const grupos = new Map<string, { ordem: number; itens: ItemTabela[] }>();
    for (const it of tabela?.itens ?? []) {
      const g = grupoValor(it.valores[form.categoria]);
      const atual = grupos.get(g.rotulo) ?? { ordem: g.ordem, itens: [] };
      atual.itens.push(it); grupos.set(g.rotulo, atual);
    }
    return [...grupos].sort((a, b) => a[1].ordem - b[1].ordem).map(([rotulo, g]) => ({ rotulo, itens: g.itens.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR')) }));
  }, [tabela, form.categoria]);
  const resultados = itens.map(i => calcularItem({ tipo: i.tipo, kmTroca: num(i.kmTroca), ultimaTroca: num(i.ultimaTroca), qtd: num(i.qtd), valorUnit: num(i.valorUnit), diferencaPneu: num(i.diferencaPneu) }, kmAtual, taxa));
  const totalCusto = resultados.reduce((s, r) => s + r.valorTotal, 0), totalReembolso = resultados.reduce((s, r) => s + r.reembolso, 0);
  const mudar = (campo: keyof Form, valor: string) => setForm(f => ({ ...f, [campo]: valor }));
  const mudarItem = (chave: number, dados: Partial<ItemForm>) => setItens(lista => lista.map(i => (i.chave === chave ? { ...i, ...dados } : i)));
  // Trocar cliente ou categoria reaplica a MTBF da nova tabela; item sem par perde a referencia.
  const reaplicar = (clienteId: string, categoria: string) => {
    const nova = tabelaAtiva(config, clienteId);
    setItens(lista => lista.map(i => (i.referencia ? aplicarReferencia(i, nova?.itens.find(r => r.descricao === i.referencia), categoria) : i)));
  };
  const escolherCliente = (id: string) => {
    const c = config.clientes.find(x => x.id === id);
    setForm(f => ({ ...f, clienteId: id, clienteNome: c?.nome ?? '', taxaPct: c && c.taxa !== null ? String(Math.round(c.taxa * 10000) / 100) : '' }));
    reaplicar(id, form.categoria);
  };
  const limpar = () => {
    if (!confirm('Limpar o cálculo atual?')) return;
    for (const i of itens) for (const f of i.fotos) URL.revokeObjectURL(f.url);
    setForm(formVazio()); setItens([itemVazio()]);
  };
  const salvar = () => run(async () => {
    await api('/api/reembolso/calculos', json('POST', {
      placa: form.placa, cliente: form.clienteNome || null, taxa, categoria: form.categoria, modelo: form.modelo, kmAtual, osAtual: form.osAtual,
      observacao: form.observacao, tabela: tabela?.nome ?? null,
      itens: itens.map(i => ({ peca: i.peca, referencia: i.referencia, tipo: i.tipo, kmTroca: num(i.kmTroca), ultimaTroca: num(i.ultimaTroca), qtd: num(i.qtd), valorUnit: num(i.valorUnit), diferencaPneu: num(i.diferencaPneu) })),
    }));
  }, 'Cálculo salvo. Ele aparece em Reembolso › Salvos.');
  const anexar = (chave: number, arquivos: FileList | null) => {
    const fotos = [...(arquivos ?? [])].filter(a => /^(image|video)\//.test(a.type)).map(a => ({ url: URL.createObjectURL(a), nome: a.name, video: a.type.startsWith('video/') }));
    setItens(lista => lista.map(i => (i.chave === chave ? { ...i, fotos: [...i.fotos, ...fotos] } : i)));
  };
  const remover = (chave: number) => setItens(lista => {
    for (const f of lista.find(i => i.chave === chave)?.fotos ?? []) URL.revokeObjectURL(f.url);
    const resto = lista.filter(i => i.chave !== chave);
    return resto.length ? resto : [itemVazio()];
  });
  const podeSalvar = itens.some(i => num(i.valorUnit) > 0) && !busy;
  const [hoje] = useState(() => new Date().toLocaleDateString('pt-BR'));

  return <div className="patio-page space-y-4">
    <div className="no-print space-y-4">
      <LinhaDeAba actions={<>
        <Button variant="outline" disabled={busy} onClick={limpar}><X /> Limpar</Button>
        <Button variant="outline" onClick={() => window.print()}><Printer /> Imprimir / PDF</Button>
        <Button variant="create" disabled={!podeSalvar} onClick={() => void salvar()}><Save /> Salvar cálculo</Button>
      </>} />
      {vazio && <p className="text-sm text-muted-foreground">Ainda não há clientes nem tabelas MTBF. Suprimentos importa a calculadora antiga em Reembolso › Configuração.</p>}
      <Card><CardContent className="reembolso-cabecalho">
        <div className="reembolso-cliente">
          <SearchSelect label="Cliente" value={form.clienteId} limit={80} options={config.clientes.filter(c => c.ativo).map(c => ({ id: c.id, name: c.nome }))} onChange={escolherCliente} />
        </div>
        <Field label="Taxa administrativa (%)"><Input type="number" step="0.01" min="0" max="100" value={form.taxaPct} onChange={e => mudar('taxaPct', e.target.value)} /></Field>
        <Field label="Categoria">
          <NativeSelect value={form.categoria} onChange={e => { mudar('categoria', e.target.value); reaplicar(form.clienteId, e.target.value); }}>
            {CATEGORIAS.map(([id, nome]) => <NativeSelectOption key={id} value={id}>{nome}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <Field label="Modelo"><Input value={form.modelo} maxLength={80} onChange={e => mudar('modelo', e.target.value)} placeholder="ex. STRADA" /></Field>
        <Field label="Placa"><Input value={form.placa} maxLength={10} onChange={e => mudar('placa', e.target.value.toUpperCase())} /></Field>
        <Field label="KM atual do veículo"><Input type="number" min="0" step="1" value={form.kmAtual} onChange={e => mudar('kmAtual', e.target.value)} /></Field>
        <Field label="OS atual (opcional)"><Input value={form.osAtual} maxLength={30} inputMode="numeric" onChange={e => mudar('osAtual', e.target.value)} /></Field>
        <p className="reembolso-info text-xs text-muted-foreground">
          {`MTBF: ${tabela ? tabela.nome : '—'}${cliente?.executivo ? ` · Comercial: ${cliente.executivo}` : ''}${cliente?.observacao ? ` · ${cliente.observacao}` : ''}`}
          {cliente && cliente.taxa === null ? ' · cliente sem taxa cadastrada: preencha à mão' : ''}
        </p>
      </CardContent></Card>

      <div className="space-y-3">{itens.map((i, n) => {
        const r = resultados[n];
        return <Card key={i.chave}><CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <span className="patio-codigo pb-2">{n + 1}</span>
            <Field label="Peça / M.O." className="flex-1"><Input value={i.peca} maxLength={200} placeholder="ex. Pneu 205/60 R16" onChange={e => mudarItem(i.chave, { peca: e.target.value })} /></Field>
            <Field label="Referência MTBF" className="flex-[1.4]">
              <NativeSelect className="w-full" value={i.referencia} onChange={e => setItens(lista => lista.map(x => (x.chave === i.chave ? aplicarReferencia(x, tabela?.itens.find(r => r.descricao === e.target.value), form.categoria) : x)))}>
                <NativeSelectOption value="">— selecionar peça/serviço —</NativeSelectOption>
                {opcoes.map(g => <optgroup key={g.rotulo} label={`MTBF ${g.rotulo}`}>{g.itens.map(it => (
                  <NativeSelectOption key={it.id} value={it.descricao}>{`${it.descricao} — ${g.rotulo}${it.tipo ? ` · ${it.tipo === 'INTEGRAL' ? 'Integral' : 'Proporcional'}` : ''}`}</NativeSelectOption>))}</optgroup>)}
              </NativeSelect>
            </Field>
            <Button variant="ghost" size="icon" aria-label={`Remover item ${n + 1}`} title="Remover item" onClick={() => remover(i.chave)}><Trash2 /></Button>
          </div>
          <div className="reembolso-item">
            <Field label="Tipo">
              <NativeSelect value={i.tipo} onChange={e => mudarItem(i.chave, { tipo: e.target.value as Tipo })}>
                <NativeSelectOption value="PROPORCIONAL">Proporcional</NativeSelectOption>
                <NativeSelectOption value="INTEGRAL">Integral</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field label="KM de troca"><Input type="number" min="0" value={i.kmTroca} title={i.dica} onChange={e => mudarItem(i.chave, { kmTroca: e.target.value, dica: '' })} /></Field>
            <Field label="Última troca (km)"><Input type="number" min="0" value={i.ultimaTroca} onChange={e => mudarItem(i.chave, { ultimaTroca: e.target.value })} /></Field>
            <Field label="Qtd"><Input type="number" min="0" value={i.qtd} onChange={e => mudarItem(i.chave, { qtd: e.target.value })} /></Field>
            <Field label="Valor unit. (R$)"><Input type="number" min="0" step="0.01" value={i.valorUnit} onChange={e => mudarItem(i.chave, { valorUnit: e.target.value })} /></Field>
            <Field label="Dif. pneu MT/AT (R$)"><Input type="number" step="0.01" value={i.diferencaPneu} title="Só para pneus; demais itens, 0" onChange={e => mudarItem(i.chave, { diferencaPneu: e.target.value })} /></Field>
            <div className="reembolso-resultado"><span>KM restante</span><b>{num(i.kmTroca) > 0 ? inteiro.format(Math.round(r.kmRestante)) : '—'}</b></div>
            <div className="reembolso-resultado"><span>Valor total</span><b>{moeda.format(r.valorTotal)}</b></div>
            <div className="reembolso-resultado destaque"><span>Reembolso</span><b>{moeda.format(r.reembolso)}</b></div>
          </div>
          {i.dica && <p className="text-xs text-muted-foreground">{i.dica}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-link">
              <input type="file" accept="image/*,video/*" multiple hidden onChange={e => { anexar(i.chave, e.target.files); e.target.value = ''; }} />
              <Plus className="size-3" /> Fotos da avaria
            </label>
            {i.fotos.map((f, k) => <span key={f.url} className="inline-flex items-center gap-1 rounded border px-1.5 text-xs">{f.nome}
              <button type="button" aria-label={`Remover ${f.nome}`} onClick={() => { URL.revokeObjectURL(f.url); mudarItem(i.chave, { fotos: i.fotos.filter((_, x) => x !== k) }); }}><X className="size-3" /></button></span>)}
            {i.fotos.length > 0 && <span className="text-xs text-muted-foreground">só para a impressão; não ficam salvas</span>}
          </div>
        </CardContent></Card>;
      })}</div>
      <Button variant="outline" onClick={() => setItens(lista => [...lista, itemVazio()])}><Plus /> Adicionar item</Button>

      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent><p className="text-xs font-medium text-muted-foreground">Custo total da manutenção</p><p className="text-2xl font-semibold tabular-nums">{moeda.format(totalCusto)}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs font-medium text-muted-foreground">Total do reembolso ao cliente</p><p className="text-2xl font-semibold tabular-nums">{moeda.format(totalReembolso)}</p></CardContent></Card>
      </div>
      <Field label="Observações"><Textarea value={form.observacao} maxLength={2000} onChange={e => mudar('observacao', e.target.value)} placeholder="Observação relevante sobre esta manutenção" /></Field>
      <p className="text-xs text-muted-foreground">
        KM restante = KM de troca − (KM atual − última troca) · proporcional = valor total ÷ KM de troca × KM restante · reembolso = (base + diferença de pneu) × (1 + taxa); negativo vira zero.
      </p>
    </div>

    <section className="so-impressao reembolso-impressao">
      <h1>Cálculo de manutenção reembolsável — Leves</h1>
      <p>{`Cliente: ${form.clienteNome || '—'} · Taxa: ${pct(taxa)} · Categoria: ${ROTULO_CAT[form.categoria]} · Modelo: ${form.modelo || '—'} · Placa: ${form.placa || '—'} · KM atual: ${form.kmAtual ? inteiro.format(kmAtual) : '—'}${form.osAtual ? ` · OS ${form.osAtual}` : ''} · MTBF: ${tabela?.nome ?? '—'} · ${hoje}`}</p>
      <table>
        <thead><tr><th>#</th><th>Peça / M.O.</th><th>Referência MTBF</th><th>Tipo</th><th>KM troca</th><th>Última troca</th><th>KM restante</th><th>Qtd</th><th>Val. unit.</th><th>Val. total</th><th>Dif. pneu</th><th>Avaria s/ T.A.</th><th>Taxa</th><th>Reembolso</th></tr></thead>
        <tbody>{itens.map((i, n) => { const r = resultados[n]; return <tr key={i.chave}>
          <td>{n + 1}</td><td>{i.peca}</td><td>{i.referencia}</td><td>{i.tipo === 'INTEGRAL' ? 'Integral' : 'Proporcional'}</td><td>{i.kmTroca}</td><td>{i.ultimaTroca}</td>
          <td>{num(i.kmTroca) > 0 ? inteiro.format(Math.round(r.kmRestante)) : ''}</td><td>{i.qtd}</td><td>{moeda.format(num(i.valorUnit))}</td><td>{moeda.format(r.valorTotal)}</td>
          <td>{moeda.format(num(i.diferencaPneu))}</td><td>{moeda.format(r.avaria)}</td><td>{moeda.format(r.valorTaxa)}</td><td>{moeda.format(r.reembolso)}</td></tr>; })}</tbody>
      </table>
      <p><b>{`Custo total: ${moeda.format(totalCusto)} · Total do reembolso: ${moeda.format(totalReembolso)}`}</b></p>
      {form.observacao && <p>{`Observações: ${form.observacao}`}</p>}
      <div className="reembolso-evidencias">{itens.flatMap((i, n) => i.fotos.filter(f => !f.video).map(f => <figure key={f.url}>
        {/* oxlint-disable-next-line next/no-img-element -- foto local (blob:) so para impressao */}
        <img src={f.url} alt={f.nome} /><figcaption>{`Item ${n + 1}: ${f.nome}`}</figcaption></figure>))}</div>
    </section>
  </div>;
}

function Salvos({ busy, run, abrir }: { busy: boolean; run: Executar; abrir: (calc: AnyRow) => void }) {
  const [busca, setBusca] = useState(''), [termo, setTermo] = useState(''), [pagina, setPagina] = useState(1), [versao, setVersao] = useState(0);
  const [dados, setDados] = useState<AnyRow | null>(null), [erro, setErro] = useState('');
  useEffect(() => { const t = setTimeout(() => { setTermo(busca.trim()); setPagina(1); }, 300); return () => clearTimeout(t); }, [busca]);
  useEffect(() => {
    const controller = new AbortController(), params = new URLSearchParams({ pagina: String(pagina) });
    if (termo) params.set('q', termo);
    void api(`/api/reembolso/calculos?${params}`, { signal: controller.signal }).then((r: AnyRow) => { if (!controller.signal.aborted) { setDados(r); setErro(''); } })
      .catch(f => { if (!controller.signal.aborted) setErro(errorText(f)); });
    return () => controller.abort();
  }, [termo, pagina, versao]);
  const carregarNaCalculadora = (id: string) => void run(async () => abrir((await api(`/api/reembolso/calculos/${encodeURIComponent(id)}`) as AnyRow).calculo), 'Cálculo aberto na Calculadora.');
  const excluir = (c: AnyRow) => {
    if (!confirm(`Excluir o cálculo da placa ${c.placa || '(sem placa)'}?`)) return;
    void run(async () => { await api(`/api/reembolso/calculos/${encodeURIComponent(c.id)}`, { method: 'DELETE' }); setVersao(v => v + 1); }, 'Cálculo excluído.');
  };
  if (erro && !dados) return <FalhaDeCarregamento erro={erro} tentar={() => setVersao(v => v + 1)} />;
  return <div className="patio-page space-y-4">
    <LinhaDeAba actions={<Button variant="outline" size="icon" aria-label="Atualizar" title="Atualizar" onClick={() => setVersao(v => v + 1)}><RefreshCw /></Button>} />
    <div className="patio-filters"><div className="patio-filter-search"><Input aria-label="Buscar por placa ou cliente" placeholder="Buscar por placa ou cliente" value={busca} onChange={e => setBusca(e.target.value)} /></div></div>
    {!dados ? <Loading label="Carregando cálculos…" compact /> : <TabelaPadrao contador={`${inteiro.format(dados.total)} ${dados.total === 1 ? 'cálculo' : 'cálculos'}`}
      pagina={<PaginacaoDeLista pagina={dados.pagina} paginas={dados.paginas} alterar={setPagina} />}
      vazio={!dados.calculos.length ? <p className="p-6 text-center text-muted-foreground">Nenhum cálculo salvo{termo ? ' com essa busca' : ''}.</p> : undefined}>
      <TableHeader><TableRow><TableHead style={{ width: 100 }}>Placa</TableHead><TableHead>Cliente</TableHead><TableHead style={{ width: 130 }}>Modelo</TableHead>
        <TableHead style={{ width: 120 }}>Categoria</TableHead><TableHead style={{ width: 170 }}>Salvo em</TableHead><TableHead className="patio-num text-right" style={{ width: 140 }}>Reembolso</TableHead><TableHead style={{ width: 150 }}><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
      <TableBody>{(dados.calculos as AnyRow[]).map(c => <TableRow key={c.id}>
        <TableCell className="patio-num font-medium">{c.placa || '—'}</TableCell><TableCell>{c.cliente || '—'}</TableCell><TableCell>{c.modelo || '—'}</TableCell>
        <TableCell>{ROTULO_CAT[c.categoria] ?? c.categoria}</TableCell>
        <TableCell className="text-xs"><div>{dataHoraSolicitacao(c.criadoEm)}</div><div className="text-muted-foreground">{c.autor ?? '—'}</div></TableCell>
        <TableCell className="patio-num text-right tabular-nums">{moeda.format(c.totalReembolso)}</TableCell>
        <TableCell><div className="flex justify-end"><Button variant="ghost" disabled={busy} onClick={() => carregarNaCalculadora(c.id)}>Abrir</Button>
          <Button variant="ghost" size="icon" disabled={busy} aria-label={`Excluir cálculo ${c.placa ?? ''}`} title="Excluir" onClick={() => excluir(c)}><Trash2 /></Button></div></TableCell>
      </TableRow>)}</TableBody>
    </TabelaPadrao>}
  </div>;
}

function Tabelas({ config }: { config: Config }) {
  const [busca, setBusca] = useState(''), [tabelaId, setTabelaId] = useState(''), [clienteId, setClienteId] = useState(''), [tipo, setTipo] = useState('');
  const termo = busca.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const linhas = config.tabelas.filter(t => !tabelaId || t.id === tabelaId).flatMap(t => t.itens.filter(i => (!tipo || i.tipo === tipo)
    && (!termo || i.descricao.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(termo))).map(i => ({ t, i })));
  const vinculados = tabelaId ? config.clientes.filter(c => (c.tabelaId ?? config.tabelas.find(t => t.padrao)?.id) === tabelaId) : [];
  const escolherCliente = (id: string) => { setClienteId(id); if (id) setTabelaId(tabelaAtiva(config, id)?.id ?? ''); };
  return <div className="patio-page space-y-4">
    <LinhaDeAba />
    <Card><CardContent className="reembolso-filtros">
      <Field label="Peça, componente ou serviço"><Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="ex.: pastilha, alternador, bateria" /></Field>
      <SearchSelect label="Cliente" value={clienteId} limit={80} options={config.clientes.filter(c => c.ativo).map(c => ({ id: c.id, name: c.nome }))} onChange={escolherCliente} />
      <Field label="Tabela MTBF">
        <NativeSelect value={tabelaId} onChange={e => { setTabelaId(e.target.value); setClienteId(''); }}>
          <NativeSelectOption value="">Todas</NativeSelectOption>
          {config.tabelas.map(t => <NativeSelectOption key={t.id} value={t.id}>{t.nome}{t.padrao ? ' (padrão)' : ''}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      <Field label="Ressarcimento">
        <NativeSelect value={tipo} onChange={e => setTipo(e.target.value)}>
          <NativeSelectOption value="">Todos</NativeSelectOption><NativeSelectOption value="INTEGRAL">Integral</NativeSelectOption><NativeSelectOption value="PROPORCIONAL">Proporcional</NativeSelectOption>
        </NativeSelect>
      </Field>
    </CardContent></Card>
    {tabelaId && <p className="text-xs text-muted-foreground">{vinculados.length ? `Clientes com esta tabela: ${vinculados.map(c => c.nome).join(', ')}` : 'Nenhum cliente usa esta tabela.'}</p>}
    <TabelaPadrao contador={`${inteiro.format(linhas.length)} ${linhas.length === 1 ? 'item' : 'itens'}${linhas.length > 400 ? ' · mostrando os primeiros 400; filtre para ver os demais' : ''}`}
      vazio={!linhas.length ? <p className="p-6 text-center text-muted-foreground">Nenhum item com esses filtros.</p> : undefined}>
      <TableHeader><TableRow>{!tabelaId && <TableHead style={{ width: 200 }}>Tabela</TableHead>}<TableHead>Peça / serviço</TableHead><TableHead style={{ width: 110 }}>Tipo</TableHead>
        {CATEGORIAS.map(([id, nome]) => <TableHead key={id} className="patio-num text-right" style={{ width: 110 }}>{nome}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{linhas.slice(0, 400).map(({ t, i }) => <TableRow key={i.id}>
        {!tabelaId && <TableCell className="truncate text-xs" title={t.nome}>{t.nome}</TableCell>}
        <TableCell>{i.descricao}</TableCell><TableCell className="text-xs">{i.tipo === 'INTEGRAL' ? 'Integral' : i.tipo === 'PROPORCIONAL' ? 'Proporcional' : '—'}</TableCell>
        {CATEGORIAS.map(([id]) => <TableCell key={id} className="patio-num text-right text-xs tabular-nums">{valorTxt(i.valores[id])}</TableCell>)}
      </TableRow>)}</TableBody>
    </TabelaPadrao>
  </div>;
}

function Configuracao({ config, recarregar, busy, run }: { config: Config; recarregar: () => Promise<void>; busy: boolean; run: Executar }) {
  const [editando, setEditando] = useState<Partial<Cliente> | null>(null), [busca, setBusca] = useState('');
  const [tabelaId, setTabelaId] = useState(() => config.tabelas.find(t => t.padrao)?.id ?? '');
  const arquivo = useRef<HTMLInputElement>(null);
  const importar = async (lista: FileList | null) => {
    const html = lista?.[0] ? await lista[0].text() : '';
    if (!html) return;
    const substituir = config.tabelas.length > 0 || config.clientes.length > 0;
    if (substituir && !confirm('Substituir TODOS os clientes, taxas e tabelas MTBF pelos do arquivo? Os cálculos salvos não mudam.')) return;
    void run(async () => {
      await api('/api/reembolso/importar', json('POST', { html, substituir }));
      await recarregar();
    }, 'Calculadora importada.');
  };
  const termo = busca.toLowerCase().trim();
  const clientes = config.clientes.filter(c => !termo || c.nome.toLowerCase().includes(termo) || (c.executivo ?? '').toLowerCase().includes(termo));
  const nomeTabela = (id: string | null) => (id ? config.tabelas.find(t => t.id === id)?.nome ?? '—' : 'Padrão');
  const excluirCliente = (c: Cliente) => {
    if (!confirm(`Excluir o cliente ${c.nome}? Cálculos já salvos não mudam.`)) return;
    void run(async () => { await api(`/api/reembolso/clientes/${encodeURIComponent(c.id)}`, { method: 'DELETE' }); await recarregar(); }, 'Cliente excluído.');
  };
  return <div className="patio-page space-y-4">
    <LinhaDeAba actions={<>
      <input ref={arquivo} type="file" accept=".html,text/html" hidden onChange={e => { void importar(e.target.files); e.target.value = ''; }} />
      <Button variant="outline" disabled={busy} onClick={() => arquivo.current?.click()}><FileUp /> Importar calculadora HTML</Button>
      <Button variant="create" disabled={busy} onClick={() => setEditando({ ativo: true, taxa: 0.25, pneuKm: 40000, tabelaId: null })}><Plus /> Novo cliente</Button>
    </>} />
    <div className="patio-filters"><div className="patio-filter-search"><Input aria-label="Buscar cliente" placeholder="Buscar cliente ou executivo" value={busca} onChange={e => setBusca(e.target.value)} /></div></div>
    <TabelaPadrao contador={`${inteiro.format(clientes.length)} ${clientes.length === 1 ? 'cliente' : 'clientes'}`}
      vazio={!clientes.length ? <p className="p-6 text-center text-muted-foreground">{config.clientes.length ? 'Nenhum cliente com essa busca.' : 'Nenhum cliente. Importe a calculadora HTML ou cadastre um novo.'}</p> : undefined}>
      <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead className="patio-num text-right" style={{ width: 80 }}>Taxa</TableHead><TableHead className="patio-num text-right" style={{ width: 100 }}>KM pneu</TableHead>
        <TableHead style={{ width: 200 }}>Tabela MTBF</TableHead><TableHead style={{ width: 120 }}>Executivo</TableHead><TableHead style={{ width: 90 }}>Situação</TableHead><TableHead style={{ width: 90 }}><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
      <TableBody>{clientes.map(c => <TableRow key={c.id}>
        <TableCell><div className="font-medium">{c.nome}</div>{c.observacao && <div className="truncate text-xs text-muted-foreground" title={c.observacao}>{c.observacao}</div>}</TableCell>
        <TableCell className="patio-num text-right tabular-nums">{pct(c.taxa)}</TableCell><TableCell className="patio-num text-right tabular-nums">{c.pneuKm === null ? '—' : inteiro.format(c.pneuKm)}</TableCell>
        <TableCell className="truncate text-xs" title={nomeTabela(c.tabelaId)}>{nomeTabela(c.tabelaId)}</TableCell><TableCell className="text-xs">{c.executivo ?? '—'}</TableCell>
        <TableCell className="text-xs">{c.ativo ? 'Ativo' : 'Inativo'}</TableCell>
        <TableCell><div className="flex justify-end"><Button variant="ghost" size="icon" disabled={busy} aria-label={`Editar ${c.nome}`} title="Editar" onClick={() => setEditando(c)}><Pencil /></Button>
          <Button variant="ghost" size="icon" disabled={busy} aria-label={`Excluir ${c.nome}`} title="Excluir" onClick={() => excluirCliente(c)}><Trash2 /></Button></div></TableCell>
      </TableRow>)}</TableBody>
    </TabelaPadrao>
    <EditorTabela key={`${tabelaId}:${config.tabelas.find(t => t.id === tabelaId)?.revision ?? 0}`} config={config} tabelaId={tabelaId} setTabelaId={setTabelaId} recarregar={recarregar} busy={busy} run={run} />
    {editando && <DialogoCliente valor={editando} config={config} busy={busy} fechar={() => setEditando(null)} salvar={corpo => run(async () => {
      await api(editando.id ? `/api/reembolso/clientes/${encodeURIComponent(editando.id)}` : '/api/reembolso/clientes', json(editando.id ? 'PUT' : 'POST', corpo));
      setEditando(null); await recarregar();
    }, 'Cliente salvo.')} />}
  </div>;
}

function DialogoCliente({ valor, config, busy, fechar, salvar }: { valor: Partial<Cliente>; config: Config; busy: boolean; fechar: () => void; salvar: (corpo: unknown) => unknown }) {
  const [f, setF] = useState({ nome: valor.nome ?? '', taxaPct: valor.taxa === null || valor.taxa === undefined ? '' : String(Math.round(valor.taxa * 10000) / 100),
    pneuKm: valor.pneuKm === null || valor.pneuKm === undefined ? '' : String(valor.pneuKm), observacao: valor.observacao ?? '', executivo: valor.executivo ?? '',
    tabelaId: valor.tabelaId ?? '', ativo: valor.ativo !== false });
  const enviar = () => salvar({ nome: f.nome, taxa: f.taxaPct.trim() === '' ? null : num(f.taxaPct) / 100, pneuKm: f.pneuKm.trim() === '' ? null : num(f.pneuKm),
    observacao: f.observacao, executivo: f.executivo, tabelaId: f.tabelaId || null, ativo: f.ativo, expectedRevision: valor.revision });
  return <Dialog open onOpenChange={x => !x && !busy && fechar()}><DialogContent>
    <DialogHeader><DialogTitle>{valor.id ? 'Editar cliente' : 'Novo cliente'}</DialogTitle></DialogHeader>
    <fieldset disabled={busy} className="space-y-3">
      <Field label="Cliente (nome exato)"><Input value={f.nome} maxLength={200} onChange={e => setF({ ...f, nome: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Taxa administrativa (%)"><Input type="number" min="0" max="100" step="0.01" value={f.taxaPct} placeholder="vazio = sem taxa" onChange={e => setF({ ...f, taxaPct: e.target.value })} /></Field>
        <Field label="KM do pneu"><Input type="number" min="0" value={f.pneuKm} onChange={e => setF({ ...f, pneuKm: e.target.value })} /></Field>
      </div>
      <Field label="Tabela MTBF">
        <NativeSelect className="w-full" value={f.tabelaId} onChange={e => setF({ ...f, tabelaId: e.target.value })}>
          <NativeSelectOption value="">Padrão (demais clientes)</NativeSelectOption>
          {config.tabelas.filter(t => !t.padrao).map(t => <NativeSelectOption key={t.id} value={t.id}>{t.nome}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      <Field label="Executivo comercial"><Input value={f.executivo} maxLength={80} onChange={e => setF({ ...f, executivo: e.target.value })} /></Field>
      <Field label="Observação"><Textarea value={f.observacao} maxLength={500} onChange={e => setF({ ...f, observacao: e.target.value })} /></Field>
      <div className="flex items-center gap-2"><Checkbox aria-labelledby="cliente-ativo" checked={f.ativo} onCheckedChange={v => setF({ ...f, ativo: v === true })} /><span id="cliente-ativo" className="text-sm">Ativo (aparece na calculadora)</span></div>
    </fieldset>
    <DialogFooter><Button variant="outline" disabled={busy} onClick={fechar}>Cancelar</Button><Button disabled={busy || !f.nome.trim()} onClick={() => void enviar()}>Salvar</Button></DialogFooter>
  </DialogContent></Dialog>;
}

type LinhaEditor = { chave: number; descricao: string; tipo: string; valores: Record<string, string> };
function EditorTabela({ config, tabelaId, setTabelaId, recarregar, busy, run }: { config: Config; tabelaId: string; setTabelaId: (id: string) => void; recarregar: () => Promise<void>; busy: boolean; run: Executar }) {
  const tabela = config.tabelas.find(t => t.id === tabelaId);
  const [nome, setNome] = useState(tabela?.nome ?? ''), [padrao, setPadrao] = useState(Boolean(tabela?.padrao));
  const [linhas, setLinhas] = useState<LinhaEditor[]>(() => (tabela?.itens ?? []).map(i => ({ chave: proximaChave++, descricao: i.descricao, tipo: i.tipo ?? '',
    valores: Object.fromEntries(CATEGORIAS.map(([c]) => [c, i.valores[c] === undefined ? '' : String(i.valores[c])])) })));
  const corpo = () => ({ nome, padrao, expectedRevision: tabela?.revision, itens: linhas.filter(l => l.descricao.trim()).map(l => ({ descricao: l.descricao, tipo: l.tipo || null,
    valores: Object.fromEntries(Object.entries(l.valores).filter(([, v]) => v.trim()).map(([c, v]) => [c, /^\d+$/.test(v.trim()) ? Number(v) : v.trim()])) })) });
  const mudar = (chave: number, dados: Partial<LinhaEditor>) => setLinhas(l => l.map(x => (x.chave === chave ? { ...x, ...dados } : x)));
  const salvar = () => run(async () => { await api(`/api/reembolso/tabelas/${encodeURIComponent(tabelaId)}`, json('PUT', corpo())); await recarregar(); }, 'Tabela MTBF salva.');
  const nova = () => {
    const nomeNova = prompt('Nome da nova tabela MTBF (ela começa como cópia da tabela padrão):');
    if (!nomeNova?.trim()) return;
    const base = config.tabelas.find(t => t.padrao);
    void run(async () => {
      const r = await api('/api/reembolso/tabelas', json('POST', { nome: nomeNova, itens: base?.itens.map(i => ({ descricao: i.descricao, tipo: i.tipo, valores: i.valores })) ?? [] })) as AnyRow;
      await recarregar(); setTabelaId(r.id);
    }, 'Tabela MTBF criada.');
  };
  const excluir = () => {
    if (!tabela || !confirm(`Excluir a tabela ${tabela.nome}?`)) return;
    void run(async () => { await api(`/api/reembolso/tabelas/${encodeURIComponent(tabela.id)}`, { method: 'DELETE' }); setTabelaId(config.tabelas.find(t => t.padrao)?.id ?? ''); await recarregar(); }, 'Tabela MTBF excluída.');
  };
  return <Card><CardContent className="space-y-3">
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Tabela MTBF em edição">
        <NativeSelect value={tabelaId} onChange={e => setTabelaId(e.target.value)}>
          {!config.tabelas.length && <NativeSelectOption value="">Nenhuma tabela</NativeSelectOption>}
          {config.tabelas.map(t => <NativeSelectOption key={t.id} value={t.id}>{t.nome}{t.padrao ? ' (padrão)' : ''}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      {tabela && <Field label="Nome" className="min-w-72 flex-1"><Input value={nome} maxLength={200} onChange={e => setNome(e.target.value)} /></Field>}
      {tabela && !tabela.padrao && <div className="flex h-10 items-center gap-2"><Checkbox aria-labelledby="tabela-padrao" checked={padrao} onCheckedChange={v => setPadrao(v === true)} /><span id="tabela-padrao" className="text-sm">Tornar padrão</span></div>}
      <div className="ml-auto flex gap-2">
        <Button variant="outline" disabled={busy || !config.tabelas.some(t => t.padrao)} onClick={nova}><Plus /> Nova tabela</Button>
        {tabela && !tabela.padrao && <Button variant="outline" disabled={busy} onClick={excluir}><Trash2 /> Excluir</Button>}
        {tabela && <Button variant="create" disabled={busy} onClick={() => void salvar()}><Save /> Salvar tabela</Button>}
      </div>
    </div>
    {tabela && <>
      <p className="text-xs text-muted-foreground">Valor por categoria: KM (só números) ou texto, como &quot;24 MESES&quot; ou &quot;Conforme manual&quot;. Vazio = sem MTBF nessa categoria. Nada muda até clicar em Salvar tabela.</p>
      <div className="max-h-[560px] overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card"><tr className="text-left text-xs"><th className="p-2">Peça / serviço</th><th className="p-2" style={{ width: 130 }}>Tipo</th>
            {CATEGORIAS.map(([id, n]) => <th key={id} className="p-2" style={{ width: 120 }}>{n}</th>)}<th style={{ width: 40 }}><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{linhas.map(l => <tr key={l.chave} className="border-t">
            <td className="p-1"><Input aria-label="Peça ou serviço" value={l.descricao} maxLength={200} onChange={e => mudar(l.chave, { descricao: e.target.value })} /></td>
            <td className="p-1"><NativeSelect aria-label="Tipo" value={l.tipo} onChange={e => mudar(l.chave, { tipo: e.target.value })}>
              <NativeSelectOption value="">—</NativeSelectOption><NativeSelectOption value="INTEGRAL">Integral</NativeSelectOption><NativeSelectOption value="PROPORCIONAL">Proporcional</NativeSelectOption></NativeSelect></td>
            {CATEGORIAS.map(([id, n]) => <td key={id} className="p-1"><Input aria-label={n} value={l.valores[id]} maxLength={40} onChange={e => mudar(l.chave, { valores: { ...l.valores, [id]: e.target.value } })} /></td>)}
            <td className="p-1"><Button variant="ghost" size="icon" aria-label="Remover linha" onClick={() => setLinhas(x => x.filter(y => y.chave !== l.chave))}><X /></Button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <Button variant="outline" onClick={() => setLinhas(x => [...x, { chave: proximaChave++, descricao: '', tipo: '', valores: Object.fromEntries(CATEGORIAS.map(([c]) => [c, ''])) }])}><Plus /> Adicionar item</Button>
    </>}
  </CardContent></Card>;
}
