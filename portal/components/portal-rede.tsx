'use client';
import { useCallback, useEffect, useState } from 'react';
import { EyeOff, RefreshCw, RotateCcw } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { TabelaPadrao } from './tela-padrao';
import { SearchSelect } from '@/components/search-select';
import { SearchMultiSelect } from '@/components/search-multi-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { dataHoraSolicitacao } from '@/lib/solicitacoes-cliente';
import { type AnyRow, Field, Loading, FalhaDeCarregamento, PaginacaoDeLista, cnpj } from './portal-presentation';

// Mesmos valores aceitos pela API (lib/rede.ts); repetidos aqui para a tela
// nao carregar a tabela de municipios no navegador.
const RAIOS = [50, 100, 200, 300];
const inteiro = new Intl.NumberFormat('pt-BR');
const dataBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
const plural = (n: number, um: string, varios: string) => `${inteiro.format(n)} ${n === 1 ? um : varios}`;
type Executar = (acao: () => Promise<unknown>, mensagem?: string) => unknown;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

function SeloAcordo({ acordos }: { acordos: string[] }) {
  if (!acordos.length) return null;
  return <span className="patio-status patio-status-done" title={`Acordo ${acordos.join(', ')}`}>
    Acordo {acordos[0]}{acordos.length > 1 ? ` +${acordos.length - 1}` : ''}
  </span>;
}

