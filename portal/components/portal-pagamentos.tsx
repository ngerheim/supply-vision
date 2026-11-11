'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, baixarArquivo, errorText } from '@/lib/api';
import { pode } from '@/lib/permissoes';
import { gerarChaveRelatorio } from '@/lib/relatorios';
import { exibirDataBrasileira } from '@/lib/data-brasileira';
import { dataHoraSolicitacao } from '@/lib/solicitacoes-cliente';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CampoData } from './campo-data';
import { PageHeader, LinhaDeAba } from './page-header';
import { BarraFiltros, TabelaPadrao } from './tela-padrao';
import { TableBody, TableCell, TableHeader, TableHead, TableRow } from '@/components/ui/table';
import { Plaquinha } from './plaquinha';
import { Status } from './status';
import { Card, CardContent } from '@/components/ui/card';
import { type AnyRow, Field, Loading, PaginacaoDeLista } from './portal-presentation';

const estado: Record<string, string> = {
  aberta: 'Aberta', em_analise: 'Em análise', paga: 'Paga', recusada: 'Recusada',
};
const tamanho = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
function assinado(file: File, tipo: string) {
  return file.arrayBuffer().then((buf) => {
    const b = new Uint8Array(buf);
    const pdf = new TextDecoder().decode(b.slice(0, 5)) === '%PDF-';
    const jpg = b[0] === 255 && b[1] === 216 && b[2] === 255;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x);
    const xml = tipo === 'nf' && /^\s*(?:<\?xml\b|<)/i.test(new TextDecoder().decode(b.slice(0, 256)));
    return pdf || jpg || png || xml;
  });
}
type Arquivos = { oc: File[]; nf: File[] };
const ROTULO = { oc: 'Ordem de compra', nf: 'Nota fiscal' } as const;
// Mesmos limites do servidor (lib/pagamentos-schema.ts): conferir antes evita enviar 10 MB a toa.
async function conferirArquivos(arquivos: Arquivos): Promise<string> {
  const todos = [...arquivos.oc.map((f) => ['oc', f] as const), ...arquivos.nf.map((f) => ['nf', f] as const)];
  if (todos.length > 10) return 'Envie no máximo 10 arquivos de cada vez.';
  if (todos.some(([, f]) => f.size > 5 * 1024 * 1024) || todos.reduce((t, [, f]) => t + f.size, 0) > 10 * 1024 * 1024) return 'Cada anexo pode ter até 5 MB e o total até 10 MB por envio.';
  for (const [tipo, f] of todos) if (!(await assinado(f, tipo))) return `Formato inválido em ${f.name}. Use PDF, JPEG ou PNG; para NF, XML também é aceito.`;
  return '';
}
function formularioArquivos(arquivos: Arquivos) {
  const form = new FormData();
  for (const tipo of ['oc', 'nf'] as const) for (const f of arquivos[tipo]) form.append(tipo, f);
  return form;
}
// Campo de arquivos de um tipo, com a lista do que foi escolhido.
// Funcao (nao componente) para os campos ficarem na mesma arvore da tela.
function campoArquivos(tipo: 'oc' | 'nf', arquivos: File[], alterar: (f: File[]) => void, obrigatorio = false) {
  return <Field key={tipo} label={ROTULO[tipo]}><Input id={`pag-arquivo-${tipo}`} aria-label={ROTULO[tipo]} required={obrigatorio && !arquivos.length} multiple type="file"
    accept={tipo === 'nf' ? '.pdf,.jpg,.jpeg,.png,.xml' : '.pdf,.jpg,.jpeg,.png'} onChange={(e) => alterar(Array.from(e.target.files || []))} />
    {arquivos.map((f) => <small key={`${f.name}-${f.size}`} className="block text-muted-foreground">{f.name} · {tamanho(f.size)}</small>)}</Field>;
}
function dataBr(iso: unknown) {
  const valor = typeof iso === 'string' ? iso : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? exibirDataBrasileira(valor) : valor || '—';
}
export function Pagamentos({ user, initialDetail, onOpen }: { user: AnyRow; initialDetail?: string | null; onOpen: (id: string | null) => void }) {
  const [novo, setNovo] = useState(false);
  if (initialDetail) return <Detalhe id={initialDetail} user={user} onBack={() => onOpen(null)} />;
  if (novo) return <Formulario onCancel={() => setNovo(false)} onOpen={onOpen} />;
  return <Lista onNew={() => setNovo(true)} onOpen={onOpen} />;
}
export function Lista({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const [dados, setDados] = useState<AnyRow | null>(null), [erro, setErro] = useState(''), [status, setStatus] = useState(''), [busca, setBusca] = useState(''), [de, setDe] = useState(''), [ate, setAte] = useState(''), [pagina, setPagina] = useState(1), [versao, setVersao] = useState(0);
  const carregar = useCallback(() => {
    const q = new URLSearchParams({ page: String(pagina) });
    if (status) q.set('status', status); if (busca) q.set('busca', busca); if (de) q.set('de', de); if (ate) q.set('ate', ate);
    void api(`/api/pagamentos?${q}`).then(setDados).catch((e) => setErro(errorText(e)));
  }, [status, busca, de, ate, pagina]);
  useEffect(carregar, [carregar, versao]);
  const filtro = (set: (v: string) => void) => (v: string) => { set(v); setPagina(1); setDados(null); setErro(''); };
  return <div className="patio-page"><LinhaDeAba actions={<><Button variant="outline" onClick={() => {setErro('');setVersao(v => v + 1)}}>Atualizar</Button><Button variant="create" onClick={onNew}>Nova solicitação</Button></>} />
    <BarraFiltros busca={busca} onBusca={filtro(setBusca)} placeholder="Pesquisar"><select aria-label="Situação" className="rounded-md border bg-background p-2" value={status} onChange={(e) => filtro(setStatus)(e.target.value)}><option value="">Todas as situações</option>{Object.entries(estado).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><CampoData aria-label="Período: De" value={de} onChange={filtro(setDe)} /><CampoData aria-label="Período: Até" value={ate} onChange={filtro(setAte)} /></BarraFiltros>
    {erro && <p role="alert">{erro}</p>}{!dados ? <Loading label="Carregando pagamentos…" /> : <TabelaPadrao contador={`${dados.total ?? (dados.pagamentos || []).length} ${(dados.total ?? (dados.pagamentos || []).length) === 1 ? 'pagamento' : 'pagamentos'}`} pagina={<PaginacaoDeLista pagina={dados.page} paginas={dados.pageCount} alterar={setPagina} />}><TableHeader><TableRow>{['Código','Solicitante','Link','Situação','Aberta em'].map(t=><TableHead key={t}>{t}</TableHead>)}</TableRow></TableHeader><TableBody>{(dados.pagamentos || []).map((p: AnyRow)=><TableRow key={p.id}><TableCell><button className="text-link hover:underline" onClick={()=>onOpen(p.id)}><Plaquinha>{p.codigo}</Plaquinha></button></TableCell><TableCell>{p.solicitante || '—'}</TableCell><TableCell className="max-w-md truncate">{p.link ? <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-link hover:underline" title={p.link}>{p.link}</a> : (p.fornecedor || '—')}</TableCell><TableCell><Status value={p.status}>{estado[p.status]}</Status></TableCell><TableCell>{p.criado_em ? dataHoraSolicitacao(p.criado_em) : '—'}</TableCell></TableRow>)}</TableBody></TabelaPadrao>}
  </div>;
}
export function Formulario({ onCancel, onOpen }: { onCancel: () => void; onOpen: (id: string) => void }) {
  const [link, setLink] = useState('');
  const [arquivos, setArquivos] = useState<Arquivos>({ oc: [], nf: [] });
  const [erro, setErro] = useState(''), [busy, setBusy] = useState(false);
  const tentativa = useRef({ corpo: '', chave: '' });
  const salvar = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault(); setErro('');
    if (!arquivos.oc.length || !arquivos.nf.length) { setErro('Anexe a ordem de compra e a nota fiscal.'); return; }
    const problema = await conferirArquivos(arquivos);
    if (problema) { setErro(problema); return; }
    setBusy(true);
    try {
      const identidadeArquivo = async (file: File) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return `${file.name}:${file.type}:${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
      };
      const corpo = JSON.stringify({ link, oc: await Promise.all(arquivos.oc.map(identidadeArquivo)), nf: await Promise.all(arquivos.nf.map(identidadeArquivo)) });
      if (tentativa.current.corpo !== corpo) tentativa.current = { corpo, chave: gerarChaveRelatorio() };
      const form = formularioArquivos(arquivos);
      form.set('link', link.trim());
      const result = await api<AnyRow>('/api/pagamentos', { method: 'POST', headers: { 'idempotency-key': tentativa.current.chave }, body: form });
      tentativa.current = { corpo: '', chave: '' }; onOpen(result.id);
    } catch (e) { setErro(errorText(e)); } finally { setBusy(false); }
  };
  return <div className="patio-page"><h1 className="sr-only">Nova solicitação</h1><form onSubmit={salvar} className="space-y-4"><Card><CardContent className="grid gap-4 p-5 md:grid-cols-2">
    <Field label="Link" className="md:col-span-2"><Input id="pag-link" aria-label="Link" required type="url" maxLength={500} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} /></Field>
    {(['oc', 'nf'] as const).map((k) => campoArquivos(k, arquivos[k], (f) => setArquivos((x) => ({ ...x, [k]: f })), true))}
  </CardContent></Card>{erro && <p role="alert">{erro}</p>}<div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar solicitação'}</Button><Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button></div></form></div>;
}
export function Detalhe({ id, user, onBack }: { id: string; user: AnyRow; onBack: () => void }) {
  const [dados, setDados] = useState<AnyRow | null>(null), [erro, setErro] = useState(''), [motivo, setMotivo] = useState(''), [busy, setBusy] = useState(false);
  const tentativa = useRef({ corpo: '', chave: '' }), trava = useRef(false);
  const [novos, setNovos] = useState<Arquivos>({ oc: [], nf: [] }), [geracao, setGeracao] = useState(0);
  const carregar = () => void api(`/api/pagamentos/${id}`).then(setDados).catch((e) => setErro(errorText(e)));
  useEffect(carregar, [id]);
  if (!dados) return <div>{erro || <Loading label="Carregando solicitações de pagamento…" />}</div>;
  const p = dados.pagamento as AnyRow, atende = pode(user, 'pagamento:atender');
  const podeAnexar = ['aberta', 'em_analise'].includes(p.status) && (atende || p.solicitante_id === user.id);
  const transicionar = async (para: string) => {
    if (trava.current) return;
    const body = { para, texto: motivo, expectedRevision: p.revision }, corpo = JSON.stringify(body);
    if (tentativa.current.corpo !== corpo) tentativa.current = { corpo, chave: gerarChaveRelatorio() };
    trava.current = true; setBusy(true); setErro('');
    try {
      await api(`/api/pagamentos/${id}/transicao`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': tentativa.current.chave }, body: corpo });
      tentativa.current = { corpo: '', chave: '' }; setMotivo(''); carregar();
    } catch (e) { setErro(errorText(e)); } finally { trava.current = false; setBusy(false); }
  };
  const anexar = async () => {
    if (trava.current) return;
    if (!novos.oc.length && !novos.nf.length) { setErro('Escolha pelo menos um arquivo.'); return; }
    const problema = await conferirArquivos(novos);
    if (problema) { setErro(problema); return; }
    trava.current = true; setBusy(true); setErro('');
    try {
      await api(`/api/pagamentos/${id}/anexos`, { method: 'POST', body: formularioArquivos(novos) });
      setNovos({ oc: [], nf: [] }); setGeracao((n) => n + 1); carregar();
    } catch (e) { setErro(errorText(e)); } finally { trava.current = false; setBusy(false); }
  };
  return <div className="space-y-5"><PageHeader title={p.fornecedor ? `${p.codigo} · ${p.fornecedor}` : p.codigo} actions={<Button variant="outline" onClick={onBack}>Voltar</Button>} /><Card><CardContent className="grid gap-4 p-5 md:grid-cols-2">{([['Situação', estado[p.status]], ['Solicitante', p.solicitante], ['Aberta em', p.criado_em ? dataHoraSolicitacao(p.criado_em) : ''], ['CNPJ', p.cnpj], ['OC', p.numero_oc], ['NF', p.numero_nf], ['Valor', p.valor_centavos ? `R$ ${(p.valor_centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''], ['Vencimento', p.vencimento ? dataBr(p.vencimento) : ''], ['Observação', p.observacao]] as [string, string | undefined][]).filter(([l, v]) => v || ['Situação', 'Solicitante'].includes(l)).map(([l, v]) => <Field key={l} label={l}>{v || '—'}</Field>)}{p.link && <a href={p.link} target="_blank" rel="noopener noreferrer" className="underline">Abrir link</a>}{(dados.anexos || []).map((a: AnyRow) => <Button key={a.id} variant="outline" onClick={() => void baixarArquivo(`/api/pagamentos/${id}/anexos/${a.id}`, a.nome_arquivo)}>Baixar {a.tipo === 'oc' ? 'OC' : 'NF'} · {a.nome_arquivo}</Button>)}</CardContent></Card>
    {podeAnexar && <Card><CardContent key={geracao} className="grid gap-4 p-5 md:grid-cols-2"><h2 className="font-semibold md:col-span-2">Incluir arquivos</h2>
      {(['oc', 'nf'] as const).map((k) => campoArquivos(k, novos[k], (f) => setNovos((x) => ({ ...x, [k]: f }))))}
      <div className="md:col-span-2"><Button disabled={busy || (!novos.oc.length && !novos.nf.length)} onClick={() => void anexar()}>{busy ? 'Enviando…' : 'Anexar arquivos'}</Button></div></CardContent></Card>}{erro && <p role="alert">{erro}</p>}{atende && <div className="flex flex-wrap gap-2">{p.status === 'aberta' && <Button disabled={busy} onClick={() => void transicionar('em_analise')}>Iniciar análise</Button>}{p.status === 'em_analise' && <><Button disabled={busy} onClick={() => void transicionar('paga')}>Marcar paga</Button><Input aria-label="Motivo da recusa" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo obrigatório" /><Button disabled={busy} variant="destructive" onClick={() => void transicionar('recusada')}>Recusar</Button></>}</div>}<section><h2 className="font-semibold">Andamentos</h2>{(dados.andamentos || []).map((a: AnyRow) => <p key={a.id} className="border-b py-2">{a.criado_em ? dataHoraSolicitacao(a.criado_em) : '—'} · {a.usuario}: {a.texto || estado[a.para_status]}</p>)}</section></div>;
}
