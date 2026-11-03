'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, Lightbulb, RotateCcw, X } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { TabelaPadrao } from './tela-padrao';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { dataHoraSolicitacao } from '@/lib/solicitacoes-cliente';
import { type AnyRow, Field, Loading, FalhaDeCarregamento } from './portal-presentation';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const rs = (v: unknown) => moeda.format(Number(v || 0));
const dataBr = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
export const ROTULO_STATUS: Record<string, string> = {
  pendente: 'Pendente', feita: 'Feita', pulada: 'Adiada', rejeitada: 'Rejeitada', encerrada: 'Encerrada pelo sistema',
};

type Decisao = { acao: AnyRow; para: 'feita' | 'pulada' | 'rejeitada' };

// Confirma feito / pular / rejeitar. Rejeitar exige motivo; pular escolhe o prazo.
function DialogoDecisao({ decisao, fechar, concluir }: { decisao: Decisao | null; fechar: () => void; concluir: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [dias, setDias] = useState('30');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  if (!decisao) return null;
  const { acao, para } = decisao;
  const titulo = para === 'feita' ? 'Marcar como feita' : para === 'pulada' ? 'Pular por enquanto' : 'Rejeitar sugestão';
  const enviar = async () => {
    if (para === 'rejeitada' && !motivo.trim()) { setErro('Informe por que a sugestão foi rejeitada.'); return; }
    setOcupado(true); setErro('');
    try {
      await api(`/api/analise/acoes/${encodeURIComponent(acao.id)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ de: acao.status, para, motivo: motivo.trim() || undefined, dias: para === 'pulada' ? Number(dias) : undefined }),
      });
      concluir();
    } catch (falha) { setErro(errorText(falha)); } finally { setOcupado(false); }
  };
  return (
    <Dialog open onOpenChange={aberto => !aberto && !ocupado && fechar()}>
      <DialogContent showCloseButton={!ocupado} className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{titulo}</DialogTitle></DialogHeader>
        <p className="text-sm font-medium">{acao.titulo}</p>
        {para === 'pulada' && (
          <Field label="Voltar para a fila em">
            <NativeSelect value={dias} onChange={e => setDias(e.target.value)}>
              {['7', '30', '90'].map(d => <NativeSelectOption key={d} value={d}>{`${d} dias`}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        )}
        <Field label={para === 'rejeitada' ? 'Motivo (obrigatório)' : 'Observação (opcional)'}>
          <Textarea value={motivo} maxLength={500} onChange={e => setMotivo(e.target.value)}
            placeholder={para === 'rejeitada' ? 'Ex.: fornecedor não aceita acordo; volume não justifica' : para === 'feita' ? 'Ex.: acordo assinado em 05/11' : ''} />
        </Field>
        {para === 'feita' && <p className="text-xs text-muted-foreground">Se a condição continuar nos dados 60 dias depois, a sugestão volta para a fila.</p>}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={ocupado} onClick={fechar}>Cancelar</Button>
          <Button variant={para === 'rejeitada' ? 'destructive' : 'default'} disabled={ocupado} onClick={() => void enviar()}>{titulo}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Botoes({ acao, decidir }: { acao: AnyRow; decidir: (d: Decisao) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => decidir({ acao, para: 'feita' })}><Check /> Feito</Button>
      <Button size="sm" variant="outline" onClick={() => decidir({ acao, para: 'pulada' })}><Clock3 /> Pular</Button>
      <Button size="sm" variant="outline" onClick={() => decidir({ acao, para: 'rejeitada' })}><X /> Rejeitar</Button>
    </div>
  );
}

// Cartao do topo do Painel: a sugestao de maior valor envolvido.
export function ProximaAcao({ verTodas, abrirFornecedor }: { verTodas: () => void; abrirFornecedor: (nome: string) => void }) {
  const [dados, setDados] = useState<AnyRow | null>(null);
  const [decisao, setDecisao] = useState<Decisao | null>(null);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api('/api/analise/acoes?lista=pendente&limite=1', { signal: controller.signal })
      .then((r: AnyRow) => { if (!controller.signal.aborted) setDados(r); })
      .catch(() => { if (!controller.signal.aborted) setDados(null); });
    return () => controller.abort();
  }, [versao]);
  const acao = dados?.acoes?.[0];
  if (!dados) return null;
  return (
    <Card className="border-primary/40">
      <CardContent className="flex flex-col gap-3 pt-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 gap-3">
          <Lightbulb aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground">
              Próxima ação{dados.contagem.pendentes > 1 ? ` · 1 de ${dados.contagem.pendentes} pendentes` : ''}
            </p>
            {acao ? (
              <>
                <p className="font-semibold">{acao.titulo}</p>
                <p className="text-sm text-muted-foreground">{acao.detalhe}</p>
              </>
            ) : <p className="text-sm">Nenhuma sugestão pendente. As sugestões são refeitas a cada atualização dos dados.</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {acao && dados.podeResolver && <Botoes acao={acao} decidir={setDecisao} />}
          {acao?.filtro?.fornecedor && <Button size="sm" variant="ghost" onClick={() => abrirFornecedor(acao.filtro.fornecedor)}>Ver fornecedor</Button>}
          <Button size="sm" variant="ghost" onClick={verTodas}>Ver todas</Button>
        </div>
      </CardContent>
      <DialogoDecisao key={decisao ? `${decisao.acao.id}-${decisao.para}` : 'nada'} decisao={decisao} fechar={() => setDecisao(null)} concluir={() => { setDecisao(null); setVersao(v => v + 1); }} />
    </Card>
  );
}

const LISTAS = [
  { lista: 'pendente', label: 'Pendentes' },
  { lista: 'pulada', label: 'Adiadas' },
  { lista: 'historico', label: 'Histórico' },
] as const;

export function AcoesAnalise({ abrirFornecedor }: { abrirFornecedor: (nome: string) => void }) {
  const [lista, setLista] = useState<(typeof LISTAS)[number]['lista']>('pendente');
  const [dados, setDados] = useState<AnyRow | null>(null);
  const [erro, setErro] = useState('');
  const [decisao, setDecisao] = useState<Decisao | null>(null);
  const [versao, setVersao] = useState(0);

  const carregar = useCallback(async (signal?: AbortSignal) => {
    const r = await api(`/api/analise/acoes?lista=${lista}`, { signal });
    if (signal?.aborted) return;
    setDados(r); setErro('');
  }, [lista]);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void carregar(controller.signal).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    });
    return () => controller.abort();
  }, [carregar, versao]);

  const reabrir = (acao: AnyRow) => void api(`/api/analise/acoes/${encodeURIComponent(acao.id)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ de: acao.status, para: 'pendente' }),
  }).then(() => setVersao(v => v + 1)).catch(falha => setErro(errorText(falha)));

  if (erro && !dados) return <FalhaDeCarregamento erro={erro} tentar={() => setVersao(v => v + 1)} />;
  const c = dados?.contagem;

  return (
    <div className="patio-page space-y-4">
      <LinhaDeAba actions={
        <div className="flex gap-1">
          {LISTAS.map(l => (
            <Button key={l.lista} size="sm" variant={lista === l.lista ? 'default' : 'outline'} aria-pressed={lista === l.lista}
              onClick={() => { setLista(l.lista); setDados(null); }}>
              {l.label}{l.lista === 'pendente' && c ? ` (${c.pendentes})` : l.lista === 'pulada' && c ? ` (${c.puladas})` : ''}
            </Button>
          ))}
        </div>
      } />
      <p className="text-xs text-muted-foreground" title="Rejeitada não volta. Adiada volta no prazo escolhido. Feita volta se a condição continuar 60 dias depois.">
        Compras dos últimos 90 dias, por valor envolvido{dados?.geradasEm && ` · refeitas em ${dataHoraSolicitacao(dados.geradasEm)}`}
        {erro && ` · ${erro}`}
      </p>
      {!dados ? <Loading label="Carregando sugestões…" compact /> : lista === 'historico' ? (
        <TabelaPadrao contador={`${dados.eventos.length} registros`} vazio={!dados.eventos.length ? <p className="p-4 text-sm text-muted-foreground">Nenhum registro ainda.</p> : undefined}>
          <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Sugestão</TableHead><TableHead>Mudança</TableHead><TableHead>Quem</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
          <TableBody>{dados.eventos.map((e: AnyRow) => (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap tabular-nums">{dataHoraSolicitacao(e.criadoEm)}</TableCell>
              <TableCell className="min-w-72 whitespace-normal">{e.titulo}</TableCell>
              <TableCell className="whitespace-nowrap">{e.de ? `${ROTULO_STATUS[e.de] ?? e.de} → ` : ''}{ROTULO_STATUS[e.para] ?? e.para}</TableCell>
              <TableCell>{e.usuario ?? 'Sistema'}</TableCell>
              <TableCell className="min-w-56 whitespace-normal text-muted-foreground">{e.motivo ?? '—'}</TableCell>
            </TableRow>
          ))}</TableBody>
        </TabelaPadrao>
      ) : (
        <TabelaPadrao contador={`${dados.acoes.length} ${dados.acoes.length === 1 ? 'sugestão' : 'sugestões'}${lista === 'pendente' && c ? ` · ${rs(c.impactoPendente)} envolvidos` : ''}`}
          vazio={!dados.acoes.length ? <p className="p-4 text-sm text-muted-foreground">{lista === 'pendente' ? 'Nenhuma sugestão pendente.' : 'Nenhuma sugestão adiada.'}</p> : undefined}>
          <TableHeader><TableRow>
            <TableHead>Sugestão</TableHead><TableHead className="text-right">Valor envolvido</TableHead>
            <TableHead>{lista === 'pulada' ? 'Volta em' : 'Desde'}</TableHead><TableHead><span className="sr-only">Decisão</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{dados.acoes.map((a: AnyRow) => (
            <TableRow key={a.id}>
              <TableCell className="w-full min-w-[28rem] whitespace-normal">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{a.tipoLabel}</div>
                {a.filtro?.fornecedor
                  ? <button type="button" className="text-left font-medium text-link hover:underline" title="Ver o painel do fornecedor" onClick={() => abrirFornecedor(a.filtro.fornecedor)}>{a.titulo}</button>
                  : <div className="font-medium">{a.titulo}</div>}
                <div className="text-xs text-muted-foreground">{a.detalhe}</div>
                {a.motivo && <div className="text-xs text-muted-foreground">{a.motivo}{a.resolvidaPor ? ` · ${a.resolvidaPor}` : ''}</div>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">{rs(a.impacto)}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{lista === 'pulada' ? dataBr(a.adiadaAte) : dataBr(a.criadaEm)}</TableCell>
              <TableCell>
                <div className="flex flex-nowrap justify-end gap-2">
                  {dados.podeResolver && (lista === 'pendente'
                    ? <Botoes acao={a} decidir={setDecisao} />
                    : <Button size="sm" variant="outline" onClick={() => reabrir(a)}><RotateCcw /> Voltar para a fila</Button>)}
                </div>
              </TableCell>
            </TableRow>
          ))}</TableBody>
        </TabelaPadrao>
      )}
      <DialogoDecisao key={decisao ? `${decisao.acao.id}-${decisao.para}` : 'nada'} decisao={decisao} fechar={() => setDecisao(null)} concluir={() => { setDecisao(null); setVersao(v => v + 1); }} />
    </div>
  );
}
