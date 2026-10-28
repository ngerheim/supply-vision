"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiError, errorText } from "@/lib/api";
import { pode } from "@/lib/permissoes";
import { corpoJson } from "@/lib/solicitacoes-cliente";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "./page-header";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  type AnyRow,
  Field,
  Loading,
  FalhaDeCarregamento,
} from "./portal-presentation";

export function Estoques() {
  const [rows, setRows] = useState<AnyRow[] | null>(null),
    [erro, setErro] = useState(""),
    [falha, setFalha] = useState("");
  const [versao, setVersao] = useState(0),
    [busy, setBusy] = useState(false),
    [nome, setNome] = useState(""),
    [editando, setEditando] = useState<AnyRow | null>(null);
  const trava = useRef(false),
    sequencia = useRef(0);
  useEffect(() => {
    const atual = ++sequencia.current,
      controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setFalha("");
        setRows(null);
      }
    });
    void api("/api/estoques", { signal: controller.signal })
      .then((x) => {
        if (atual === sequencia.current && !controller.signal.aborted)
          setRows(x.estoques);
      })
      .catch((e) => {
        if (atual === sequencia.current && !controller.signal.aborted)
          setFalha(errorText(e));
      });
    return () => {
      controller.abort();
      sequencia.current = atual + 1;
    };
  }, [versao]);
  const salvar = async (row: AnyRow | null, body: AnyRow) => {
    if (trava.current) return;
    trava.current = true;
    setBusy(true);
    setErro("");
    const atual = sequencia.current;
    try {
      await api(
        `/api/estoques${row ? `/${encodeURIComponent(row.id)}` : ""}`,
        corpoJson(row ? "PUT" : "POST", {
          ...body,
          ...(row ? { expectedRevision: row.revision } : {}),
        }),
      );
      if (atual === sequencia.current) {
        setNome("");
        setEditando(null);
        setVersao((v) => v + 1);
      }
    } catch (e) {
      if (atual === sequencia.current)
        setErro(
          e instanceof ApiError &&
            e.details.status === 409 &&
            e.message.includes("alterado")
            ? "O estoque foi alterado; recarregue"
            : errorText(e),
        );
    } finally {
      trava.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <Button
            variant="outline"
            size="icon"
            aria-label="Recarregar"
            title="Recarregar"
            disabled={busy}
            onClick={() => {
              setEditando(null);
              setNome("");
              setErro("");
              setVersao((v) => v + 1);
            }}
          >
            <RefreshCw />
          </Button>
        }
      />
      <Card>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nome.trim()) void salvar(editando, { nome: nome.trim() });
            }}
          >
            <fieldset
              disabled={busy}
              className="flex flex-wrap items-end gap-3"
            >
              <Field label={editando ? "Renomear estoque" : "Novo estoque"}>
                <Input
                  name="nome"
                  required
                  maxLength={200}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={busy || !rows}>
                {editando ? "Salvar nome" : "Incluir"}
              </Button>
              {editando && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditando(null);
                    setNome("");
                  }}
                >
                  Cancelar
                </Button>
              )}
            </fieldset>
          </form>
        </CardContent>
      </Card>
      {erro && <p role="alert">{erro}</p>}
      <h2 className="text-lg font-semibold">Estoques</h2>
      {falha ? (
        <FalhaDeCarregamento
          erro={falha}
          tentar={() => setVersao((v) => v + 1)}
        />
      ) : !rows ? (
        <Loading label="Carregando estoques…" />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.nome}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {c.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="space-x-2">
                      <Button
                        variant="outline"
                        disabled={busy || Boolean(editando)}
                        onClick={() => {
                          setEditando(c);
                          setNome(c.nome);
                          setErro("");
                        }}
                      >
                        Renomear {c.nome}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || Boolean(editando)}
                        onClick={() => void salvar(c, { ativo: !c.ativo })}
                      >
                        {c.ativo ? "Desativar" : "Ativar"} {c.nome}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!rows.length && <p className="p-4">Nenhum estoque cadastrado.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function EntradaEstoque(){
  const tentativa=useRef<string|null>(null);
  const [estoques,setEstoques]=useState<AnyRow[]>([]),[itens,setItens]=useState<AnyRow[]>([]),[estoqueId,setEstoqueId]=useState(''),[data,setData]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())),[documento,setDocumento]=useState(''),[observacao,setObservacao]=useState(''),[busca,setBusca]=useState(''),[selecionados,setSelecionados]=useState<Record<string,string>>({}),[quantidades,setQuantidades]=useState<Record<string,string>>({}),[erro,setErro]=useState(''),[ok,setOk]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{void Promise.all([api('/api/estoques'),api('/api/catalogs/items')]).then(([e,i])=>{setEstoques(e.estoques.filter((x:AnyRow)=>x.ativo));setItens(i.itens)}).catch(e=>setErro(errorText(e)))},[]);
  const encontrados=itens.filter(i=>String(i.descricao).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().includes(busca.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase())).slice(0,20);
  const salvar=async(e:React.SyntheticEvent<HTMLFormElement>)=>{e.preventDefault();setBusy(true);setErro('');setOk('');tentativa.current??=crypto.randomUUID();try{await api('/api/estoque/entradas',{...corpoJson('POST',{estoqueId,dataMovimento:data,documento,observacao,itens:Object.entries(selecionados).filter(([,v])=>v).map(([itemId])=>({itemId,quantidade:Number(quantidades[itemId])}))}),headers:{'content-type':'application/json','idempotency-key':tentativa.current}});tentativa.current=null;setSelecionados({});setQuantidades({});setDocumento('');setObservacao('');setOk('Entrada registrada.')}catch(x){setErro(x instanceof ApiError&&x.details.status===409&&x.details.codigo==='duplicado'?'Esta entrada já foi registrada.':errorText(x))}finally{setBusy(false)}};
  return <><PageHeader/><section className="space-y-4"><h2 className="text-lg font-semibold">Entrada de estoque</h2><Card><CardContent><form onSubmit={salvar} className="space-y-4"><fieldset disabled={busy} className="flex flex-wrap items-end gap-3"><Field label="Estoque"><select className="h-10 rounded-md border px-3" required value={estoqueId} onChange={e=>setEstoqueId(e.target.value)}><option value="">Selecione</option>{estoques.map(x=><option key={x.id} value={x.id}>{x.nome}</option>)}</select></Field><Field label="Data"><Input type="date" required value={data} onChange={e=>setData(e.target.value)}/></Field><Field label="Documento"><Input maxLength={60} value={documento} onChange={e=>setDocumento(e.target.value)}/></Field><Field label="Observação"><Input maxLength={300} value={observacao} onChange={e=>setObservacao(e.target.value)}/></Field></fieldset><Field label="Buscar item no catálogo"><Input value={busca} onChange={e=>setBusca(e.target.value)}/></Field><div className="flex flex-wrap gap-2">{encontrados.map(item=><Button key={item.id} type="button" variant={selecionados[item.id]?'default':'outline'} onClick={()=>setSelecionados({...selecionados,[item.id]:selecionados[item.id]?'':item.id})}>{item.descricao} · {item.unidade}</Button>)}</div>{Object.keys(selecionados).filter(k=>selecionados[k]).map(id=><div key={id} className="flex items-end gap-2"><span>{itens.find(i=>i.id===id)?.descricao} ({itens.find(i=>i.id===id)?.unidade})</span><Field label="Quantidade"><Input type="number" min="0.01" step={itens.find(i=>i.id===id)?.unidade==='un'?'1':'0.01'} required value={quantidades[id]||''} onChange={e=>setQuantidades({...quantidades,[id]:e.target.value})}/></Field><Button type="button" variant="outline" onClick={()=>{const n={...selecionados};delete n[id];setSelecionados(n)}}>Remover</Button></div>)}{erro&&<p role="alert">{erro}</p>}{ok&&<output>{ok}</output>}<Button type="submit" disabled={busy||!Object.values(selecionados).some(Boolean)}>Registrar entrada</Button></form></CardContent></Card></section></>;
}

