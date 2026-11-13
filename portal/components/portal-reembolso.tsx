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
import { textoBusca } from '@/lib/busca';
import { dataHoraSolicitacao } from '@/lib/solicitacoes-cliente';
import { CATEGORIAS, calcularItem, type Tipo } from '@/lib/reembolso';
import { candidatos, placaNormalizada, resumoPlaca, termosPadrao, type Candidato, type LinhaPlaca } from '@/lib/reembolso-historico';
import { type AnyRow, Field, Loading, FalhaDeCarregamento, PaginacaoDeLista } from './portal-presentation';

type Executar = (acao: () => Promise<unknown>, mensagem?: string) => unknown;
type ItemTabela = { id: string; descricao: string; tipo: Tipo | null; valores: Record<string, number | string> };
type Tabela = { id: string; nome: string; padrao: boolean; revision: number; itens: ItemTabela[] };
type Cliente = { id: string; nome: string; taxa: number | null; pneuKm: number | null; observacao: string | null; executivo: string | null; tabelaId: string | null; ativo: boolean; revision: number };
type Config = { podeConfigurar: boolean; tabelas: Tabela[]; clientes: Cliente[] };
type Foto = { url: string; nome: string; video: boolean };
// utModo: de onde veio a ultima troca. auto = melhor OS do historico (muda
// com placa, km e termos); escolhido = OS clicada; manual = digitado;
// salvo = veio de um calculo salvo. So "auto" e vazio sao recalculados.
type ModoUltimaTroca = '' | 'auto' | 'escolhido' | 'manual' | 'salvo';
// acordo*: condicao do acordo do fornecedor para conferir o valor unitario.
// acordoModo: auto = sugerida pela peca e pelo modelo (refeita quando eles
// mudam); manual = escolhida; salvo = veio de um calculo salvo.
type ItemForm = { chave: number; peca: string; referencia: string; tipo: Tipo; kmTroca: string; ultimaTroca: string; qtd: string; valorUnit: string; diferencaPneu: string; dica: string; fotos: Foto[];
  utModo: ModoUltimaTroca; utRotulo: string; termos: string; termosEditados: boolean;
  acordoId: string; acordoPreco: number | null; acordoTexto: string; acordoModo: '' | 'auto' | 'manual' | 'salvo' };
