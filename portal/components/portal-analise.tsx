'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Loader2, RefreshCw } from 'lucide-react';
import { CampoData } from './campo-data';
import { LinhaDeAba } from './page-header';
import { ProximaAcao } from './portal-analise-acoes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { dataHoraSolicitacao } from '@/lib/solicitacoes-cliente';
import { type AnyRow, Field, Loading, FalhaDeCarregamento } from './portal-presentation';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const moedaCentavos = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const rs = (v: unknown) => moeda.format(Number(v || 0));
const rsc = (v: unknown) => (v === null || v === undefined ? '—' : moedaCentavos.format(Number(v)));
const mesLabel = (m: string) => { const [a, mm] = m.split('-'); return `${mm}/${a}`; };
const dataBr = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '—');
const razao = (a: unknown, b: unknown) => (Number(b) ? Number(a || 0) / Number(b) : null);
const variacao = (atual: number, anterior: number) => (anterior ? `${atual >= anterior ? '+' : ''}${pct(atual / anterior - 1)}` : null);

type Filtros = { de: string; ate: string; cidade: string; fornecedor: string; grupo: string };
const VAZIO: Filtros = { de: '', ate: '', cidade: '', fornecedor: '', grupo: '' };
const LINHAS_VISIVEIS = 20;

// Indicador em destaque: numero grande, rotulo curto e uma linha de contexto.
function Indicador({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
        <p className="text-2xl font-semibold tabular-nums">{valor}</p>
        {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      </CardContent>
    </Card>
  );
}

// Barra de proporcao de uma serie so (magnitude), sem legenda.
function Barra({ valor, maximo, titulo }: { valor: number; maximo: number; titulo: string }) {
  const largura = maximo > 0 ? Math.max(2, (valor / maximo) * 100) : 0;
  return <div className="h-2 w-full rounded-full bg-muted" title={titulo}><div className="h-2 rounded-full bg-primary" style={{ width: `${largura}%` }} /></div>;
}

function Bloco({ titulo, children, vazio, rodape, acoes }: { titulo: string; children: ReactNode; vazio?: boolean; rodape?: ReactNode; acoes?: ReactNode }) {
  return (
    <Card className="min-w-0 patio-table-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b"><p className="patio-result-count">{titulo}</p>{acoes}</CardHeader>
      <CardContent className="min-w-0 px-0 pb-0">
        {vazio ? <p className="p-4 text-sm text-muted-foreground">Sem dados no período.</p> : <Table>{children}</Table>}
        {rodape && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{rodape}</p>}
      </CardContent>
    </Card>
  );
}

// Nome de fornecedor que abre o painel dele.
function NomeFornecedor({ nome, abrir }: { nome: string; abrir: (nome: string) => void }) {
  return <button type="button" className="max-w-full truncate text-left text-link hover:underline" title={`Ver o painel de ${nome}`} onClick={() => abrir(nome)}>{nome}</button>;
}

// Nome com a barra de proporcao logo abaixo: dispensa a coluna so da barra.
function ComBarra({ children, valor, maximo, titulo }: { children: ReactNode; valor: number; maximo: number; titulo: string }) {
  return <div className="min-w-0 space-y-1"><div className="truncate">{children}</div><Barra valor={valor} maximo={maximo} titulo={titulo} /></div>;
}

const MOTIVOS: Record<string, string> = {
  Fornecedor: 'O fornecedor não tem acordo.',
  Item: 'O fornecedor tem acordo, mas sem este item. Vale incluir se o gasto for relevante.',
  Modelo: 'O fornecedor tem acordo, mas sem este modelo. Vale incluir se o gasto for relevante.',
  Cidade: 'O fornecedor tem acordo, mas não nesta cidade.',
  Sinonimo: 'O termo da compra não casa com o De/Para: atualizar o De/Para ou excluir o termo dos filtros.',
};

function MostrarTodos({ total, todos, alternar }: { total: number; todos: boolean; alternar: () => void }) {
  if (total <= LINHAS_VISIVEIS) return null;
  return <Button size="sm" variant="ghost" onClick={alternar}>{todos ? `Mostrar ${LINHAS_VISIVEIS}` : `Mostrar todos (${inteiro.format(total)})`}</Button>;
}

// Painel de um fornecedor. `consulta` traz periodo, cidade e grupo do Painel.
export function DetalheFornecedor({ nome, consulta = '', fechar }: { nome: string | null; consulta?: string; fechar: () => void }) {
  const [dados, setDados] = useState<AnyRow | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    if (!nome) return;
    const controller = new AbortController();
    const params = new URLSearchParams(consulta);
    params.delete('fornecedor');
    params.set('nome', nome);
    void api(`/api/analise/fornecedor?${params}`, { signal: controller.signal })
      .then((r: AnyRow) => { if (!controller.signal.aborted) { setDados(r); setErro(''); } })
      .catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    return () => controller.abort();
  }, [nome, consulta]);
  if (!nome) return null;
  const ind = dados?.fornecedor === nome ? dados.indicadores : null;
  return (
    <Dialog open onOpenChange={aberto => !aberto && fechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{nome}</DialogTitle>
          {ind && <p className="text-xs text-muted-foreground">{dataBr(dados!.filtros.de)} a {dataBr(dados!.filtros.ate)}{dados!.cnpj ? ` · CNPJ ${dados!.cnpj}` : ''}</p>}
        </DialogHeader>
        {erro && <p role="alert" className="text-sm">{erro}</p>}
        {!ind ? !erro && <Loading label="Carregando fornecedor…" compact /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Indicador titulo="Gasto" valor={rs(ind.gasto)} detalhe={`${inteiro.format(ind.linhas)} linhas`} />
              <Indicador titulo="Comprado com acordo" valor={pct(ind.utilizacao)} detalhe={rs(ind.comAcordo)} />
              <Indicador titulo="Conformidade (R$)" valor={pct(ind.conformidadeRs)} />
              <Indicador titulo="Pago acima do acordo" valor={rs(ind.pagoAcima)} detalhe={`${inteiro.format(ind.linhasAcima)} linhas`} />
            </div>
            {dados!.acoes.length > 0 && (
              <Bloco titulo="Sugestões abertas para este fornecedor">
                <TableBody>{dados!.acoes.map((a: AnyRow) => (
                  <TableRow key={a.id}><TableCell><div className="font-medium">{a.titulo}</div><div className="text-xs text-muted-foreground">{a.detalhe}</div></TableCell></TableRow>
                ))}</TableBody>
              </Bloco>
            )}
            <Bloco titulo="Itens (preços pela mediana)" vazio={!dados!.itens.length}>
              <TableHeader><TableRow><TableHead>Item / modelo</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Com acordo</TableHead>
                <TableHead className="text-right">Mediana paga</TableHead><TableHead className="text-right">Mediana do acordo</TableHead><TableHead className="text-right">Pago acima</TableHead><TableHead>Sem acordo</TableHead></TableRow></TableHeader>
              <TableBody>{dados!.itens.map((i: AnyRow) => (
                <TableRow key={`${i.item}-${i.modelo}`}>
                  <TableCell className="min-w-56 whitespace-normal"><div>{i.item}</div><div className="text-xs text-muted-foreground">{i.modelo}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{rs(i.gasto)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(razao(i.comAcordo, i.gasto))}</TableCell>
                  <TableCell className="text-right tabular-nums">{rsc(i.medianaPreco)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rsc(i.medianaAcordo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.pagoAcima ? rs(i.pagoAcima) : '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground" title={i.motivo ? MOTIVOS[i.motivo] : undefined}>
                    {i.semAcordo ? <>{`${inteiro.format(i.semAcordo)} de ${inteiro.format(i.linhas)}`}<div>{i.motivo === 'Sinonimo' ? 'Sinônimo' : i.motivo}</div></> : '—'}
                  </TableCell>
                </TableRow>
              ))}</TableBody>
            </Bloco>
            <div className="grid gap-4 lg:grid-cols-2">
              <Bloco titulo="Cidades" vazio={!dados!.cidades.length}>
                <TableHeader><TableRow><TableHead>Cidade</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Com acordo</TableHead><TableHead className="text-right">Pago acima</TableHead></TableRow></TableHeader>
                <TableBody>{dados!.cidades.map((c: AnyRow) => (
                  <TableRow key={c.cidade}><TableCell>{c.cidade}</TableCell><TableCell className="text-right tabular-nums">{rs(c.gasto)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(razao(c.comAcordo, c.gasto))}</TableCell><TableCell className="text-right tabular-nums">{c.pagoAcima ? rs(c.pagoAcima) : '—'}</TableCell></TableRow>
                ))}</TableBody>
              </Bloco>
              <Bloco titulo="Mês a mês" vazio={!dados!.mensal.length}>
                <TableHeader><TableRow><TableHead>Mês</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Com acordo</TableHead><TableHead className="text-right">Pago acima</TableHead></TableRow></TableHeader>
                <TableBody>{dados!.mensal.map((m: AnyRow) => (
                  <TableRow key={m.mes}><TableCell>{mesLabel(m.mes)}</TableCell><TableCell className="text-right tabular-nums">{rs(m.gasto)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(razao(m.comAcordo, m.gasto))}</TableCell><TableCell className="text-right tabular-nums">{m.pagoAcima ? rs(m.pagoAcima) : '—'}</TableCell></TableRow>
                ))}</TableBody>
              </Bloco>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Termos das compras que nao casam com nenhum item de acordo: um por linha,
// para colar no De/Para ou nos filtros de exclusao.
function Sinonimos({ termos, fechar }: { termos: AnyRow[] | null; fechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  if (!termos) return null;
  const copiar = () => void navigator.clipboard.writeText(termos.map(t => t.termo).join('\n')).then(() => setCopiado(true));
  return (
    <Dialog open onOpenChange={aberto => { if (!aberto) { setCopiado(false); fechar(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Sinônimos sem De/Para ({inteiro.format(termos.length)})</DialogTitle></DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Termos do período filtrado, do maior gasto para o menor.</p>
          <Button size="sm" variant="outline" disabled={!termos.length} onClick={copiar}><Copy /> {copiado ? 'Copiado' : 'Copiar termos'}</Button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Termo</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Linhas</TableHead></TableRow></TableHeader>
          <TableBody>{termos.map(t => (
            <TableRow key={t.termo}><TableCell className="whitespace-normal break-words select-all">{t.termo}</TableCell>
              <TableCell className="text-right tabular-nums">{rs(t.gasto)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(t.linhas)}</TableCell></TableRow>
          ))}</TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

const consultaDe = (f: Filtros) => {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(f)) if (valor) params.set(chave, valor);
  return params.toString();
};

export function Analise({ verAcoes }: { verAcoes: () => void }) {
  // Os campos mudam o rascunho; so "Atualizar" consulta de novo.
  const [rascunho, setRascunho] = useState<Filtros>(VAZIO);
  const [aplicados, setAplicados] = useState<Filtros>(VAZIO);
  const [dados, setDados] = useState<AnyRow | null>(null);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [carregando, setCarregando] = useState(false);
  // Opcoes dos filtros e datas disponiveis: carregam sem consultar periodo.
  const [base, setBase] = useState<AnyRow | null>(null);
  const [fornecedorAberto, setFornecedorAberto] = useState<string | null>(null);
  const [concentracao, setConcentracao] = useState<'fornecedores' | 'itens'>('fornecedores');
  const [todos, setTodos] = useState(false);
  const [verSinonimos, setVerSinonimos] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void api('/api/analise?opcoes=1', { signal: controller.signal })
      .then((resposta: AnyRow) => { if (!controller.signal.aborted) setBase(resposta); })
      .catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    return () => controller.abort();
  }, []);

  // So consulta com De e Ate informados e depois de clicar em Atualizar.
  useEffect(() => {
    if (!aplicados.de || !aplicados.ate) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) setCarregando(true); });
    void api(`/api/analise?${consultaDe(aplicados)}`, { signal: controller.signal }).then((resposta: AnyRow) => {
      if (controller.signal.aborted) return;
      setDados(resposta);
      setErro('');
    }).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [aplicados, tentativa]);

  const consultado = Boolean(aplicados.de && aplicados.ate);
  const completo = Boolean(rascunho.de && rascunho.ate);
  const alterado = (Object.keys(VAZIO) as (keyof Filtros)[]).some(k => (rascunho[k] || '') !== (aplicados[k] || ''));
  const atualizar = () => { if (!completo) return; if (alterado) setAplicados({ ...rascunho }); else setTentativa(t => t + 1); };
  const opcoes: Record<string, string[]> = (dados ?? base)?.opcoes ?? { cidade: [], fornecedor: [], grupo: [] };
  const disponivel = (dados ?? base)?.disponivel;
  const formulario = (
      <form className="patio-filters patio-filters-rotulados" onSubmit={e => { e.preventDefault(); atualizar(); }}>
        <Field label="De"><CampoData value={rascunho.de} onChange={de => setRascunho(r => ({ ...r, de }))} /></Field>
        <Field label="Até"><CampoData value={rascunho.ate} min={rascunho.de || undefined} onChange={ate => setRascunho(r => ({ ...r, ate }))} /></Field>
        {(['cidade', 'fornecedor', 'grupo'] as const).map(campo => (
          <Field key={campo} label={campo === 'grupo' ? 'Grupo de despesa' : campo === 'cidade' ? 'Cidade' : 'Fornecedor'}>
            <NativeSelect value={rascunho[campo]} onChange={e => setRascunho(r => ({ ...r, [campo]: e.target.value }))}>
              <NativeSelectOption value="">Todos</NativeSelectOption>
              {opcoes[campo].map(v => <NativeSelectOption key={v} value={v}>{v}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        ))}
        <Button type="submit" variant={alterado ? 'default' : 'outline'} disabled={carregando || !completo}>
          {carregando ? <Loader2 className="animate-spin" /> : <RefreshCw />} {carregando ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </form>
  );
  const casca = (conteudo: ReactNode) => (
    <div className="patio-page space-y-4">
      <LinhaDeAba />
      <ProximaAcao verTodas={verAcoes} abrirFornecedor={setFornecedorAberto} />
      {formulario}
      {conteudo}
      <DetalheFornecedor nome={fornecedorAberto} fechar={() => setFornecedorAberto(null)} />
    </div>
  );
  if (!consultado) return casca(
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {erro || (!base ? 'Carregando…' : !disponivel?.ate ? 'Ainda não há compras recebidas do Alertas.'
        : `Informe De e Até e clique em Atualizar. Dados disponíveis de ${dataBr(disponivel.de)} a ${dataBr(disponivel.ate)}.`)}
    </p>,
  );
  if (erro && !dados) return casca(<FalhaDeCarregamento erro={erro} tentar={() => setTentativa(t => t + 1)} />);
  if (!dados) return casca(<Loading label="Carregando análise…" compact />);

  const ind = dados.indicadores, ant = dados.anoAnterior;
  const efetivos: Filtros = { ...aplicados, de: dados.filtros.de, ate: dados.filtros.ate };
  const maxMes = Math.max(0, ...dados.mensal.map((m: AnyRow) => Number(m.gasto || 0)));
  const maxAcima = Math.max(0, ...dados.acimaPorFornecedor.map((l: AnyRow) => Number(l.pagoAcima || 0)));
  const maxSem = Math.max(0, ...dados.semAcordoFornecedores.map((l: AnyRow) => Number(l.gasto || 0)));
  const maxItem = Math.max(0, ...dados.semAcordoItens.map((l: AnyRow) => Number(l.gasto || 0)));
  const semDados = !dados.disponivel.ate;
  const temAntesDoCorte = dados.mensal.some((m: AnyRow) => m.antesDoCorte);
  const deFornecedores = concentracao === 'fornecedores';
  const curva = deFornecedores ? dados.abc : dados.abcItens;
  const linhasCurva: AnyRow[] = deFornecedores ? curva.fornecedores : curva.itens;
  const p: AnyRow = dados.pareto[concentracao];
  const visiveis = todos ? linhasCurva : linhasCurva.slice(0, LINHAS_VISIVEIS);
  const nome = deFornecedores ? 'fornecedores' : 'itens';

  return (
    <div className="patio-page space-y-4">
      <LinhaDeAba />
      <ProximaAcao verTodas={verAcoes} abrirFornecedor={setFornecedorAberto} />
      {formulario}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {semDados ? 'Ainda não há compras recebidas do Alertas.' : `${dataBr(dados.filtros.de)} a ${dataBr(dados.filtros.ate)} · ${inteiro.format(ind.linhas)} linhas no filtro`}
        {dados.disponivel.atualizadoEm && ` · dados atualizados em ${dataHoraSolicitacao(dados.disponivel.atualizadoEm)}`}
        {dados.corteVigencia && (
          <span title="Antes do corte, as compras são comparadas com a tabela atual de acordos, não com a que valia na época.">
            {` · corte de vigência em ${dataBr(dados.corteVigencia)}`}
          </span>
        )}
        {alterado && ' · clique em Atualizar para aplicar os filtros'}
        {erro && ` · ${erro}`}
      </p>

      <div className={`space-y-4 transition-opacity ${carregando ? 'pointer-events-none opacity-50' : ''}`} aria-busy={carregando}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador titulo="Gasto no período" valor={rs(ind.gasto)}
            detalhe={ant.gasto ? `${variacao(ind.gasto, ant.gasto)} sobre o mesmo período de ${ant.de.slice(0, 4)}` : undefined} />
          <Indicador titulo="Conformidade (R$)" valor={pct(ind.conformidadeRs)} detalhe={`${pct(ind.conformidadeQtd)} das linhas com acordo`} />
          <Indicador titulo="Utilização dos acordos" valor={pct(ind.utilizacao)} detalhe={`${rs(ind.gastoComAcordo)} de ${rs(ind.gasto)}`} />
          <Indicador titulo="Compras sem acordo" valor={rs(ind.gastoSemAcordo)} detalhe={`${inteiro.format(ind.linhasSemAcordo)} linhas`} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Indicador titulo="Pago acima do acordo" valor={rs(ind.pagoAcima)} detalhe={`${inteiro.format(ind.linhasAcima)} linhas`} />
          <Indicador titulo="Fuga de contrato" valor={rs(ind.semAcordoComOpcao)} />
          <Indicador titulo="Economia projetada" valor={rs(ind.economiaPotencial)} detalhe="Com o acordo mais barato da cidade" />
        </div>

        <Bloco titulo="Evolução mensal" vazio={!dados.mensal.length}
          rodape={temAntesDoCorte ? '* Antes do corte de vigência: comparado com a tabela atual de acordos.' : undefined}>
          <TableHeader><TableRow><TableHead>Mês</TableHead><TableHead className="w-1/3">Gasto</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Utilização</TableHead><TableHead className="text-right">Conformidade (R$)</TableHead><TableHead className="text-right">Pago acima</TableHead><TableHead className="text-right">Economia projetada</TableHead></TableRow></TableHeader>
          <TableBody>{dados.mensal.map((m: AnyRow) => (
            <TableRow key={m.mes} className={m.antesDoCorte ? 'text-muted-foreground' : ''}>
              <TableCell className="whitespace-nowrap">{mesLabel(m.mes)}{m.antesDoCorte ? ' *' : ''}</TableCell>
              <TableCell><Barra valor={Number(m.gasto || 0)} maximo={maxMes} titulo={`${mesLabel(m.mes)}: ${rs(m.gasto)}`} /></TableCell>
              <TableCell className="text-right tabular-nums">{rs(m.gasto)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(razao(m.comAcordo, m.gasto))}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(razao(m.conforme, m.comAcordo))}</TableCell>
              <TableCell className="text-right tabular-nums">{rs(m.pagoAcima)}</TableCell>
              <TableCell className="text-right tabular-nums">{rs(m.economia)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Bloco>

        <div className="grid gap-4 xl:grid-cols-2">
          <Bloco titulo="Quem mais cobrou acima do acordo" vazio={!dados.acimaPorFornecedor.length}>
            <TableHeader><TableRow><TableHead>Fornecedor</TableHead><TableHead className="text-right">Pago acima</TableHead><TableHead className="text-right">Linhas</TableHead></TableRow></TableHeader>
            <TableBody>{dados.acimaPorFornecedor.map((l: AnyRow) => (
              <TableRow key={l.fornecedor}>
                <TableCell className="w-full max-w-0"><ComBarra valor={Number(l.pagoAcima)} maximo={maxAcima} titulo={rs(l.pagoAcima)}><NomeFornecedor nome={l.fornecedor} abrir={setFornecedorAberto} /></ComBarra></TableCell>
                <TableCell className="text-right tabular-nums">{rs(l.pagoAcima)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.linhas)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Bloco>
          <Bloco titulo="Sem acordo com maior gasto (próximos acordos)" vazio={!dados.semAcordoFornecedores.length}>
            <TableHeader><TableRow><TableHead>Fornecedor</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right" title="Compras em que outro fornecedor tinha acordo para o mesmo item, modelo e cidade">Outro tinha acordo</TableHead></TableRow></TableHeader>
            <TableBody>{dados.semAcordoFornecedores.map((l: AnyRow) => (
              <TableRow key={l.fornecedor}>
                <TableCell className="w-full max-w-0"><ComBarra valor={Number(l.gasto)} maximo={maxSem} titulo={rs(l.gasto)}><NomeFornecedor nome={l.fornecedor} abrir={setFornecedorAberto} /></ComBarra></TableCell>
                <TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{inteiro.format(l.linhasComOpcao)} de {inteiro.format(l.linhas)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Bloco>
          <Bloco titulo="Itens sem acordo com maior gasto" vazio={!dados.semAcordoItens.length}>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Cidades</TableHead></TableRow></TableHeader>
            <TableBody>{dados.semAcordoItens.map((l: AnyRow) => (
              <TableRow key={l.item}>
                <TableCell className="w-full max-w-0" title={l.item}><ComBarra valor={Number(l.gasto)} maximo={maxItem} titulo={rs(l.gasto)}>{l.item}</ComBarra></TableCell>
                <TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.cidades)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Bloco>
          <Bloco titulo="Por que ficou sem acordo" vazio={!dados.motivosSemAcordo.length} rodape="Passe o mouse no motivo para ver o que fazer. Clique em Sinônimo para ver e copiar os termos.">
            <TableHeader><TableRow><TableHead>Motivo</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Linhas</TableHead></TableRow></TableHeader>
            <TableBody>{dados.motivosSemAcordo.map((l: AnyRow) => (
              <TableRow key={l.motivo} title={MOTIVOS[l.motivo]}>
                <TableCell className="underline decoration-dotted underline-offset-4">{l.motivo === 'Sinonimo'
                  ? <button type="button" className="text-link underline decoration-dotted underline-offset-4" onClick={() => setVerSinonimos(true)}>Sinônimo</button>
                  : l.motivo}</TableCell>
                <TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.linhas)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Bloco>
        </div>

        <Bloco titulo="Concentração do gasto: Pareto 20/80 e curva ABC" vazio={!linhasCurva.length}
          acoes={<div className="flex items-center gap-1">
            {(['fornecedores', 'itens'] as const).map(op => (
              <Button key={op} size="sm" variant={concentracao === op ? 'default' : 'outline'} aria-pressed={concentracao === op}
                onClick={() => { setConcentracao(op); setTodos(false); }}>{op === 'fornecedores' ? 'Fornecedores' : 'Itens'}</Button>
            ))}
            <MostrarTodos total={linhasCurva.length} todos={todos} alternar={() => setTodos(v => !v)} />
          </div>}
          rodape={`${inteiro.format(p.top20.quantidade)} ${nome} (os 20% maiores de ${inteiro.format(p.total)}) concentram ${pct(p.top20.participacao)} do gasto · 80% do gasto vem de ${inteiro.format(p.ate80.quantidade)} ${nome} (${pct(p.ate80.percentual)}) · ABC: ${curva.classes.map((c: AnyRow) => `${c.classe} ${inteiro.format(c.quantidade)}`).join(', ')}`}>
          <TableHeader><TableRow>
            <TableHead>Classe</TableHead><TableHead>{deFornecedores ? 'Fornecedor' : 'Item'}</TableHead><TableHead className="text-right">Gasto</TableHead>
            <TableHead className="text-right">% do gasto</TableHead><TableHead className="text-right">Acumulado</TableHead><TableHead className="text-right">Com acordo</TableHead>
            <TableHead className="text-right">{deFornecedores ? 'Pago acima' : 'Cidades'}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{visiveis.map((l: AnyRow, indice: number) => (
            <TableRow key={deFornecedores ? l.fornecedor : l.item}>
              <TableCell className="whitespace-nowrap font-semibold">
                {l.classe}{indice < p.top20.quantidade && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary" title="Entre os 20% maiores">20%</span>}
              </TableCell>
              <TableCell className="w-full max-w-0">{deFornecedores ? <NomeFornecedor nome={l.fornecedor} abrir={setFornecedorAberto} /> : <div className="truncate" title={l.item}>{l.item}</div>}</TableCell>
              <TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(l.pct)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(l.acumulado)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(razao(l.comAcordo, l.gasto))}</TableCell>
              <TableCell className="text-right tabular-nums">{deFornecedores ? (l.pagoAcima ? rs(l.pagoAcima) : '—') : inteiro.format(l.cidades)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Bloco>

        <Bloco titulo="Mesmo item, preços diferentes por cidade" vazio={!dados.variacaoPreco.length}
          rodape="Mediana do preço unitário por cidade; só cidades com 3 compras ou mais do item e modelo.">
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Modelo</TableHead><TableHead>Mais barato</TableHead><TableHead>Mais caro</TableHead><TableHead className="text-right">Diferença</TableHead></TableRow></TableHeader>
          <TableBody>{dados.variacaoPreco.map((l: AnyRow) => (
            <TableRow key={`${l.item}-${l.modelo}`}>
              <TableCell>{l.item}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{l.modelo}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{rsc(l.menor.preco)} <span className="text-xs text-muted-foreground">{l.menor.cidade} ({l.menor.compras})</span></TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{rsc(l.maior.preco)} <span className="text-xs text-muted-foreground">{l.maior.cidade} ({l.maior.compras})</span></TableCell>
              <TableCell className="text-right tabular-nums">{pct(l.variacao)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Bloco>
      </div>
      <Sinonimos termos={verSinonimos ? (dados.sinonimos ?? []) : null} fechar={() => setVerSinonimos(false)} />
      <DetalheFornecedor nome={fornecedorAberto} consulta={consultaDe(efetivos)} fechar={() => setFornecedorAberto(null)} />
    </div>
  );
}