export function Rede({ podeGerenciar, busy, run }: { podeGerenciar: boolean; busy: boolean; run: Executar }) {
  const [cidades, setCidades] = useState<{ id: string; name: string }[]>([]);
  const [cidade, setCidade] = useState(''), [raio, setRaio] = useState(100), [segmentos, setSegmentos] = useState<string[]>([]);
  const [texto, setTexto] = useState(''), [termo, setTermo] = useState(''), [soAcordo, setSoAcordo] = useState(false);
  const [pagina, setPagina] = useState(1), [versao, setVersao] = useState(0);
  const [dados, setDados] = useState<AnyRow | null>(null), [erro, setErro] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void api('/api/rede/cidades', { signal: controller.signal })
      .then((r: AnyRow) => { if (!controller.signal.aborted) setCidades(r.cidades); })
      .catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const espera = setTimeout(() => { setTermo(texto.trim()); setPagina(1); }, 300);
    return () => clearTimeout(espera);
  }, [texto]);
  useEffect(() => {
    const params = new URLSearchParams({ pagina: String(pagina) });
    if (cidade) { params.set('cidade', cidade); params.set('raio', String(raio)); }
    for (const s of segmentos) params.append('segmento', s);
    if (termo) params.set('q', termo);
    if (soAcordo) params.set('acordo', '1');
    const controller = new AbortController();
    void api(`/api/rede?${params}`, { signal: controller.signal })
      .then((r: AnyRow) => { if (!controller.signal.aborted) { setDados(r); setErro(''); } })
      .catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    return () => controller.abort();
  }, [cidade, raio, segmentos, termo, soAcordo, pagina, versao]);

  if (erro && !dados) return <FalhaDeCarregamento erro={erro} tentar={() => setVersao(v => v + 1)} />;
  const filtrar = (aplicar: () => void) => { aplicar(); setPagina(1); };
  const desconsiderar = (l: AnyRow) => {
    const motivo = window.prompt(`Desconsiderar ${l.nome} na Rede? Ele deixa de aparecer para todos.\n\nMotivo (opcional):`, '');
    if (motivo === null) return;
    void run(async () => {
      await api('/api/rede/exclusoes/fornecedores', json({ codigo: l.codigo, motivo }));
      setVersao(v => v + 1);
    }, 'Fornecedor desconsiderado na Rede.');
  };
  const linhas = (dados?.linhas ?? []) as AnyRow[];
  const centro = dados?.cidade as AnyRow | null;
  const contador = !dados ? '' : centro
    ? `${plural(dados.naCidade, 'fornecedor', 'fornecedores')} em ${centro.nome} · ${plural(dados.proximas, 'em cidade próxima', 'em cidades próximas')} (até ${dados.raio} km)`
    : plural(dados.total, 'fornecedor', 'fornecedores');
  const colunas = 6 + (centro ? 1 : 0) + (podeGerenciar ? 1 : 0);

  return (
    <div className="patio-page space-y-4">
      <LinhaDeAba actions={<Button variant="outline" size="icon" aria-label="Atualizar" title="Atualizar" onClick={() => setVersao(v => v + 1)}><RefreshCw /></Button>} />
      <Card className="overflow-hidden">
        <CardContent className="patio-rede-filters">
          <SearchSelect label="Cidade" value={cidade} options={cidades} limit={60} onChange={v => filtrar(() => setCidade(v))} />
          <Field label="Raio">
            <NativeSelect value={String(raio)} disabled={!cidade} onChange={e => filtrar(() => setRaio(Number(e.target.value)))}>
              {RAIOS.map(r => <NativeSelectOption key={r} value={String(r)}>{`${r} km`}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <SearchMultiSelect label="Segmentos" value={segmentos} onChange={v => filtrar(() => setSegmentos(v))}
            options={((dados?.segmentos ?? []) as AnyRow[]).map(s => ({ id: s.nome, name: `${s.nome} (${inteiro.format(s.total)})` }))}
            selectedOptions={segmentos.map(s => ({ id: s, name: s }))} />
          <Field label="Buscar"><Input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Nome, razão social ou CNPJ" /></Field>
          <div className="patio-rede-check"><Checkbox aria-labelledby="rede-so-acordo" checked={soAcordo} onCheckedChange={v => filtrar(() => setSoAcordo(v === true))} /><span id="rede-so-acordo">Só com acordo</span></div>
        </CardContent>
      </Card>
      {erro && <p role="alert" className="text-sm">{erro}</p>}
      {!dados ? <Loading label="Carregando fornecedores…" compact /> : !dados.atualizacao ? (
        <p className="text-sm text-muted-foreground">A lista de fornecedores ainda não foi carregada do Qlik. Ela chega com a primeira execução diária do Alertas.</p>
      ) : (
        <>
          <TabelaPadrao contador={contador} pagina={<PaginacaoDeLista pagina={dados.pagina} paginas={dados.paginas} alterar={setPagina} />}
            vazio={!linhas.length ? <p className="p-6 text-center text-muted-foreground">{centro ? `Nenhum fornecedor em ${centro.nome} nem a até ${dados.raio} km com esses filtros.` : 'Nenhum fornecedor com esses filtros.'}</p> : undefined}>
            <TableHeader><TableRow>
              <TableHead>Fornecedor</TableHead>
              <TableHead style={{ width: 180 }}>Cidade</TableHead>
              {centro && <TableHead className="patio-num text-right" style={{ width: 90 }}>Distância</TableHead>}
              <TableHead style={{ width: '20%' }}>Segmentos</TableHead>
              <TableHead style={{ width: 190 }}>Contato</TableHead>
              <TableHead style={{ width: 150 }}>CNPJ</TableHead>
              <TableHead style={{ width: 104 }}>Último pedido</TableHead>
              {podeGerenciar && <TableHead style={{ width: 48 }}><span className="sr-only">Ações</span></TableHead>}
            </TableRow></TableHeader>
            <TableBody>{linhas.flatMap((l, i) => {
              // Faixa de secao quando muda de "na cidade" para "proximas" (e no topo da pagina).
              const secao = centro && (i === 0 || linhas[i - 1].mesmaCidade !== l.mesmaCidade) ? [
                <TableRow key={`secao-${l.mesmaCidade ? 'cidade' : 'proximas'}`} className="bg-muted/60 hover:bg-muted/60">
                  <TableCell colSpan={colunas} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {l.mesmaCidade ? `Em ${centro.nome}` : `Cidades próximas · até ${dados.raio} km`}
                  </TableCell>
                </TableRow>,
              ] : [];
              return [...secao,
                <TableRow key={l.codigo}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{l.nome}</span><SeloAcordo acordos={l.acordos} /></div>
                    {l.razaoSocial && <div className="truncate text-xs text-muted-foreground" title={l.razaoSocial}>{l.razaoSocial}</div>}
                  </TableCell>
                  <TableCell>{l.cidade ? `${l.cidade}${l.uf ? `/${l.uf}` : ''}` : '—'}</TableCell>
                  {centro && <TableCell className="patio-num text-right tabular-nums">{l.mesmaCidade ? '—' : `~${inteiro.format(l.distanciaKm)} km`}</TableCell>}
                  <TableCell className="truncate text-xs" title={l.segmentos.join(' · ')}>{l.segmentos.join(' · ') || '—'}</TableCell>
                  <TableCell>
                    <div className="truncate" title={l.telefone ?? ''}>{l.telefone ?? '—'}</div>
                    {l.email && <div className="truncate text-xs text-muted-foreground" title={l.email}>{l.email}</div>}
                  </TableCell>
                  <TableCell className="patio-num tabular-nums">{l.cnpj ? cnpj(l.cnpj) : '—'}</TableCell>
                  <TableCell className="patio-num tabular-nums">{dataBr(l.ultimoPedido)}</TableCell>
                  {podeGerenciar && <TableCell>
                    <Button variant="ghost" size="icon" disabled={busy} aria-label={`Desconsiderar ${l.nome}`} title="Desconsiderar na Rede" onClick={() => desconsiderar(l)}><EyeOff /></Button>
                  </TableCell>}
                </TableRow>,
              ];
            })}</TableBody>
          </TabelaPadrao>
          <p className="text-xs text-muted-foreground">
            Lista do ERP atualizada em {dataHoraSolicitacao(dados.atualizacao.recebidaEm)}{centro ? ' · distâncias em linha reta' : ''}
          </p>
        </>
      )}
    </div>
  );
}

export function RedeDesconsiderados({ busy, run }: { busy: boolean; run: Executar }) {
  const [dados, setDados] = useState<AnyRow | null>(null), [erro, setErro] = useState(''), [segmento, setSegmento] = useState('');
  const carregar = useCallback(async (signal?: AbortSignal) => {
    const r = await api('/api/rede/exclusoes', { signal });
    if (signal?.aborted) return;
    setDados(r); setErro('');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void carregar(controller.signal).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    });
    return () => controller.abort();
  }, [carregar]);

  if (erro && !dados) return <FalhaDeCarregamento erro={erro} tentar={() => void carregar().catch(falha => setErro(errorText(falha)))} />;
  if (!dados) return <Loading label="Carregando desconsiderados…" compact />;
  const fornecedores = dados.fornecedores as AnyRow[], segmentos = dados.segmentos as AnyRow[], semCoordenada = dados.semCoordenada as AnyRow[];
  const fora = new Set(segmentos.map(s => s.segmento));
  const opcoes = (dados.todosSegmentos as AnyRow[]).filter(s => !fora.has(s.nome)).map(s => ({ id: s.nome, name: `${s.nome} (${inteiro.format(s.total)})` }));
  const excluirSegmento = () => void run(async () => {
    await api('/api/rede/exclusoes/segmentos', json({ segmento }));
    setSegmento('');
    await carregar();
  }, 'Segmento desconsiderado na Rede.');
  const reativar = (tipo: 'fornecedores' | 'segmentos', chave: string, valor: string) => void run(async () => {
    await api(`/api/rede/exclusoes/${tipo}?${new URLSearchParams({ [chave]: valor })}`, { method: 'DELETE' });
    await carregar();
  }, 'Volta a aparecer na Rede.');
  const quando = (r: AnyRow) => `${r.por ?? '—'} · ${dataHoraSolicitacao(r.criadoEm)}`;

  return (
    <div className="patio-page space-y-4">
      <LinhaDeAba actions={<div className="flex items-end gap-2">
        <div className="w-80"><SearchSelect label="Segmento" value={segmento} options={opcoes} onChange={setSegmento} /></div>
        <Button variant="outline" disabled={busy || !segmento} onClick={excluirSegmento}><EyeOff /> Desconsiderar segmento</Button>
      </div>} />
      {erro && <p role="alert" className="text-sm">{erro}</p>}
      <TabelaPadrao contador={`Segmentos desconsiderados · ${segmentos.length}`}
        vazio={!segmentos.length ? <p className="p-4 text-sm text-muted-foreground">Nenhum segmento desconsiderado.</p> : undefined}>
        <TableHeader><TableRow><TableHead>Segmento</TableHead><TableHead className="patio-num text-right" style={{ width: 120 }}>Fornecedores</TableHead><TableHead style={{ width: 280 }}>Desconsiderado por</TableHead><TableHead style={{ width: 120 }}><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
        <TableBody>{segmentos.map(s => <TableRow key={s.segmento}>
          <TableCell className="font-medium">{s.segmento}</TableCell>
          <TableCell className="patio-num text-right tabular-nums">{inteiro.format(s.fornecedores)}</TableCell>
          <TableCell className="text-xs text-muted-foreground">{quando(s)}</TableCell>
          <TableCell><Button variant="ghost" disabled={busy} onClick={() => reativar('segmentos', 'segmento', s.segmento)}><RotateCcw /> Reativar</Button></TableCell>
        </TableRow>)}</TableBody>
      </TabelaPadrao>
      <TabelaPadrao contador={`Fornecedores desconsiderados · ${fornecedores.length}`}
        vazio={!fornecedores.length ? <p className="p-4 text-sm text-muted-foreground">Nenhum fornecedor desconsiderado. Use o botão ao lado de cada fornecedor na aba Disponíveis.</p> : undefined}>
        <TableHeader><TableRow><TableHead style={{ width: 90 }}>Código</TableHead><TableHead>Fornecedor</TableHead><TableHead>Motivo</TableHead><TableHead style={{ width: 280 }}>Desconsiderado por</TableHead><TableHead style={{ width: 120 }}><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
        <TableBody>{fornecedores.map(f => <TableRow key={f.codigo}>
          <TableCell className="patio-num tabular-nums">{f.codigo}</TableCell>
          <TableCell><span className="font-medium">{f.nome}</span>{!f.presente && <span className="ml-2 text-xs text-muted-foreground">fora da lista atual do ERP</span>}</TableCell>
          <TableCell className="text-sm">{f.motivo ?? '—'}</TableCell>
          <TableCell className="text-xs text-muted-foreground">{quando(f)}</TableCell>
          <TableCell><Button variant="ghost" disabled={busy} onClick={() => reativar('fornecedores', 'codigo', f.codigo)}><RotateCcw /> Reativar</Button></TableCell>
        </TableRow>)}</TableBody>
      </TabelaPadrao>
      {semCoordenada.length > 0 && <TabelaPadrao contador={`Cidades sem coordenada · aparecem na busca por nome, não na busca por cidade · ${semCoordenada.length}`}>
        <TableHeader><TableRow><TableHead>Cidade no ERP</TableHead><TableHead style={{ width: 80 }}>UF</TableHead><TableHead className="patio-num text-right" style={{ width: 120 }}>Fornecedores</TableHead></TableRow></TableHeader>
        <TableBody>{semCoordenada.map(c => <TableRow key={`${c.cidade}|${c.uf}`}>
          <TableCell>{c.cidade ?? '(vazia)'}</TableCell><TableCell>{c.uf ?? '—'}</TableCell>
          <TableCell className="patio-num text-right tabular-nums">{inteiro.format(c.total)}</TableCell>
        </TableRow>)}</TableBody>
      </TabelaPadrao>}
    </div>
  );
}
