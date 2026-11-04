'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, Save, TriangleAlert } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { TabelaPadrao } from './tela-padrao';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { dataHoraSolicitacao } from '@/lib/solicitacoes-cliente';
import { type AnyRow, Field, Loading, FalhaDeCarregamento, roleName } from './portal-presentation';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');
const rs = (v: unknown) => (v === null || v === undefined ? '—' : moeda.format(Number(v)));
const dataBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
const LIMITE_TELA = 500;
// A tabela do Portal usa table-layout fixed: as colunas curtas tem largura
// fixa e fornecedor e item dividem o espaco que sobra.
const LARGURA: Record<string, number> = { Data: 96, OS: 76, Criador: 120, Cidade: 120, Modelo: 110, Qtd: 52,
  'Preço OS': 112, 'Preço acordo': 112, 'Dif. unit.': 104, 'Dif. total': 112, Situação: 130 };
const NUM = 'patio-num tabular-nums';

const SITUACAO: Record<string, { rotulo: string; classe: string }> = {
  'ACIMA DO ACORDO': { rotulo: 'Acima do acordo', classe: 'bg-destructive/10 text-destructive' },
  'ABAIXO DO ACORDO': { rotulo: 'Abaixo do acordo', classe: 'bg-primary/10 text-primary' },
};

function Indicador({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
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

function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span>{children}</span>
    </div>
  );
}

// Mesmas colunas e ordem da planilha que ia anexada ao e-mail.
async function baixarPlanilha(rodada: AnyRow, linhas: AnyRow[]) {
  const XLSX = await import('xlsx');
  const dados = linhas.map(l => ({
    Data: dataBr(l.data), OS: l.os, Criador: l.criador, Cidade: l.cidade, Fornecedor: l.fornecedor, Modelo: l.modelo, Item: l.item,
    Qtd: l.qtd, 'Preco OS': l.precoOs, 'Preco Acordo': l.precoAcordo, 'Preco Total OS': l.totalOs, 'Preco Total Acordo': l.totalAcordo,
    'Diferenca Unit.': l.difUnit, 'Diferenca Total': l.difTotal, Status: l.status, CNPJ: l.cnpj, UF: l.uf,
  }));
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, XLSX.utils.json_to_sheet(dados), 'Relatório');
  const nome = String(rodada.titulo).replace(/[^0-9A-Za-zÀ-ú]+/g, '_').replace(/^_|_$/g, '');
  XLSX.writeFile(livro, `alertas_${nome}.xlsx`);
}

