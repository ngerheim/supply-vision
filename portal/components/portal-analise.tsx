'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { PageHeader } from './page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { type AnyRow, Field, Loading, FalhaDeCarregamento } from './portal-presentation';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const inteiro = new Intl.NumberFormat('pt-BR');
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const rs = (v: unknown) => moeda.format(Number(v || 0));
const mesLabel = (m: string) => { const [a, mm] = m.split('-'); return `${mm}/${a}`; };
const dataBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');

// Indicador em destaque: numero grande, rotulo curto e uma linha de contexto.
function Indicador({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
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

function Bloco({ titulo, children, vazio }: { titulo: string; children: ReactNode; vazio?: boolean }) {
  return (
    <Card className="min-w-0 patio-table-card">
      <CardHeader className="border-b"><p className="patio-result-count">{titulo}</p></CardHeader>
      <CardContent className="min-w-0 px-0 pb-0">
        {vazio ? <p className="p-4 text-sm text-muted-foreground">Sem dados no período.</p> : <Table>{children}</Table>}
      </CardContent>
    </Card>
  );
}

export function Analise() {
  const [filtros, setFiltros] = useState<{ de: string; ate: string; cidade: string; fornecedor: string; grupo: string }>({ de: '', ate: '', cidade: '', fornecedor: '', grupo: '' });
  const [dados, setDados] = useState<AnyRow | null>(null);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    for (const [chave, valor] of Object.entries(filtros)) if (valor) params.set(chave, valor);
    void api(`/api/analise?${params}`, { signal: controller.signal }).then((resposta: AnyRow) => {
      if (controller.signal.aborted) return;
      setDados(resposta);
      setErro('');
    }).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    return () => controller.abort();
  }, [filtros, tentativa]);

  if (erro && !dados) return <FalhaDeCarregamento erro={erro} tentar={() => setTentativa(t => t + 1)} />;
  if (!dados) return <Loading label="Carregando análise…" compact />;

  const ind = dados.indicadores, f = dados.filtros;
  const alterar = (campo: string, valor: string) => setFiltros(atual => ({ ...atual, de: atual.de || f.de, ate: atual.ate || f.ate, [campo]: valor }));
  const maxMes = Math.max(0, ...dados.mensal.map((m: AnyRow) => Number(m.gasto || 0)));
  const maxAcima = Math.max(0, ...dados.acimaPorFornecedor.map((l: AnyRow) => Number(l.pagoAcima || 0)));
  const maxSem = Math.max(0, ...dados.semAcordoFornecedores.map((l: AnyRow) => Number(l.gasto || 0)));
  const maxItem = Math.max(0, ...dados.semAcordoItens.map((l: AnyRow) => Number(l.gasto || 0)));
  const semDados = !dados.disponivel.ate;

  return (
    <div className="patio-page space-y-4">
      <PageHeader />
      <div className="patio-filters">
        <Field label="De"><Input type="date" value={filtros.de || f.de} onChange={e => alterar('de', e.target.value)} /></Field>
        <Field label="Até"><Input type="date" value={filtros.ate || f.ate} onChange={e => alterar('ate', e.target.value)} /></Field>
        {(['cidade', 'fornecedor', 'grupo'] as const).map(campo => (
          <Field key={campo} label={campo === 'grupo' ? 'Grupo de despesa' : campo === 'cidade' ? 'Cidade' : 'Fornecedor'}>
            <NativeSelect value={filtros[campo]} onChange={e => alterar(campo, e.target.value)}>
              <NativeSelectOption value="">Todos</NativeSelectOption>
              {(dados.opcoes[campo] as string[]).map(v => <NativeSelectOption key={v} value={v}>{v}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {semDados ? 'Ainda não há compras recebidas do Alertas.' : `Dados de ${dataBr(dados.disponivel.de)} a ${dataBr(dados.disponivel.ate)} · ${inteiro.format(ind.linhas)} linhas no filtro.`}
        {erro && ` · ${erro}`}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Conformidade (R$)" valor={pct(ind.conformidadeRs)} detalhe={`${pct(ind.conformidadeQtd)} das linhas com acordo`} />
        <Indicador titulo="Utilização dos acordos" valor={pct(ind.utilizacao)} detalhe={`${rs(ind.gastoComAcordo)} de ${rs(ind.gasto)}`} />
        <Indicador titulo="Pago acima do acordo" valor={rs(ind.pagoAcima)} detalhe={`${inteiro.format(ind.linhasAcima)} linhas`} />
        <Indicador titulo="Economia possível" valor={rs(ind.economiaPotencial)} detalhe={`Com o menor acordo: ${rs(ind.gastoComMelhorAcordo)}`} />
        <Indicador titulo="Gasto no período" valor={rs(ind.gasto)} />
        <Indicador titulo="Compras sem acordo" valor={rs(ind.gastoSemAcordo)} detalhe={`${inteiro.format(ind.linhasSemAcordo)} linhas`} />
        <Indicador titulo="Sem acordo, havendo acordo" valor={rs(ind.semAcordoComOpcao)} detalhe="Compra fora de fornecedor com acordo" />
        <Indicador titulo="Pago abaixo do acordo" valor={rs(ind.pagoAbaixo)} />
      </div>

      <Bloco titulo="Evolução mensal" vazio={!dados.mensal.length}>
        <TableHeader><TableRow><TableHead>Mês</TableHead><TableHead className="w-1/3">Gasto</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Utilização</TableHead><TableHead className="text-right">Conformidade (R$)</TableHead><TableHead className="text-right">Pago acima</TableHead><TableHead className="text-right">Economia possível</TableHead></TableRow></TableHeader>
        <TableBody>{dados.mensal.map((m: AnyRow) => (
          <TableRow key={m.mes}>
            <TableCell>{mesLabel(m.mes)}</TableCell>
            <TableCell><Barra valor={Number(m.gasto || 0)} maximo={maxMes} titulo={`${mesLabel(m.mes)}: ${rs(m.gasto)}`} /></TableCell>
            <TableCell className="text-right tabular-nums">{rs(m.gasto)}</TableCell>
            <TableCell className="text-right tabular-nums">{pct(m.gasto ? Number(m.comAcordo || 0) / Number(m.gasto) : null)}</TableCell>
            <TableCell className="text-right tabular-nums">{pct(m.comAcordo ? Number(m.conforme || 0) / Number(m.comAcordo) : null)}</TableCell>
            <TableCell className="text-right tabular-nums">{rs(m.pagoAcima)}</TableCell>
            <TableCell className="text-right tabular-nums">{rs(m.economia)}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Bloco>

      <div className="grid gap-4 xl:grid-cols-2">
        <Bloco titulo="Fornecedores que mais cobraram acima do acordo" vazio={!dados.acimaPorFornecedor.length}>
          <TableHeader><TableRow><TableHead>Fornecedor</TableHead><TableHead className="w-1/4" /><TableHead className="text-right">Pago acima</TableHead><TableHead className="text-right">Linhas</TableHead></TableRow></TableHeader>
          <TableBody>{dados.acimaPorFornecedor.map((l: AnyRow) => (
            <TableRow key={l.fornecedor}><TableCell className="max-w-56 truncate" title={l.fornecedor}>{l.fornecedor}</TableCell><TableCell><Barra valor={Number(l.pagoAcima)} maximo={maxAcima} titulo={rs(l.pagoAcima)} /></TableCell><TableCell className="text-right tabular-nums">{rs(l.pagoAcima)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.linhas)}</TableCell></TableRow>
          ))}</TableBody>
        </Bloco>
        <Bloco titulo="Fornecedores sem acordo com maior gasto (próximos acordos)" vazio={!dados.semAcordoFornecedores.length}>
          <TableHeader><TableRow><TableHead>Fornecedor</TableHead><TableHead className="w-1/4" /><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Havia acordo</TableHead></TableRow></TableHeader>
          <TableBody>{dados.semAcordoFornecedores.map((l: AnyRow) => (
            <TableRow key={l.fornecedor}><TableCell className="max-w-56 truncate" title={`${l.fornecedor} · ${l.cidade || ''}`}>{l.fornecedor}</TableCell><TableCell><Barra valor={Number(l.gasto)} maximo={maxSem} titulo={rs(l.gasto)} /></TableCell><TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.linhasComOpcao)} de {inteiro.format(l.linhas)}</TableCell></TableRow>
          ))}</TableBody>
        </Bloco>
        <Bloco titulo="Itens sem acordo com maior gasto" vazio={!dados.semAcordoItens.length}>
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="w-1/4" /><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Cidades</TableHead></TableRow></TableHeader>
          <TableBody>{dados.semAcordoItens.map((l: AnyRow) => (
            <TableRow key={l.item}><TableCell className="max-w-56 truncate" title={l.item}>{l.item}</TableCell><TableCell><Barra valor={Number(l.gasto)} maximo={maxItem} titulo={rs(l.gasto)} /></TableCell><TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.cidades)}</TableCell></TableRow>
          ))}</TableBody>
        </Bloco>
        <Bloco titulo="Por que a compra ficou sem acordo" vazio={!dados.motivosSemAcordo.length}>
          <TableHeader><TableRow><TableHead>Motivo</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">Linhas</TableHead></TableRow></TableHeader>
          <TableBody>{dados.motivosSemAcordo.map((l: AnyRow) => (
            <TableRow key={l.motivo}><TableCell>{l.motivo}</TableCell><TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="text-right tabular-nums">{inteiro.format(l.linhas)}</TableCell></TableRow>
          ))}</TableBody>
        </Bloco>
        <Bloco titulo={`Curva ABC de fornecedores · ${dados.abc.classes.map((c: AnyRow) => `${c.classe}: ${c.fornecedores}`).join(' · ')}`} vazio={!dados.abc.fornecedores.length}>
          <TableHeader><TableRow><TableHead>Classe</TableHead><TableHead>Fornecedor</TableHead><TableHead className="text-right">Gasto</TableHead><TableHead className="text-right">% do gasto</TableHead><TableHead className="text-right">Acumulado</TableHead></TableRow></TableHeader>
          <TableBody>{dados.abc.fornecedores.map((l: AnyRow) => (
            <TableRow key={l.fornecedor}><TableCell className="font-semibold">{l.classe}</TableCell><TableCell className="max-w-56 truncate" title={l.fornecedor}>{l.fornecedor}</TableCell><TableCell className="text-right tabular-nums">{rs(l.gasto)}</TableCell><TableCell className="text-right tabular-nums">{pct(l.pct)}</TableCell><TableCell className="text-right tabular-nums">{pct(l.acumulado)}</TableCell></TableRow>
          ))}</TableBody>
        </Bloco>
        <Bloco titulo="Mesmo item, preços diferentes por cidade" vazio={!dados.variacaoPreco.length}>
          <TableHeader><TableRow><TableHead>Item / modelo</TableHead><TableHead className="text-right">Menor</TableHead><TableHead className="text-right">Maior</TableHead><TableHead className="text-right">Diferença</TableHead></TableRow></TableHeader>
          <TableBody>{dados.variacaoPreco.map((l: AnyRow) => (
            <TableRow key={`${l.item}-${l.modelo}`}>
              <TableCell className="max-w-56"><div className="truncate" title={l.item}>{l.item}</div><div className="truncate text-xs text-muted-foreground">{l.modelo}</div></TableCell>
              <TableCell className="text-right tabular-nums" title={l.menor.cidade}>{rs(l.menor.preco)}<div className="text-xs text-muted-foreground">{l.menor.cidade}</div></TableCell>
              <TableCell className="text-right tabular-nums" title={l.maior.cidade}>{rs(l.maior.preco)}<div className="text-xs text-muted-foreground">{l.maior.cidade}</div></TableCell>
              <TableCell className="text-right tabular-nums">{pct(l.variacao)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Bloco>
      </div>
    </div>
  );
}