type Condicao = { id: string; acordo: string; item: string; modelo: string; cidade: string; uf: string; unidade: string; preco: number; marcas: string | null };
type FornecedorAcordo = { id: string; nome: string; cnpj: string };
type Veiculo = { cliente: string | null; modelo: string | null; data: string | null; clienteId: string | null };
type Historico = { placa: string; carregando?: boolean; erro?: string; consultadoEm?: string; aviso?: string | null; filtradas?: number; veiculo?: Veiculo; linhas: LinhaPlaca[] };
// Origem de cliente e modelo: "qlik" = veio da placa e pode ser trocado por
// outra placa; "manual" = escolhido pela pessoa e nunca e sobrescrito.
type Origem = '' | 'qlik' | 'manual';
type Form = { clienteId: string; clienteNome: string; taxaPct: string; categoria: string; modelo: string; placa: string; kmAtual: string; osAtual: string; observacao: string; clienteOrigem: Origem; modeloOrigem: Origem;
  fornecedorId: string; fornecedorNome: string };

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');
const ROTULO_CAT: Record<string, string> = Object.fromEntries(CATEGORIAS);
const num = (v: string | number | null | undefined) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const fracao = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (t: number | null) => (t === null ? '—' : `${inteiro.format(Math.round(t * 10000) / 100)}%`);
const valorTxt = (v: number | string | null | undefined) => (typeof v === 'number' ? `${inteiro.format(v)} km` : v ? String(v) : '—');
const json = (method: string, corpo: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
const formVazio = (): Form => ({ clienteId: '', clienteNome: '', taxaPct: '', categoria: 'HATCH_SEDAN', modelo: '', placa: '', kmAtual: '', osAtual: '', observacao: '', clienteOrigem: '', modeloOrigem: '', fornecedorId: '', fornecedorNome: '' });
// Placa antiga (ABC1234) ou Mercosul (ABC1D23): consulta na hora, sem esperar a digitacao.
const PLACA_COMPLETA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const taxaTexto = (t: number | null) => (t === null ? '' : String(Math.round(t * 10000) / 100));
let proximaChave = 1;
const itemVazio = (): ItemForm => ({ chave: proximaChave++, peca: '', referencia: '', tipo: 'PROPORCIONAL', kmTroca: '', ultimaTroca: '', qtd: '1', valorUnit: '', diferencaPneu: '0', dica: '', fotos: [],
  utModo: '', utRotulo: '', termos: '', termosEditados: false, acordoId: '', acordoPreco: null, acordoTexto: '', acordoModo: '' });
// Condicao do acordo: item e modelo com todas as palavras presentes na peca/
// referencia e no modelo do veiculo (sem modelo informado, so a peca).
const palavras = (t: string) => textoBusca(t).split(/[^a-z0-9.]+/).filter(w => w.length >= 3 || /\d/.test(w));
const contido = (curto: string, longo: string) => { const ws = palavras(curto), alvo = new Set(palavras(longo)); return ws.length > 0 && ws.every(w => alvo.has(w)); };
const condizCom = (c: Condicao, i: ItemForm, modelo: string) => contido(c.item, `${i.peca} ${i.referencia}`) && (!modelo.trim() || contido(c.modelo, modelo));
const rotuloCondicao = (c: Condicao) => `${c.item} · ${c.modelo} · ${c.cidade}/${c.uf} · ${moeda.format(c.preco)}/${c.unidade} · ${c.acordo}`;
const dataBr = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
const rotuloOs = (c: Candidato) => `OS ${c.os ?? '?'} · ${dataCurta(c.data)}`;
const termosDoItem = (i: ItemForm) => (i.termosEditados ? i.termos : termosPadrao(i.referencia || i.peca));
const ROTULO_TIPO: Record<Tipo, string> = { INTEGRAL: 'Integral', PROPORCIONAL: 'Proporcional' };

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
      modelo: calc.modelo ?? '', placa: calc.placa ?? '', kmAtual: String(calc.kmAtual ?? ''), osAtual: calc.osAtual ?? '', observacao: calc.observacao ?? '',
      clienteOrigem: 'manual', modeloOrigem: 'manual', fornecedorId: '', fornecedorNome: calc.fornecedor ?? '' });
    setItens((calc.itens as AnyRow[]).map(i => ({ ...itemVazio(), peca: i.peca ?? '', referencia: i.referencia ?? '', tipo: i.tipo, kmTroca: String(i.kmTroca || ''),
      ultimaTroca: String(i.ultimaTroca || ''), qtd: String(i.qtd ?? 1), valorUnit: String(i.valorUnit || ''), diferencaPneu: String(i.diferencaPneu ?? 0),
      utModo: i.ultimaTroca ? 'salvo' : '', utRotulo: i.origemUltimaTroca ?? '',
      ...(typeof i.precoAcordado === 'number' ? { acordoPreco: i.precoAcordado, acordoTexto: i.acordo ?? '', acordoModo: 'salvo' as const } : {}) })));
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
    {nav === 'reembolso-historico' && config.podeConfigurar && <FiltrosHistorico busy={busy} run={run} />}
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
  const opcoesMtbf = useMemo(() => {
    const grupos = new Map<string, { ordem: number; itens: ItemTabela[] }>();
    for (const it of tabela?.itens ?? []) {
      const g = grupoValor(it.valores[form.categoria]);
      const atual = grupos.get(g.rotulo) ?? { ordem: g.ordem, itens: [] };
      atual.itens.push(it); grupos.set(g.rotulo, atual);
    }
    // Mesma ordem de antes (grupo de MTBF, depois descricao); a descricao e o valor, entao nao se repete.
    const vistas = new Set<string>();
    return [...grupos].sort((a, b) => a[1].ordem - b[1].ordem).flatMap(([rotulo, g]) => g.itens.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
      .filter(it => !vistas.has(it.descricao) && Boolean(vistas.add(it.descricao)))
      .map(it => ({ id: it.descricao, name: `${it.descricao} — ${rotulo}${it.tipo ? ` · ${it.tipo === 'INTEGRAL' ? 'Integral' : 'Proporcional'}` : ''}` })));
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
    setForm(f => ({ ...f, clienteId: id, clienteNome: c?.nome ?? '', taxaPct: c ? taxaTexto(c.taxa) : '', clienteOrigem: id ? 'manual' : '' }));
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
      observacao: form.observacao, tabela: tabela?.nome ?? null, fornecedor: form.fornecedorNome || null,
      itens: itens.map(i => ({ peca: i.peca, referencia: i.referencia, tipo: i.tipo, kmTroca: num(i.kmTroca), ultimaTroca: num(i.ultimaTroca), qtd: num(i.qtd), valorUnit: num(i.valorUnit), diferencaPneu: num(i.diferencaPneu),
        origemUltimaTroca: i.ultimaTroca ? origemTexto(i) : null,
        precoAcordado: form.fornecedorNome && i.acordoPreco !== null ? i.acordoPreco : null, acordo: form.fornecedorNome && i.acordoPreco !== null ? i.acordoTexto : null })),
    }));
  }, 'Cálculo salvo. Ele aparece em Reembolso › Salvos.');
  const origemTexto = (i: ItemForm) => (i.utModo === 'auto' ? `automático · ${i.utRotulo}` : i.utModo === 'escolhido' ? `escolhido · ${i.utRotulo}`
    : i.utModo === 'salvo' ? i.utRotulo : i.utModo === 'manual' ? 'digitado' : '');
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
  // Fornecedor: so quem tem acordo vigente; as condicoes dele conferem o valor unitario.
  const [fornecedores, setFornecedores] = useState<FornecedorAcordo[] | null>(null), [condicoes, setCondicoes] = useState<{ id: string; lista: Condicao[]; erro?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api('/api/reembolso/fornecedores', { signal: controller.signal }).then((r: AnyRow) => { if (!controller.signal.aborted) setFornecedores(r.fornecedores); }).catch(() => { if (!controller.signal.aborted) setFornecedores([]); });
    return () => controller.abort();
  }, []);
  // Calculo salvo traz o nome do fornecedor; o id vem da lista atual.
  const fornecedorSalvo = !form.fornecedorId && form.fornecedorNome ? fornecedores?.find(f => f.nome === form.fornecedorNome) : undefined;
  useEffect(() => { if (fornecedorSalvo) setForm(f => ({ ...f, fornecedorId: fornecedorSalvo.id })); }, [fornecedorSalvo, setForm]);
  useEffect(() => {
    if (!form.fornecedorId) return;
    const controller = new AbortController(), id = form.fornecedorId;
    void api(`/api/reembolso/condicoes?${new URLSearchParams({ fornecedor: id })}`, { signal: controller.signal })
      .then((r: AnyRow) => { if (!controller.signal.aborted) setCondicoes({ id, lista: r.condicoes }); })
      .catch(f => { if (!controller.signal.aborted) setCondicoes({ id, lista: [], erro: errorText(f) }); });
    return () => controller.abort();
  }, [form.fornecedorId]);
  const listaCondicoes = useMemo(() => (form.fornecedorId && condicoes?.id === form.fornecedorId ? condicoes.lista : []), [condicoes, form.fornecedorId]);
  // Sugestao automatica: uma unica condicao que bate com a peca e o modelo.
  const chaveSugestao = itens.map(i => `${i.chave}|${i.peca}|${i.referencia}|${i.acordoModo}|${i.acordoId}`).join('\n');
  useEffect(() => {
    if (!listaCondicoes.length) return;
    setItens(lista => {
      let mudou = false;
      const nova = lista.map(i => {
        if (i.acordoModo !== '' && i.acordoModo !== 'auto') return i;
        const achadas = listaCondicoes.filter(c => condizCom(c, i, form.modelo)), c = achadas.length === 1 ? achadas[0] : undefined;
        if ((c?.id ?? '') === i.acordoId && (c ? i.acordoModo === 'auto' : i.acordoModo === '')) return i;
        mudou = true;
        return c ? { ...i, acordoId: c.id, acordoPreco: c.preco, acordoTexto: rotuloCondicao(c), acordoModo: 'auto' as const } : { ...i, acordoId: '', acordoPreco: null, acordoTexto: '', acordoModo: '' as const };
      });
      return mudou ? nova : lista;
    });
    // chaveSugestao resume o que importa dos itens sem refazer a cada tecla em valores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaCondicoes, form.modelo, chaveSugestao, setItens]);
  const escolherFornecedor = (id: string) => {
    const f = fornecedores?.find(x => x.id === id);
    setForm(x => ({ ...x, fornecedorId: id, fornecedorNome: f?.nome ?? '' }));
    setItens(lista => lista.map(i => ({ ...i, acordoId: '', acordoPreco: null, acordoTexto: '', acordoModo: '' as const })));
  };
  const escolherCondicao = (chave: number, id: string) => {
    const c = listaCondicoes.find(x => x.id === id);
    mudarItem(chave, c ? { acordoId: c.id, acordoPreco: c.preco, acordoTexto: rotuloCondicao(c), acordoModo: 'manual' } : { acordoId: '', acordoPreco: null, acordoTexto: '', acordoModo: 'manual' });
  };
  const acimaDoAcordo = (i: ItemForm) => (form.fornecedorNome && i.acordoPreco !== null && num(i.valorUnit) > 0 ? Math.round((num(i.valorUnit) - i.acordoPreco) * 100) / 100 : null);
  const totalAcima = itens.reduce((s, i) => { const d = acimaDoAcordo(i); return d !== null && d > 0 ? s + d * num(i.qtd) : s; }, 0);
  const conferidos = itens.some(i => acimaDoAcordo(i) !== null);
  const [hoje] = useState(() => new Date().toLocaleDateString('pt-BR'));
  const [hojeIso] = useState(() => new Date().toLocaleDateString('sv-SE'));

  // Abrir a calculadora ja prepara a sessao com o Qlik para a primeira placa.
  useEffect(() => { void api('/api/reembolso/historico/aquecer').catch(() => undefined); }, []);
  // Historico de OS da placa, consultado no Qlik (ou no cache do Portal) com
  // pausa curta enquanto a placa e digitada. "Atualizar" forca nova consulta.
  const placa = placaNormalizada(form.placa);
  const [historico, setHistorico] = useState<Historico | null>(null), [forcar, setForcar] = useState(0);
  useEffect(() => {
    if (placa.length < 7) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      setHistorico({ placa, carregando: true, linhas: [] });
      void api(`/api/reembolso/historico?${new URLSearchParams({ placa, ...(forcar ? { atualizar: '1' } : {}) })}`, { signal: controller.signal })
        .then((r: AnyRow) => { if (!controller.signal.aborted) setHistorico({ placa, consultadoEm: r.consultadoEm, aviso: r.aviso, filtradas: r.filtradas, veiculo: r.veiculo, linhas: r.linhas }); })
        .catch(f => { if (!controller.signal.aborted) setHistorico({ placa, erro: errorText(f), linhas: [] }); });
    }, forcar || PLACA_COMPLETA.test(placa) ? 0 : 400);
    return () => { clearTimeout(t); controller.abort(); };
  }, [placa, forcar]);
  const linhasPlaca = useMemo(() => (historico?.placa === placa ? historico.linhas : []), [historico, placa]);
  // Cliente (com a taxa da configuracao) e modelo vem da OS mais recente da
  // placa, so onde estiver vazio ou ja tiver vindo do Qlik.
  const veiculo = historico?.placa === placa && !historico.carregando ? historico.veiculo : undefined;
  const clienteQlik = veiculo?.clienteId ? config.clientes.find(c => c.id === veiculo.clienteId && c.ativo) : undefined;
  const modeloQlik = veiculo?.modelo?.slice(0, 80) ?? '';
  const trocaCliente = !!clienteQlik && clienteQlik.id !== form.clienteId && (!form.clienteId || form.clienteOrigem === 'qlik');
  const trocaModelo = !!modeloQlik && modeloQlik !== form.modelo && (!form.modelo || form.modeloOrigem === 'qlik');
  useEffect(() => {
    if (!trocaCliente && !trocaModelo) return;
    setForm(f => ({
      ...f,
      ...(trocaCliente && clienteQlik ? { clienteId: clienteQlik.id, clienteNome: clienteQlik.nome, taxaPct: taxaTexto(clienteQlik.taxa), clienteOrigem: 'qlik' as const } : {}),
      ...(trocaModelo ? { modelo: modeloQlik, modeloOrigem: 'qlik' as const } : {}),
    }));
    if (trocaCliente && clienteQlik) reaplicar(clienteQlik.id, form.categoria);
  });
  const osAtual = form.osAtual;
  const contexto = { kmAtual, osAtual, hoje: hojeIso };
  const chaveAuto = itens.map(i => `${i.chave}:${i.utModo}:${i.ultimaTroca === '' ? 0 : 1}:${termosDoItem(i)}`).join('|');
  // Ultima troca automatica: so em item vazio ou ja automatico; nunca sobre o
  // que foi digitado, escolhido ou salvo. Sem KM atual a formula passaria do
  // custo da peca, entao so preenche depois do KM atual informado.
  useEffect(() => {
    const ctx = { kmAtual, osAtual, hoje: hojeIso };
    setItens(lista => {
      let mudou = false;
      const nova = lista.map(i => {
        if (!(i.utModo === 'auto' || (i.utModo === '' && i.ultimaTroca === ''))) return i;
        const melhor = ctx.kmAtual > 0 ? candidatos(linhasPlaca, termosDoItem(i), ctx).find(c => c.serve) : undefined;
        const alvo = melhor?.km ? { ultimaTroca: String(melhor.km), utModo: 'auto' as const, utRotulo: rotuloOs(melhor) } : { ultimaTroca: '', utModo: '' as const, utRotulo: '' };
        if (alvo.ultimaTroca === i.ultimaTroca && alvo.utModo === i.utModo && alvo.utRotulo === i.utRotulo) return i;
        mudou = true;
        return { ...i, ...alvo };
      });
      return mudou ? nova : lista;
    });
  }, [linhasPlaca, kmAtual, osAtual, hojeIso, chaveAuto, setItens]);
  const resumo = useMemo(() => resumoPlaca(linhasPlaca), [linhasPlaca]);
  const statusHistorico = (() => {
    if (placa.length < 7) return 'Informe a placa para buscar a última troca de cada item no histórico de OS.';
    if (!historico || historico.placa !== placa || historico.carregando) return 'Consultando o histórico de OS no Qlik… (alguns segundos)';
    if (historico.erro) return historico.erro;
    const quando = `consulta de ${dataHoraSolicitacao(historico.consultadoEm ?? '')}${historico.filtradas ? ` · ${inteiro.format(historico.filtradas)} itens fora pelos filtros` : ''}`;
    const aviso = historico.aviso ? `${historico.aviso} ` : '';
    if (!resumo) return `${aviso}Placa ${placa} sem OS no Qlik (${quando}). Confira a digitação.`;
    const doQlik = veiculo?.cliente ? `Qlik: ${veiculo.cliente}${veiculo.clienteId ? '' : ' (não está na configuração do Reembolso: escolha o cliente à mão)'}${veiculo.modelo ? ` · ${veiculo.modelo}` : ''} · `: '';
    return `${aviso}${doQlik}Histórico: ${resumo.os} OS de ${dataBr(resumo.primeira)} a ${dataBr(resumo.ultima)}${resumo.ultimoKm ? ` · último KM registrado ${inteiro.format(resumo.ultimoKm)} em ${dataBr(resumo.dataUltimoKm)}` : ''} (${quando}).`;
  })();

  return <div className="patio-page space-y-4">
    <div className="no-print space-y-4">
      <LinhaDeAba actions={<>
        <Button variant="outline" disabled={busy} onClick={limpar}><X /> Limpar</Button>
        <Button variant="outline" onClick={() => window.print()}><Printer /> Imprimir / PDF</Button>
        <Button variant="create" disabled={!podeSalvar} onClick={() => void salvar()}><Save /> Salvar cálculo</Button>
      </>} />
      {vazio && <p className="text-sm text-muted-foreground">Ainda não há clientes nem tabelas MTBF. Suprimentos importa a calculadora antiga em Reembolso › Configuração.</p>}
      <Card><CardContent className="reembolso-cabecalho">
        <Field label="Placa"><Input value={form.placa} maxLength={10} placeholder="digite a placa: cliente, modelo e taxa vêm do Qlik"
          onChange={e => mudar('placa', e.target.value.toUpperCase())} /></Field>
        <Field label="KM atual do veículo"><Input type="number" min="0" step="1" value={form.kmAtual} onChange={e => mudar('kmAtual', e.target.value)} /></Field>
        <Field label="OS atual (opcional)"><Input value={form.osAtual} maxLength={30} inputMode="numeric" onChange={e => mudar('osAtual', e.target.value)} /></Field>
        <Field label="Modelo"><Input value={form.modelo} maxLength={80} onChange={e => setForm(f => ({ ...f, modelo: e.target.value, modeloOrigem: e.target.value ? 'manual' : '' }))} placeholder="ex. STRADA" /></Field>
        <div className="reembolso-cliente">
          <SearchSelect label="Cliente" value={form.clienteId} limit={80} options={config.clientes.filter(c => c.ativo).map(c => ({ id: c.id, name: c.nome }))} onChange={escolherCliente} />
        </div>
        <Field label="Taxa administrativa (%)"><Input type="number" step="0.01" min="0" max="100" value={form.taxaPct} onChange={e => mudar('taxaPct', e.target.value)} /></Field>
        <Field label="Categoria">
          <NativeSelect value={form.categoria} onChange={e => { mudar('categoria', e.target.value); reaplicar(form.clienteId, e.target.value); }}>
            {CATEGORIAS.map(([id, nome]) => <NativeSelectOption key={id} value={id}>{nome}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <div className="reembolso-fornecedor">
          <SearchSelect label="Fornecedor (conferir com o acordo)" value={form.fornecedorId} limit={80} onChange={escolherFornecedor}
            options={(fornecedores ?? []).map(f => ({ id: f.id, name: `${f.nome} · ${String(f.cnpj ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}` }))} />
        </div>
        <p className="reembolso-info text-xs text-muted-foreground">
          {`MTBF: ${tabela ? tabela.nome : '—'}${cliente?.executivo ? ` · Comercial: ${cliente.executivo}` : ''}${cliente?.observacao ? ` · ${cliente.observacao}` : ''}`}
          {cliente && cliente.taxa === null ? ' · cliente sem taxa cadastrada: preencha à mão' : ''}
          {form.fornecedorId && condicoes?.id === form.fornecedorId && (condicoes.erro ? ` · acordo do fornecedor indisponível: ${condicoes.erro}`
            : ` · ${condicoes.lista.length} condição(ões) no acordo do fornecedor${condicoes.lista.length >= 5000 ? ' (mostrando as 5.000 primeiras)' : ''}`)}
          {!form.fornecedorId && form.fornecedorNome && fornecedores && !fornecedorSalvo ? ` · fornecedor do cálculo salvo sem acordo vigente: ${form.fornecedorNome}` : ''}
        </p>
        <p className="reembolso-info reembolso-historico-status text-xs">{statusHistorico}
          {historico?.placa === placa && !historico.carregando && <> <button type="button" className="text-link hover:underline" onClick={() => setForcar(v => v + 1)}>Consultar o Qlik de novo</button></>}</p>
      </CardContent></Card>

      <div className="space-y-3">{itens.map((i, n) => {
        const r = resultados[n];
        return <Card key={i.chave}><CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <span className="patio-codigo pb-2">{n + 1}</span>
            <Field label="Peça / M.O." className="flex-1"><Input value={i.peca} maxLength={200} placeholder="ex. Pneu 205/60 R16" onChange={e => mudarItem(i.chave, { peca: e.target.value })} /></Field>
            {/* Mais de 100 referencias: campo com busca em vez de lista longa. */}
            <div className="min-w-0 flex-[1.4]">
              <SearchSelect label="Referência MTBF" value={i.referencia} options={opcoesMtbf}
                onChange={valor => setItens(lista => lista.map(x => (x.chave === i.chave ? aplicarReferencia(x, tabela?.itens.find(r => r.descricao === valor), form.categoria) : x)))} />
            </div>
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
            <Field label="Última troca (km)"><Input type="number" min="0" value={i.ultimaTroca} title={origemTexto(i)} onChange={e => mudarItem(i.chave, { ultimaTroca: e.target.value, utModo: e.target.value === '' ? '' : 'manual', utRotulo: '' })} /></Field>
            <Field label="Qtd"><Input type="number" min="0" value={i.qtd} onChange={e => mudarItem(i.chave, { qtd: e.target.value })} /></Field>
            <Field label="Valor unit. (R$)"><Input type="number" min="0" step="0.01" value={i.valorUnit} onChange={e => mudarItem(i.chave, { valorUnit: e.target.value })} /></Field>
            <Field label="Dif. pneu MT/AT (R$)"><Input type="number" step="0.01" value={i.diferencaPneu} title="Só para pneus; demais itens, 0" onChange={e => mudarItem(i.chave, { diferencaPneu: e.target.value })} /></Field>
            <div className="reembolso-resultado"><span>KM restante</span><b>{num(i.kmTroca) > 0 ? inteiro.format(Math.round(r.kmRestante)) : '—'}</b></div>
            <div className="reembolso-resultado"><span>Valor total</span><b>{moeda.format(r.valorTotal)}</b></div>
            <div className="reembolso-resultado destaque"><span>Reembolso</span><b>{moeda.format(r.reembolso)}</b></div>
          </div>
          {form.fornecedorId && <div className="reembolso-acordo">
            <SearchSelect label="Condição do acordo" value={i.acordoId} options={[...listaCondicoes].sort((a, b) => Number(condizCom(b, i, form.modelo)) - Number(condizCom(a, i, form.modelo)))
              .map(c => ({ id: c.id, name: rotuloCondicao(c) }))} onChange={id => escolherCondicao(i.chave, id)} />
            <ConferenciaAcordo item={i} acima={acimaDoAcordo(i)} />
          </div>}
          {!form.fornecedorId && i.acordoModo === 'salvo' && <ConferenciaAcordo item={i} acima={acimaDoAcordo(i)} />}
          {i.dica && <p className="text-xs text-muted-foreground">{i.dica}</p>}
          <HistoricoItem item={i} linhas={linhasPlaca} disponivel={historico?.placa === placa && !historico.carregando && !historico.erro && !!resumo} contexto={contexto}
            origem={origemTexto(i)} mudar={dados => mudarItem(i.chave, dados)} />
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

      <div className={`grid gap-3 ${conferidos ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Card><CardContent><p className="text-xs font-medium text-muted-foreground">Custo total da manutenção</p><p className="text-2xl font-semibold tabular-nums">{moeda.format(totalCusto)}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs font-medium text-muted-foreground">Total do reembolso ao cliente</p><p className="text-2xl font-semibold tabular-nums">{moeda.format(totalReembolso)}</p></CardContent></Card>
        {conferidos && <Card><CardContent><p className="text-xs font-medium text-muted-foreground">Acima do acordado (valor unit. × qtd)</p>
          <p className={`text-2xl font-semibold tabular-nums ${totalAcima > 0 ? 'text-destructive' : ''}`}>{moeda.format(totalAcima)}</p></CardContent></Card>}
      </div>
      <Field label="Observações"><Textarea value={form.observacao} maxLength={2000} onChange={e => mudar('observacao', e.target.value)} placeholder="Observação relevante sobre esta manutenção" /></Field>
      <p className="text-xs text-muted-foreground">
        KM restante = KM de troca − (KM atual − última troca) · proporcional = valor total ÷ KM de troca × KM restante · reembolso = (base + diferença de pneu) × (1 + taxa); negativo vira zero.
      </p>
    </div>

    <section className="so-impressao reembolso-papel">
      <header className="rp-topo">
        <div>
          <h1>Cálculo de manutenção reembolsável — Leves</h1>
          <p>Reembolso proporcional / integral de peças por MTBF · Hatch/Sedan · Pick-up leve · SUV · Pick-up 4x4 · Van</p>
        </div>
        <div className="rp-marca">
          {/* oxlint-disable-next-line next/no-img-element -- logo privado servido pelo proprio Portal */}
          <img src="/api/marca/logo" alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
          <span>Data do cálculo</span><b>{hoje}</b>
        </div>
      </header>

      <h2><span>01</span>Dados do cliente e veículo</h2>
      <div className="rp-caixa rp-dados">
        <Campo rotulo="Cliente" valor={form.clienteNome} />
        <Campo rotulo="Taxa administrativa" valor={fracao.format(taxa)} dica={`em fração, ex. 0,25 = 25% · aqui ${pct(taxa)}`} />
        <Campo rotulo="Categoria" valor={ROTULO_CAT[form.categoria]} />
        <Campo rotulo="Modelo" valor={form.modelo} />
        <Campo rotulo="Placa" valor={form.placa} />
        <Campo rotulo="KM atual do veículo" valor={kmAtual ? inteiro.format(kmAtual) : ''} />
        <Campo rotulo="MTBF vinculada" valor={tabela?.nome ?? ''} dica={cliente && !cliente.tabelaId ? 'cliente sem tabela própria — usando a MTBF padrão' : undefined} />
        <Campo rotulo="OS atual" valor={form.osAtual} />
        <Campo rotulo="Observações" largo valor={[cliente?.observacao, cliente?.executivo ? `Comercial: ${cliente.executivo}` : null].filter(Boolean).join(' · ')} />
      </div>

      <h2><span>02</span>Itens de manutenção</h2>
      <table className="rp-tabela">
        <thead><tr><th>#</th><th>Peça / M.O.</th><th>Referência MTBF</th><th>Tipo</th><th>KM de troca</th><th>Última troca</th><th>KM restante</th><th>Qtd</th>
          <th>Val. unit.</th><th>Val. total</th><th>Diferença pneu MT/AT</th><th>Avaria s/ T.A.</th><th>Total da taxa</th><th>Total reembolso</th></tr></thead>
        <tbody>{itens.map((i, n) => {
          const r = resultados[n], kmTroca = num(i.kmTroca);
          return <tr key={i.chave}>
            <td>{n + 1}</td><td>{i.peca || '—'}</td>
            <td className="rp-ref">{i.referencia ? `${i.referencia} — ${kmTroca > 0 ? `${inteiro.format(kmTroca)} km` : 'sem MTBF em km'} · ${ROTULO_TIPO[i.tipo]}` : '—'}</td>
            <td>{ROTULO_TIPO[i.tipo]}</td>
            <td className="rp-num">{kmTroca > 0 ? `${inteiro.format(kmTroca)} km` : '—'}</td>
            <td className="rp-num">{num(i.ultimaTroca) > 0 ? <>{inteiro.format(num(i.ultimaTroca))}{i.utRotulo && <small>{i.utRotulo}</small>}</> : '—'}</td>
            <td className="rp-num">{kmTroca > 0 ? inteiro.format(Math.round(r.kmRestante)) : '—'}</td>
            <td className="rp-num">{inteiro.format(num(i.qtd))}</td>
            <td className="rp-num">{decimal.format(num(i.valorUnit))}</td>
            <td className="rp-num">{moeda.format(r.valorTotal)}</td>
            <td className="rp-num">{moeda.format(num(i.diferencaPneu))}</td>
            <td className="rp-num">{moeda.format(r.avaria)}</td>
            <td className="rp-num">{moeda.format(r.valorTaxa)}</td>
            <td className="rp-num"><b>{moeda.format(r.reembolso)}</b></td>
          </tr>;
        })}</tbody>
      </table>

      <h2><span>03</span>Resumo</h2>
      <div className="rp-resumo">
        <div className="rp-caixa"><span>Custo total da manutenção</span><b>{moeda.format(totalCusto)}</b></div>
        <div className="rp-caixa rp-destaque"><span>Total do reembolso ao cliente</span><b>{moeda.format(totalReembolso)}</b></div>
      </div>

      <h2><span>04</span>Observações</h2>
      <div className="rp-caixa rp-texto">{form.observacao || <i>— sem observações —</i>}</div>

      <h2><span>05</span>Evidências da avaria</h2>
      <div className="rp-caixa">{itens.some(i => i.fotos.some(f => !f.video))
        ? <div className="rp-fotos">{itens.flatMap((i, n) => i.fotos.filter(f => !f.video).map(f => <figure key={f.url}>
          {/* oxlint-disable-next-line next/no-img-element -- foto local (blob:) so para impressao */}
          <img src={f.url} alt={f.nome} /><figcaption>{`Item ${n + 1} · ${i.peca || i.referencia || 'sem descrição'}`}</figcaption></figure>))}</div>
        : <i>— sem fotos anexadas —</i>}</div>
    </section>
  </div>;
}

// Conferencia interna: nao aparece na impressao, que vai para o cliente.
function ConferenciaAcordo({ item, acima }: { item: ItemForm; acima: number | null }) {
  if (item.acordoPreco === null) return <p className="text-xs text-muted-foreground">Sem condição do acordo escolhida para esta peça.</p>;
  const preco = moeda.format(item.acordoPreco), base = item.acordoModo === 'auto' ? 'sugerida pela peça e pelo modelo' : item.acordoModo === 'salvo' ? `salva: ${item.acordoTexto}` : '';
  if (acima === null) return <p className="text-xs text-muted-foreground">Acordado: {preco} por unidade{base ? ` (${base})` : ''}. Informe o valor unitário para conferir.</p>;
  if (acima > 0) return <p className="text-xs font-medium text-destructive">{`${moeda.format(acima)} por unidade acima do acordado (${preco}${item.acordoPreco > 0 ? `; +${inteiro.format(Math.round(acima / item.acordoPreco * 1000) / 10)}%` : ''})`}{base ? ` · ${base}` : ''}</p>;
  return <p className="text-xs text-muted-foreground">{`Dentro do acordado (${preco} por unidade)`}{base ? ` · ${base}` : ''}</p>;
}

function Campo({ rotulo, valor, dica, largo }: { rotulo: string; valor: string | null | undefined; dica?: string; largo?: boolean }) {
  return <div className={largo ? 'rp-campo rp-largo' : 'rp-campo'}><span>{rotulo}</span><b>{valor || '—'}</b>{dica && <small>{dica}</small>}</div>;
}

// Busca da ultima troca de um item no historico da placa: termos editaveis e
// as OS encontradas; clicar numa OS usa o KM dela.
function HistoricoItem({ item, linhas, disponivel, contexto, origem, mudar }: {
  item: ItemForm; linhas: LinhaPlaca[]; disponivel: boolean; contexto: { kmAtual: number; osAtual: string; hoje: string }; origem: string;
  mudar: (dados: Partial<ItemForm>) => void;
}) {
  const termos = termosDoItem(item);
  const lista = useMemo(() => (disponivel ? candidatos(linhas, termos, contexto) : []), [disponivel, linhas, termos, contexto]);
  if (!disponivel) return null;
  const motivo = (c: Candidato) => (c.atual ? 'é a OS atual' : c.acimaDoKm ? 'KM igual ou acima do KM atual' : c.recente ? 'OS dos últimos 30 dias: informe a OS atual para liberar' : !c.km ? 'OS sem KM' : '');
  const aviso = !termos ? 'selecione a Referência MTBF ou digite termos de busca'
    : !lista.length ? 'nenhuma troca encontrada nesta placa; ajuste os termos ou preencha à mão'
    : !(contexto.kmAtual > 0) ? `${lista.length} OS encontrada(s) — informe o KM atual para preencher a última troca`
    : `${lista.length} OS encontrada(s)${lista.some(c => c.serve) ? '' : ' — nenhuma serve automaticamente, confira abaixo'}`;
  return <div className="reembolso-historico space-y-2">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium">Última troca no histórico</span>
      <Input aria-label="Termos de busca no histórico" className="h-8 max-w-md flex-1 text-xs" value={termos} maxLength={300}
        title='palavras = todas precisam aparecer; "|" = alternativa; "-palavra" = excluir'
        onChange={e => mudar({ termos: e.target.value, termosEditados: true })} />
      {item.termosEditados && <Button variant="ghost" size="sm" onClick={() => mudar({ termos: '', termosEditados: false })}>Termos padrão</Button>}
      {item.utModo !== 'auto' && item.utModo !== '' && <Button variant="ghost" size="sm" onClick={() => mudar({ ultimaTroca: '', utModo: '', utRotulo: '' })}>Usar automático</Button>}
      <span className="text-muted-foreground">{origem ? `${origem} · ` : ''}{aviso}</span>
    </div>
    {lista.length > 0 && <div className="flex flex-wrap gap-1.5">{lista.slice(0, 8).map(c => {
      const escolhida = !!c.km && String(c.km) === item.ultimaTroca;
      return <button type="button" key={`${c.os}-${c.data}`} title={[c.produtos.join(' · '), c.fornecedor, motivo(c)].filter(Boolean).join('\n')}
        className={`reembolso-os ${escolhida ? 'escolhida' : ''} ${c.serve ? '' : 'nao-serve'}`}
        onClick={() => c.km && mudar({ ultimaTroca: String(c.km), utModo: 'escolhido', utRotulo: rotuloOs(c) })}>
        <b>{rotuloOs(c)}</b> · {c.km ? `${inteiro.format(c.km)} km` : 'sem KM'} · {c.produtos[0]}{c.produtos.length > 1 ? ` +${c.produtos.length - 1}` : ''}
      </button>;
    })}</div>}
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

// O que nao entra no historico de OS. A calculadora consulta o Qlik por
// placa; os filtros valem na resposta, inclusive para consultas em cache.
function FiltrosHistorico({ busy, run }: { busy: boolean; run: Executar }) {
  const [dados, setDados] = useState<AnyRow | null>(null), [erro, setErro] = useState(''), [versao, setVersao] = useState(0);
  const [coluna, setColuna] = useState('grupo'), [modo, setModo] = useState<'igual' | 'contem'>('igual'), [valor, setValor] = useState('');
  const [sugestoes, setSugestoes] = useState<{ valor: string; n: number }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void api('/api/reembolso/historico/filtros', { signal: controller.signal }).then((r: AnyRow) => { if (!controller.signal.aborted) { setDados(r); setErro(''); } })
      .catch(f => { if (!controller.signal.aborted) setErro(errorText(f)); });
    return () => controller.abort();
  }, [versao]);
  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => {
      void api(`/api/reembolso/historico/valores?${new URLSearchParams({ coluna, q: valor.trim() })}`, { signal: controller.signal })
        .then((r: AnyRow) => { if (!controller.signal.aborted) setSugestoes(r.valores); }).catch(() => undefined);
    }, 300);
    return () => { clearTimeout(t); controller.abort(); };
  }, [coluna, valor, versao]);
  const criar = () => void run(async () => {
    await api('/api/reembolso/historico/filtros', json('POST', { coluna, modo, valor }));
    setValor(''); setVersao(v => v + 1);
  }, 'Filtro incluído; vale a partir da próxima busca na calculadora.');
  const remover = (f: AnyRow) => {
    if (!confirm('Remover este filtro? Os itens voltam a aparecer na calculadora.')) return;
    void run(async () => { await api(`/api/reembolso/historico/filtros/${encodeURIComponent(f.id)}`, { method: 'DELETE' }); setVersao(v => v + 1); }, 'Filtro removido.');
  };
  if (erro && !dados) return <FalhaDeCarregamento erro={erro} tentar={() => setVersao(v => v + 1)} />;
  if (!dados) return <Loading label="Carregando filtros…" compact />;
  const colunas = dados.colunas as Record<string, string>;
  return <div className="patio-page space-y-4">
    <LinhaDeAba actions={<Button variant="outline" size="icon" aria-label="Atualizar" title="Atualizar" onClick={() => setVersao(v => v + 1)}><RefreshCw /></Button>} />
    <p className="text-sm text-muted-foreground">A calculadora consulta o Qlik na hora, pela placa, e guarda cada consulta por 6 horas. Os filtros tiram itens da resposta, inclusive das consultas já guardadas.</p>
    <Card><CardContent className="space-y-3">
      <p className="font-medium">Novo filtro: o que não entra no histórico</p>
      <div className="reembolso-filtro-novo">
        <Field label="Coluna"><NativeSelect value={coluna} onChange={e => { setColuna(e.target.value); setValor(''); }}>
          {Object.entries(colunas).map(([id, nome]) => <NativeSelectOption key={id} value={id}>{nome}</NativeSelectOption>)}
        </NativeSelect></Field>
        <Field label="Condição"><NativeSelect value={modo} onChange={e => setModo(e.target.value as 'igual' | 'contem')}>
          <NativeSelectOption value="igual">é igual a</NativeSelectOption><NativeSelectOption value="contem">contém</NativeSelectOption>
        </NativeSelect></Field>
        <Field label="Valor"><Input list="reembolso-filtro-sugestoes" value={valor} maxLength={200} placeholder="digite ou escolha um valor visto nas consultas" onChange={e => setValor(e.target.value)} />
          <datalist id="reembolso-filtro-sugestoes">{sugestoes.map(v => <option key={v.valor} value={v.valor}>{`${inteiro.format(v.n)} itens nas consultas recentes`}</option>)}</datalist></Field>
        <Button variant="create" disabled={busy || !valor.trim()} onClick={criar}><Plus /> Incluir filtro</Button>
      </div>
      <p className="text-xs text-muted-foreground">Sem diferença de acento ou maiúsculas. &quot;É igual a&quot; compara o valor inteiro; &quot;contém&quot;, um trecho (ao menos 3 letras).</p>
    </CardContent></Card>
    <TabelaPadrao contador={`${inteiro.format(dados.filtros.length)} ${dados.filtros.length === 1 ? 'filtro' : 'filtros'}`}
      vazio={!dados.filtros.length ? <p className="p-6 text-center text-muted-foreground">Nenhum filtro: tudo o que vem do Qlik aparece na calculadora.</p> : undefined}>
      <TableHeader><TableRow><TableHead style={{ width: 200 }}>Coluna</TableHead><TableHead style={{ width: 110 }}>Condição</TableHead><TableHead>Valor</TableHead>
        <TableHead style={{ width: 190 }}>Incluído em</TableHead><TableHead style={{ width: 60 }}><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
      <TableBody>{(dados.filtros as AnyRow[]).map(f => <TableRow key={f.id}>
        <TableCell>{colunas[f.coluna] ?? f.coluna}</TableCell><TableCell>{f.modo === 'igual' ? 'é igual a' : 'contém'}</TableCell><TableCell className="font-medium">{f.valor}</TableCell>
        <TableCell className="text-xs"><div>{dataHoraSolicitacao(f.criadoEm)}</div><div className="text-muted-foreground">{f.autor ?? '—'}</div></TableCell>
        <TableCell><div className="flex justify-end"><Button variant="ghost" size="icon" disabled={busy} aria-label={`Remover filtro ${f.valor}`} title="Remover filtro" onClick={() => remover(f)}><Trash2 /></Button></div></TableCell>
      </TableRow>)}</TableBody>
    </TabelaPadrao>
    <TabelaPadrao contador="Consultas recentes ao Qlik"
      vazio={!dados.recentes.length ? <p className="p-6 text-center text-muted-foreground">Nenhuma consulta nos últimos 7 dias.</p> : undefined}>
      <TableHeader><TableRow><TableHead style={{ width: 120 }}>Placa</TableHead><TableHead className="patio-num text-right" style={{ width: 120 }}>Itens de OS</TableHead><TableHead>Consultada em</TableHead></TableRow></TableHeader>
      <TableBody>{(dados.recentes as AnyRow[]).map(r => <TableRow key={r.placa}>
        <TableCell className="patio-num font-medium">{r.placa}</TableCell><TableCell className="patio-num text-right tabular-nums">{inteiro.format(r.itens)}</TableCell>
        <TableCell className="text-xs">{`${dataHoraSolicitacao(r.consultadoEm)} · ${r.autor ?? '—'}`}</TableCell>
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