export function Alertas({ inicial }: { inicial: string | null }) {
  const [lista, setLista] = useState<AnyRow | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(inicial);
  const [detalhe, setDetalhe] = useState<AnyRow | null>(null);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState('');
  const [cidade, setCidade] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void api('/api/alertas', { signal: controller.signal }).then((resposta: AnyRow) => {
      if (controller.signal.aborted) return;
      setLista(resposta);
      setErro('');
      setSelecionada(atual => atual ?? resposta.rodadas[0]?.id ?? null);
    }).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    return () => controller.abort();
  }, [tentativa]);

  useEffect(() => {
    if (!selecionada) return;
    const controller = new AbortController();
    void api(`/api/alertas/${encodeURIComponent(selecionada)}`, { signal: controller.signal }).then((resposta: AnyRow) => {
      if (controller.signal.aborted) return;
      setDetalhe(resposta);
      setErro('');
    }).catch(falha => { if (!controller.signal.aborted) { setDetalhe(null); setErro(errorText(falha)); } });
    return () => controller.abort();
  }, [selecionada, tentativa]);

  const linhas = useMemo(() => (detalhe?.linhas ?? []) as AnyRow[], [detalhe]);
  const cidades = useMemo(() => [...new Set(linhas.map(l => l.cidade).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR')) as string[], [linhas]);
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    return linhas.filter(l => (!situacao || l.status === situacao) && (!cidade || l.cidade === cidade) && (!termo ||
      [l.os, l.criador, l.fornecedor, l.modelo, l.item, l.cnpj].some(v => String(v ?? '').toLocaleLowerCase('pt-BR').includes(termo))));
  }, [linhas, busca, situacao, cidade]);

  if (erro && !lista) return <FalhaDeCarregamento erro={erro} tentar={() => setTentativa(t => t + 1)} />;
  if (!lista) return <Loading label="Carregando alertas…" compact />;

  const rodadas = lista.rodadas as AnyRow[];
  const rodada = detalhe?.rodada?.id === selecionada ? detalhe?.rodada : null;
  const resumo = rodada?.resumo ?? {};
  const difFiltro = filtradas.reduce((s, l) => s + Number(l.difTotal || 0), 0);

  return (
    <div className="patio-page space-y-4">
      <LinhaDeAba actions={rodada && linhas.length > 0 && (
        <Button variant="outline" onClick={() => void baixarPlanilha(rodada, linhas)}><Download /> Baixar planilha</Button>
      )} />
      {!rodadas.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma rodada publicada ainda. Elas aparecem aqui a partir da próxima execução do Alertas.</p>
      ) : (
        <>
          <div className="patio-filters">
            <Field label="Rodada">
              <NativeSelect value={selecionada ?? ''} onChange={e => { setSelecionada(e.target.value); setBusca(''); setSituacao(''); setCidade(''); }}>
                {rodadas.some(r => r.id === selecionada) || !selecionada ? null : <NativeSelectOption value={selecionada}>Rodada do aviso</NativeSelectOption>}
                {rodadas.map(r => (
                  <NativeSelectOption key={r.id} value={r.id}>{`${r.titulo} · ${inteiro.format(r.linhas)} fora do acordo`}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Buscar"><Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="OS, criador, fornecedor, item…" /></Field>
            <Field label="Situação">
              <NativeSelect value={situacao} onChange={e => setSituacao(e.target.value)}>
                <NativeSelectOption value="">Todas</NativeSelectOption>
                {Object.entries(SITUACAO).map(([valor, s]) => <NativeSelectOption key={valor} value={valor}>{s.rotulo}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            <Field label="Cidade">
              <NativeSelect value={cidade} onChange={e => setCidade(e.target.value)}>
                <NativeSelectOption value="">Todas</NativeSelectOption>
                {cidades.map(c => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
          </div>
          {erro && <p role="alert" className="text-sm">{erro}</p>}
          {!rodada ? <Loading label="Carregando rodada…" compact /> : (
            <>
              <p className="text-xs text-muted-foreground">
                {rodada.titulo} · publicada em {dataHoraSolicitacao(rodada.recebidaEm)}
                {rodada.atualizadaEm !== rodada.recebidaEm && ` · atualizada em ${dataHoraSolicitacao(rodada.atualizadaEm)}`}
                {!lista.recebeAviso && ' · você não recebe o aviso desta aba na Central'}
              </p>
              {resumo.alertaPendencias && (
                <Aviso>
                  {resumo.totalElegivel === 0 ? 'Não foi possível comparar as compras desta rodada. ' : ''}
                  {`${String(resumo.percentualPendencias).replace('.', ',')}% das compras ficaram em pendência e não foram comparadas. Os números se referem apenas às compras comparáveis. Confira a extração do Qlik e as pendências de cadastro.`}
                </Aviso>
              )}
              {rodada.qualidadePendente && <Aviso>A base de acordos tem pendências a corrigir. O relatório de qualidade dos acordos foi gerado nesta rodada.</Aviso>}
              <div className="grid grid-cols-3 gap-3">
                <Indicador titulo="Acima do acordo" valor={inteiro.format(rodada.acima)} detalhe={`${rs(rodada.difAcima)} pagos a mais`} />
                <Indicador titulo="Abaixo do acordo" valor={inteiro.format(rodada.abaixo)} detalhe={`${rs(Math.abs(Number(rodada.difAbaixo)))} abaixo do acordo`} />
                <Indicador titulo="Linhas comparáveis" valor={inteiro.format(resumo.totalElegivel ?? 0)} detalhe={`${inteiro.format(resumo.conformes ?? 0)} conformes · ${inteiro.format(resumo.semAcordo ?? 0)} sem acordo`} />
              </div>
              <TabelaPadrao
                contador={`${inteiro.format(filtradas.length)} ${filtradas.length === 1 ? 'registro' : 'registros'} · diferença ${rs(difFiltro)}${filtradas.length > LIMITE_TELA ? ` · mostrando os primeiros ${LIMITE_TELA}; baixe a planilha para ver todos` : ''}`}
                vazio={!filtradas.length ? <p className="p-4 text-sm text-muted-foreground">{linhas.length ? 'Nenhum registro com esses filtros.' : 'Nenhum registro fora do acordo nesta rodada.'}</p> : undefined}
              >
                <TableHeader><TableRow>
                  {['Data', 'OS', 'Criador', 'Cidade', 'Fornecedor', 'Modelo', 'Item'].map(t => <TableHead key={t} style={LARGURA[t] ? { width: LARGURA[t] } : undefined}>{t}</TableHead>)}
                  {['Qtd', 'Preço OS', 'Preço acordo', 'Dif. unit.', 'Dif. total'].map(t => <TableHead key={t} className="patio-num text-right" style={{ width: LARGURA[t] }}>{t}</TableHead>)}
                  <TableHead style={{ width: LARGURA['Situação'] }}>Situação</TableHead>
                </TableRow></TableHeader>
                <TableBody>{filtradas.slice(0, LIMITE_TELA).map((l, i) => (
                  <TableRow key={`${l.os}-${l.item}-${i}`}>
                    <TableCell className={NUM}>{dataBr(l.data)}</TableCell>
                    <TableCell className={NUM}>{l.os ?? '—'}</TableCell>
                    <TableCell className="truncate" title={l.criador ?? ''}>{l.criador ?? '—'}</TableCell>
                    <TableCell>{l.cidade ?? '—'}</TableCell>
                    <TableCell>{l.fornecedor ?? '—'}</TableCell>
                    <TableCell className="truncate" title={l.modelo ?? ''}>{l.modelo ?? '—'}</TableCell>
                    <TableCell>{l.item ?? '—'}</TableCell>
                    <TableCell className={`${NUM} text-right`}>{l.qtd === null ? '—' : Number(l.qtd).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className={`${NUM} text-right`}>{rs(l.precoOs)}</TableCell>
                    <TableCell className={`${NUM} text-right`}>{rs(l.precoAcordo)}</TableCell>
                    <TableCell className={`${NUM} text-right`}>{rs(l.difUnit)}</TableCell>
                    <TableCell className={`${NUM} text-right font-medium`}>{rs(l.difTotal)}</TableCell>
                    <TableCell><span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${SITUACAO[l.status]?.classe ?? ''}`}>{SITUACAO[l.status]?.rotulo ?? l.status}</span></TableCell>
                  </TableRow>
                ))}</TableBody>
              </TabelaPadrao>
            </>
          )}
        </>
      )}
    </div>
  );
}

type Pessoa = { id: string; name: string; email: string; role: string; recebe: boolean; podeLer: boolean };

export function DestinatariosAlertas({ busy, run }: { busy: boolean; run: (acao: () => Promise<unknown>, mensagem?: string) => unknown }) {
  const [usuarios, setUsuarios] = useState<Pessoa[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState('');

  const carregar = useCallback(async (signal?: AbortSignal) => {
    const dados = (await api('/api/alertas/destinatarios', { signal })) as { usuarios: Pessoa[] };
    if (signal?.aborted) return;
    setUsuarios(dados.usuarios);
    setMarcados(new Set(dados.usuarios.filter(u => u.recebe).map(u => u.id)));
    setErro('');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void carregar(controller.signal).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    });
    return () => controller.abort();
  }, [carregar]);

  if (erro && !usuarios) return <FalhaDeCarregamento erro={erro} tentar={() => void carregar().catch(falha => setErro(errorText(falha)))} />;
  if (!usuarios) return <Loading label="Carregando destinatários…" compact />;

  const pendentes = usuarios.filter(u => u.recebe !== marcados.has(u.id)).length;
  const alternar = (id: string, marcar: boolean) => setMarcados(atual => {
    const proximo = new Set(atual);
    if (marcar) proximo.add(id); else proximo.delete(id);
    return proximo;
  });
  const salvar = () => run(async () => {
    await api('/api/alertas/destinatarios', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarios: [...marcados] }) });
    await carregar();
  }, 'Destinatários dos alertas salvos.');
  // Quem le a aba primeiro; sem leitura, so aparece para poder ser retirado.
  const visiveis = usuarios.filter(u => u.podeLer || u.recebe);

  return (
    <div className="patio-page space-y-4">
      <LinhaDeAba actions={<>
        {pendentes > 0 && <Button variant="outline" disabled={busy} onClick={() => setMarcados(new Set(usuarios.filter(u => u.recebe).map(u => u.id)))}>Descartar</Button>}
        <Button variant="create" disabled={busy || !pendentes} onClick={() => void salvar()}><Save /> Salvar{pendentes ? ` (${pendentes})` : ''}</Button>
      </>} />
      <p className="text-xs text-muted-foreground">
        Quem está marcado recebe um aviso na Central a cada nova rodada. Só aparecem aqui os usuários com leitura na aba Alertas (ajuste em Administração › Permissões).
      </p>
      <TabelaPadrao contador={`${marcados.size} de ${visiveis.length} usuários recebem o aviso${pendentes ? ` · ${pendentes} alteração(ões) não salva(s)` : ''}`}
        vazio={!visiveis.length ? <p className="p-4 text-sm text-muted-foreground">Nenhum usuário tem leitura na aba Alertas.</p> : undefined}>
        <TableHeader><TableRow>
          <TableHead style={{ width: 48 }}><span className="sr-only">Recebe aviso</span></TableHead>
          <TableHead>Usuário</TableHead><TableHead>E-mail</TableHead><TableHead>Perfil</TableHead><TableHead>Situação</TableHead>
        </TableRow></TableHeader>
        <TableBody>{visiveis.map(u => (
          <TableRow key={u.id}>
            <TableCell>
              <Checkbox aria-label={`${u.name} recebe o aviso dos alertas`} checked={marcados.has(u.id)} disabled={busy || (!u.podeLer && !marcados.has(u.id))}
                onCheckedChange={valor => alternar(u.id, valor === true)} />
            </TableCell>
            <TableCell className="font-medium">{u.name}</TableCell>
            <TableCell className="text-muted-foreground">{u.email}</TableCell>
            <TableCell>{roleName(u.role)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{u.podeLer ? 'Lê a aba' : 'Sem leitura: não recebe até voltar a ler'}</TableCell>
          </TableRow>
        ))}</TableBody>
      </TabelaPadrao>
    </div>
  );
}