export function SaldoEstoque({user}:{user:AnyRow}){
  const tentativaAjuste=useRef<string|null>(null);
  const [rows,setRows]=useState<AnyRow[]>([]),[estoques,setEstoques]=useState<AnyRow[]>([]),[estoqueId,setEstoqueId]=useState(''),[q,setQ]=useState(''),[versao,setVersao]=useState(0),[historico,setHistorico]=useState<AnyRow|null>(null),[movs,setMovs]=useState<AnyRow[]>([]),[erro,setErro]=useState(''),[motivo,setMotivo]=useState(''),[selecionado,setSelecionado]=useState<AnyRow|null>(null),[busy,setBusy]=useState(false),[ajuste,setAjuste]=useState(false);
  useEffect(()=>{void Promise.all([api('/api/estoques'),api(`/api/estoque/saldos?${new URLSearchParams({...(estoqueId?{estoqueId}:{}),...(q?{q}:{})})}`)]).then(([e,s])=>{setEstoques(e.estoques);setRows(s.saldos)}).catch(e=>setErro(errorText(e)))},[versao,estoqueId,q]);
  const abrir=async(r:AnyRow)=>{setHistorico(r);setErro('');try{const x=await api(`/api/estoque/movimentos?estoqueId=${encodeURIComponent(r.estoque_id)}&itemId=${encodeURIComponent(r.item_id)}`);setMovs(x.movimentos)}catch(e){setErro(errorText(e))}};
  const fazerEstorno=async()=>{if(!selecionado||!motivo.trim())return;setBusy(true);setErro('');try{await api(`/api/estoque/movimentos/${encodeURIComponent(selecionado.id)}/estorno`,corpoJson('POST',{motivo}));setSelecionado(null);setMotivo('');setVersao(v=>v+1);if(historico)void abrir(historico)}catch(e){setErro(e instanceof ApiError&&e.details.codigo==='duplicado'?'Este movimento já foi estornado.':errorText(e))}finally{setBusy(false)}};
  const salvarAjuste=async(body:AnyRow)=>{setBusy(true);tentativaAjuste.current??=crypto.randomUUID();try{await api('/api/estoque/ajustes',{...corpoJson('POST',body),headers:{'content-type':'application/json','idempotency-key':tentativaAjuste.current}});tentativaAjuste.current=null;setAjuste(false);setVersao(v=>v+1)}catch(e){setErro(e instanceof ApiError&&e.details.status===409&&e.details.codigo==='duplicado'?'Este ajuste já foi registrado.':errorText(e))}finally{setBusy(false)}};
  return <><PageHeader/><section className="space-y-4"><div className="flex flex-wrap items-end gap-3"><h2 className="mr-auto text-lg font-semibold">Saldo de estoque</h2><Field label="Estoque"><select className="h-10 rounded-md border px-3" value={estoqueId} onChange={e=>setEstoqueId(e.target.value)}><option value="">Todos</option>{estoques.map(x=><option key={x.id} value={x.id}>{x.nome}</option>)}</select></Field><Field label="Buscar item"><Input value={q} onChange={e=>setQ(e.target.value)}/></Field>{pode(user,'estoque:gerenciar')&&<Button onClick={()=>setAjuste(!ajuste)}>Ajuste / inventário</Button>}</div>{ajuste&&<AjusteForm estoques={estoques} onSave={salvarAjuste} busy={busy}/>} {erro&&<p role="alert">{erro}</p>}<Card><CardContent><Table><TableHeader><TableRow><TableHead>Estoque</TableHead><TableHead>Item</TableHead><TableHead>Saldo</TableHead><TableHead>Unidade</TableHead></TableRow></TableHeader><TableBody>{rows.map(r=><TableRow key={`${r.estoque_id}:${r.item_id}`} className="cursor-pointer" onClick={()=>void abrir(r)}><TableCell>{r.estoque}</TableCell><TableCell>{r.descricao}</TableCell><TableCell className={r.saldo<0?'font-semibold text-red-700':''}>{r.saldo}</TableCell><TableCell>{r.unidade}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>{historico&&<Card><CardContent><h3 className="mb-3 font-semibold">Movimentações: {historico.descricao} · {historico.estoque}</h3><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Quantidade</TableHead><TableHead>Documento / observação</TableHead><TableHead>Usuário</TableHead><TableHead>Ação</TableHead></TableRow></TableHeader><TableBody>{movs.map(m=><TableRow key={m.id}><TableCell>{m.data_movimento}</TableCell><TableCell>{m.tipo}{m.baixa_codigo&&<a className='underline' href={'/?aba=chamados&baixa='+m.baixa_id}>{m.baixa_codigo}</a>}</TableCell><TableCell>{m.quantidade} {m.unidade}</TableCell><TableCell>{m.documento||''} {m.observacao||''}</TableCell><TableCell>{m.usuario||''}</TableCell><TableCell>{['entrada','ajuste'].includes(m.tipo)&&!m.estornado&&(m.tipo==='ajuste'?pode(user,'estoque:gerenciar'):pode(user,'baixa:atender'))&&<Button variant="outline" onClick={()=>setSelecionado(m)}>Estornar</Button>}</TableCell></TableRow>)}</TableBody></Table><Button variant="outline" onClick={()=>setHistorico(null)}>Fechar histórico</Button></CardContent></Card>}{selecionado&&<Card><CardContent><Field label="Motivo do estorno"><Input required maxLength={300} value={motivo} onChange={e=>setMotivo(e.target.value)}/></Field><Button disabled={busy||!motivo.trim()} onClick={()=>void fazerEstorno()}>Confirmar estorno</Button><Button variant="outline" onClick={()=>setSelecionado(null)}>Cancelar</Button></CardContent></Card>}</section></>;
}

function AjusteForm({estoques,onSave,busy}:{estoques:AnyRow[];onSave:(body:AnyRow)=>void;busy:boolean}){const [estoqueId,setEstoqueId]=useState(''),[itemId,setItemId]=useState(''),[itens,setItens]=useState<AnyRow[]>([]),[quantidade,setQuantidade]=useState(''),[observacao,setObservacao]=useState('');useEffect(()=>{void api('/api/catalogs/items').then(x=>setItens(x.itens))},[]);return <Card><CardContent><form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();onSave({estoqueId,dataMovimento:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),observacao,itens:[{itemId,quantidade:Number(quantidade)}]})}}><Field label="Estoque"><select required className="h-10 rounded-md border px-3" value={estoqueId} onChange={e=>setEstoqueId(e.target.value)}><option value="">Selecione</option>{estoques.filter(x=>x.ativo).map(x=><option key={x.id} value={x.id}>{x.nome}</option>)}</select></Field><Field label="Item"><select required className="h-10 rounded-md border px-3" value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Selecione</option>{itens.map(i=><option key={i.id} value={i.id}>{i.descricao} · {i.unidade}</option>)}</select></Field><Field label="Quantidade (+/-)"><Input required type="number" step={itens.find(i=>i.id===itemId)?.unidade==='un'?'1':'0.01'} value={quantidade} onChange={e=>setQuantidade(e.target.value)}/></Field><Field label="Observação"><Input required maxLength={300} value={observacao} onChange={e=>setObservacao(e.target.value)}/></Field><Button disabled={busy}>Salvar ajuste</Button></form></CardContent></Card>}
