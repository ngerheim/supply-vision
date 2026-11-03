'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { ProximaAcao } from './portal-analise-acoes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
      <CardContent className="space-y-1 pt-4">
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
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
                  <TableCell className="max-w-64"><div className="truncate" title={i.item}>{i.item}</div><div className="truncate text-xs text-muted-foreground">{i.modelo}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{rs(i.gasto)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(razao(i.comAcordo, i.gasto))}</TableCell>
                  <TableCell className="text-right tabular-nums">{rsc(i.medianaPreco)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rsc(i.medianaAcordo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.pagoAcima ? rs(i.pagoAcima) : '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.semAcordo ? `${inteiro.format(i.semAcordo)} de ${inteiro.format(i.linhas)}${i.motivo ? ` · ${i.motivo === 'Sinonimo' ? 'Sinônimo' : i.motivo}` : ''}` : '—'}</TableCell>
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
  const [carregando, setCarregando] = useState(true);
  const [fornecedorAberto, setFornecedorAberto] = useState<string | null>(null);
  const [todosAbc, setTodosAbc] = useState(false);
  const [todosItens, setTodosItens] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) setCarregando(true); });
    void api(`/api/analise?${consultaDe(aplicados)}`, { signal: controller.signal }).then((resposta: AnyRow) => {
      if (controller.signal.aborted) return;
      setDados(resposta);
      setErro('');
      setRascunho(atual => ({ ...atual, de: atual.de || resposta.filtros.de, ate: atual.ate || resposta.filtros.ate }));
    }).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [aplicados, tentativa]);

  if (erro && !dados) return <FalhaDeCarregamento erro={erro} tentar={() => setTentativa(t => t + 1)} />;
  if (!dados) return <Loading label="Carregando análise…" compact />;

  const ind = dados.indicadores, ant = dados.anoAnterior;
  const efetivos: Filtros = { ...aplicados, de: dados.filtros.de, ate: dados.filtros.ate };
  const alterado = (Object.keys(VAZIO) as (keyof Filtros)[]).some(k => (rascunho[k] || '') !== (efetivos[k] || ''));
  const atualizar = () => { if (alterado) setAplicados({ ...rascunho }); else setTentativa(t => t + 1); };
  const maxMes = Math.max(0, ...dados.mensal.map((m: AnyRow) => Number(m.gasto || 0)));
  const maxAcima = Math.max(0, ...dados.acimaPorFornecedor.map((l: AnyRow) => Number(l.pagoAcima || 0)));
  const maxSem = Math.max(0, ...dados.semAcordoFornecedores.map((l: AnyRow) => Number(l.gasto || 0)));
  const maxItem = Math.max(0, ...dados.semAcordoItens.map((l: AnyRow) => Number(l.gasto || 0)));
  const semDados = !dados.disponivel.ate;
  const temAntesDoCorte = dados.mensal.some((m: AnyRow) => m.antesDoCorte);
  const abcFornecedores = todosAbc ? dados.abc.fornecedores : dados.abc.fornecedores.slice(0, LINHAS_VISIVEIS);
  const abcItens = todosItens ? dados.abcItens.itens : dados.abcItens.itens.slice(0, LINHAS_VISIVEIS);
  const paretos: [string, string, AnyRow][] = [['Fornecedores', 'fornecedores', dados.pareto.fornecedores], ['Itens', 'itens', dados.pareto.itens]];

  return (
    <div className="patio-page space-y-4">
      <LinhaDeAba />
      <ProximaAcao verTodas={verAcoes} abrirFornecedor={setFornecedorAberto} />
      <form className="patio-filters items-end" onSubmit={e => { e.preventDefault(); atualizar(); }}>
        <Field label="De"><Input type="date" value={rascunho.de} onChange={e => setRascunho(r => ({ ...r, de: e.target.value }))} /></Field>
        <Field label="Até"><Input type="date" value={rascunho.ate} onChange={e => setRascunho(r => ({ ...r, ate: e.target.value }))} /></Field>
        {(['cidade', 'fornecedor', 'grupo'] as const).map(campo => (
          <Field key={campo} label={campo === 'grupo' ? 'Grupo de despesa' : campo === 'cidade' ? 'Cidade' : 'Fornecedor'}>
            <NativeSelect value={rascunho[campo]} onChange={e => setRascunho(r => ({ ...r, [campo]: e.target.value }))}>
              <NativeSelectOption value="">Todos</NativeSelectOption>
              {(dados.opcoes[campo] as string[]).map(v => <NativeSelectOption key={v} value={v}>{v}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        ))}
        <Button type="submit" variant={alterado ? 'default' : 'outline'} disabled={carregando}>
          {carregando ? <Loader2 className="animate-spin" /> : <RefreshCw />} {carregando ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {semDados ? 'Ainda não há compras recebidas do Alertas.' : `Dados de ${dataBr(dados.disponivel.de)} a ${dataBr(dados.disponivel.ate)} · ${inteiro.format(ind.linhas)} linhas no filtro`}
        {dados.disponivel.atualizadoEm && ` · dados atualizados em ${dataHoraSolicitacao(dados.disponivel.atualizadoEm)}`}
        {alterado && ' · filtros alterados: clique em Atualizar'}
        {erro && ` · ${erro}`}
      </p>
      {dados.corteVigencia && (
        <p className="text-xs text-muted-foreground">
          Corte de vigência dos acordos: {dataBr(dados.corteVigencia)}. Compras anteriores são comparadas com a tabela atual de acordos, não com a que valia na época;
          por isso o período padrão começa no corte.
        </p>
      )}

      <div className={`space-y-4 transition-opacity ${carregando ? 'pointer-events-none opacity-50' : ''}`} aria-busy={carregando}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador titulo="Conformidade (R$)" valor={pct(ind.conformidadeRs)} detalhe={`${pct(ind.conformidadeQtd)} das linhas com acordo`} />
          <Indicador titulo="Utilização dos acordos" valor={pct(ind.utilizacao)} detalhe={`${rs(ind.gastoComAcordo)} de ${rs(ind.gasto)}`} />
          <Indicador titulo="Pago acima do acordo" valor={rs(ind.pagoAcima)} detalhe={`${inteiro.format(ind.linhasAcima)} linhas · recuperável na cobrança`} />
          <Indicador titulo="Economia teórica (teto)" valor={rs(ind.economiaPotencial)} detalhe="Se cada compra fosse feita no acordo mais barato da cidade" />
          <Indicador titulo="Gasto no período" valor={rs(ind.gasto)}
            detalhe={ant.gasto ? `${variacao(ind.gasto, ant.gasto)} sobre ${dataBr(ant.de)} a ${dataBr(ant.ate)} (${rs(ant.gasto)})` : 'Sem dados do mesmo período do ano anterior'} />
          <Indicador titulo="Compras sem acordo" valor={rs(ind.gastoSemAcordo)} detalhe={`${inteiro.format(ind.linhasSemAcordo)} linhas`} />
          <Indicador titulo="Sem acordo, havendo acordo" valor={rs(ind.semAcordoComOpcao)} detalhe="Comprado fora do fornecedor que tinha acordo" />
          <Indicador titulo="Pago abaixo do acordo" valor={rs(ind.pagoAbaixo)} />
        </div>

        <Bloco titulo="Evolução mensal" vazio={!dados.mensal.length}
          rodape={temAntesDoCorte ? '* Mês anterior ao corte de vigência: comparado com a tabela atual de acordos.' : undefined}>
          <TableHeader><TableRow><TableHead>Mês</TableHead><TableHead className="w-1/3">Gasto</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Utilização</TableHead><TableHead className="text-right">Conformidade (R$)</TableHead><TableHead className="text-right">Pago acima</TableHead><TableHead className="text-right">Economia teórica</TableHead></TableRow></TableHeader>
          <TableBody>{dados.mensal.map((m: AnyRow) => (
            <TableRow key={m.mes} className={m.antesDoCorte ? 'text-muted-foreground' : ''}>
              <TableCell>{mesLabel(m.mes)}{m.antesDoCorte ? ' *' : ''}</TableCell>
              <TableCell><Barra valor={Number(m.gasto || 0)} maximo={maxMes} titulo={`${mesLabel(m.mes)}: ${rs(m.gasto)}`} /></TableCell>
              <TableCell className="text-right tabular-nums">{rs(m.gasto)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(razao(m.comAcordo, m.gasto))}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(razao(m.conforme, m.comAcordo))}</TableCell>
              <TableCell className="text-right tabular-nums">{rs(m.pagoAcima)}</TableCell>
              <TableCell className="text-right tabular-nums">{rs(m.economia)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Bloco>

        <Bloco titulo="Pareto 20/80" vazio={!dados.pareto.fornecedores.total}>
          <TableHeader><TableRow><TableHead /><TableHead className="text-right">Total</TableHead><TableHead>Os 20% maiores</TableHead><TableHead>80% do gasto vem de</TableHead></TableRow></TableHeader>
          <TableBody>{paretos.map(([rotulo, nome, p]) => (
            <TableRow key={rotulo}>
              <TableCell className="font-medium">{rotulo}</TableCell>
              <TableCell className="text-right tabular-nums">{inteiro.format(p.total)}</TableCell>
              <TableCell>{`${inteiro.format(p.top20.quantidade)} ${nome} concentram ${pct(p.top20.participacao)} do gasto`}</TableCell>
              <TableCell>{`${inteiro.format(p.ate80.quantidade)} ${nome} (${pct(p.ate80.percentual)} do total)`}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Bloco>

        <div className="grid gap-4 xl:grid-cols-2">
          <Bloco titulo="Fornecedores que mais cobraram acima do acordo" vazio={!dados.acimaPorFornecedor.length}>
            <TableHeader><TableRow><TableHead>Fornecedor</TableHead><TableHead className="w-1/4" /><TableHead className="text-right">Pago acima</TableHead><TableHead className="text-right">Linhas</TableHead></TableRow></TableHeader>
            <TableBody>{dados.acimaPorFornecedor.map((l: AnyRow) => (
              <TableRow key={l.fornecedor}><TableCell className="max-w-56"><NomeFornecedor nome={l.fornecedor} abrir={setFornecedorAberto} /></TableCell><TableCell><Barra valor={Number(l.pagoAcima)} maximo={maxAcima} titulo={rs(l.pagoAcima)} /></TableCell><TableCell className="text-right tabular-nums">{rs(l.pagoAcima)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.linhas)}</TableCell></TableRow>
            ))}</TableBody>
          </Bloco>
          <Bloco titulo="Fornecedores sem acordo com maior gasto (próximos acordos)" vazio={!dados.semAcordoFornecedores.length}>
            <TableHeader><TableRow><TableHead>Fornecedor</TableHead><TableHead className="w-1/4" /><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right" title="Compras em que outro fornecedor tinha acordo para o mesmo item, modelo e cidade">Outro tinha acordo</TableHead></TableRow></TableHeader>
            <TableBody>{dados.semAcordoFornecedores.map((l: AnyRow) => (
              <TableRow key={l.fornecedor}><TableCell className="max-w-56"><NomeFornecedor nome={l.fornecedor} abrir={setFornecedorAberto} /></TableCell><TableCell><Barra valor={Number(l.gasto)} maximo={maxSem} titulo={rs(l.gasto)} /></TableCell><TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.linhasComOpcao)} de {inteiro.format(l.linhas)}</TableCell></TableRow>
            ))}</TableBody>
          </Bloco>
          <Bloco titulo="Itens sem acordo com maior gasto" vazio={!dados.semAcordoItens.length}>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="w-1/4" /><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Cidades</TableHead></TableRow></TableHeader>
            <TableBody>{dados.semAcordoItens.map((l: AnyRow) => (
              <TableRow key={l.item}><TableCell className="max-w-56 truncate" title={l.item}>{l.item}</TableCell><TableCell><Barra valor={Number(l.gasto)} maximo={maxItem} titulo={rs(l.gasto)} /></TableCell><TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.cidades)}</TableCell></TableRow>
            ))}</TableBody>
          </Bloco>
          <Bloco titulo="Por que a compra ficou sem acordo" vazio={!dados.motivosSemAcordo.length}
            rodape="Fornecedor: não tem acordo. Item, Modelo ou Cidade: o acordo existe, mas não cobre a compra (vale negociar se o gasto for relevante). Sinônimo: o termo não casa com o De/Para; atualizar o De/Para ou excluir o termo dos filtros.">
            <TableHeader><TableRow><TableHead>Motivo</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Linhas</TableHead></TableRow></TableHeader>
            <TableBody>{dados.motivosSemAcordo.map((l: AnyRow) => (
              <TableRow key={l.motivo}><TableCell>{l.motivo === 'Sinonimo' ? 'Sinônimo' : l.motivo}</TableCell><TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.linhas)}</TableCell></TableRow>
            ))}</TableBody>
          </Bloco>
        </div>

        <Bloco titulo={`Curva ABC de fornecedores · ${dados.abc.classes.map((c: AnyRow) => `${c.classe}: ${inteiro.format(c.quantidade)}`).join(' · ')}`} vazio={!dados.abc.fornecedores.length}
          acoes={<MostrarTodos total={dados.abc.fornecedores.length} todos={todosAbc} alternar={() => setTodosAbc(v => !v)} />}>
          <TableHeader><TableRow><TableHead>Classe</TableHead><TableHead>Fornecedor</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">% do gasto</TableHead><TableHead className="text-right">Acumulado</TableHead><TableHead className="text-right">Com acordo</TableHead><TableHead className="text-right">Pago acima</TableHead></TableRow></TableHeader>
          <TableBody>{abcFornecedores.map((l: AnyRow) => (
            <TableRow key={l.fornecedor}>
              <TableCell className="font-semibold">{l.classe}</TableCell>
              <TableCell className="max-w-64"><NomeFornecedor nome={l.fornecedor} abrir={setFornecedorAberto} /></TableCell>
              <TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(l.pct)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(l.acumulado)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(razao(l.comAcordo, l.gasto))}</TableCell>
              <TableCell className="text-right tabular-nums">{l.pagoAcima ? rs(l.pagoAcima) : '—'}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Bloco>

        <div className="grid gap-4 xl:grid-cols-2">
          <Bloco titulo={`Curva ABC de itens · ${dados.abcItens.classes.map((c: AnyRow) => `${c.classe}: ${inteiro.format(c.quantidade)}`).join(' · ')}`} vazio={!dados.abcItens.itens.length}
            acoes={<MostrarTodos total={dados.abcItens.itens.length} todos={todosItens} alternar={() => setTodosItens(v => !v)} />}>
            <TableHeader><TableRow><TableHead>Classe</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Acumulado</TableHead><TableHead className="text-right">Com acordo</TableHead><TableHead className="text-right">Cidades</TableHead></TableRow></TableHeader>
            <TableBody>{abcItens.map((l: AnyRow) => (
              <TableRow key={l.item}>
                <TableCell className="font-semibold">{l.classe}</TableCell>
                <TableCell className="max-w-56 truncate" title={l.item}>{l.item}</TableCell>
                <TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(l.acumulado)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(razao(l.comAcordo, l.gasto))}</TableCell>
                <TableCell className="text-right tabular-nums">{inteiro.format(l.cidades)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Bloco>
          <Bloco titulo="Mesmo item, preços diferentes por cidade" vazio={!dados.variacaoPreco.length}
            rodape="Mediana do preço unitário em cada cidade; só entram cidades com pelo menos 3 compras do item e modelo.">
            <TableHeader><TableRow><TableHead>Item / modelo</TableHead><TableHead className="text-right">Menor</TableHead><TableHead className="text-right">Maior</TableHead><TableHead className="text-right">Diferença</TableHead></TableRow></TableHeader>
            <TableBody>{dados.variacaoPreco.map((l: AnyRow) => (
              <TableRow key={`${l.item}-${l.modelo}`}>
                <TableCell className="max-w-56"><div className="truncate" title={l.item}>{l.item}</div><div className="truncate text-xs text-muted-foreground">{l.modelo} · {inteiro.format(l.cidades)} cidades</div></TableCell>
                <TableCell className="text-right tabular-nums">{rsc(l.menor.preco)}<div className="text-xs text-muted-foreground">{l.menor.cidade} · {l.menor.compras} compras</div></TableCell>
                <TableCell className="text-right tabular-nums">{rsc(l.maior.preco)}<div className="text-xs text-muted-foreground">{l.maior.cidade} · {l.maior.compras} compras</div></TableCell>
                <TableCell className="text-right tabular-nums">{pct(l.variacao)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Bloco>
        </div>
      </div>
      <DetalheFornecedor nome={fornecedorAberto} consulta={consultaDe(efetivos)} fechar={() => setFornecedorAberto(null)} />
    </div>
  );
}
