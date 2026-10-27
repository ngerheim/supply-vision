"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiError, errorText } from "@/lib/api";
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
      <ItensCatalogo />
    </div>
  );
}

export function ItensCatalogo() {
  const [rows,setRows]=useState<AnyRow[]|null>(null),[descricao,setDescricao]=useState(""),[unidade,setUnidade]=useState("un"),[editando,setEditando]=useState<AnyRow|null>(null),[erro,setErro]=useState(""),[busy,setBusy]=useState(false),[versao,setVersao]=useState(0);
  useEffect(()=>{let ativo=true;void api("/api/itens").then(x=>{if(ativo)setRows(x.itens)}).catch(e=>{if(ativo)setErro(errorText(e))});return()=>{ativo=false}},[versao]);
  const salvar=async(row:AnyRow|null,body:AnyRow)=>{if(busy)return;setBusy(true);setErro("");try{await api(`/api/itens${row?`/${encodeURIComponent(row.id)}`:""}`,corpoJson(row?"PUT":"POST",{...body,...(row?{expectedRevision:row.revision}:{})}));setDescricao("");setUnidade("un");setEditando(null);setVersao(v=>v+1)}catch(e){setErro(e instanceof ApiError&&e.details.status===409&&e.details.codigo==="revisao"?"O item foi alterado; recarregue antes de salvar.":e instanceof ApiError&&e.details.status===409&&e.details.codigo==="duplicado"?"Já existe um item com essa descrição.":errorText(e))}finally{setBusy(false)}};
  return <section className="space-y-4" aria-label="Itens"><h2 className="text-lg font-semibold">Itens</h2><Card><CardContent><form onSubmit={e=>{e.preventDefault();if(descricao.trim())void salvar(editando,{descricao:descricao.trim(),unidade})}}><fieldset disabled={busy} className="flex flex-wrap items-end gap-3"><Field label={editando?"Editar item":"Novo item"}><Input name="descricao_item" required maxLength={120} value={descricao} onChange={e=>setDescricao(e.target.value)}/></Field><Field label="Unidade"><select className="h-10 rounded-md border px-3" value={unidade} onChange={e=>setUnidade(e.target.value)}><option value="un">un</option><option value="L">L</option><option value="m">m</option><option value="kg">kg</option></select></Field><Button type="submit">{editando?"Salvar":"Incluir"}</Button>{editando&&<Button type="button" variant="outline" onClick={()=>{setEditando(null);setDescricao("")}}>Cancelar</Button>}</fieldset></form></CardContent></Card>{erro&&<p role="alert">{erro}</p>}{!rows?<Loading label="Carregando itens…"/>:<Card><CardContent><Table><TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Unidade</TableHead><TableHead>Situação</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader><TableBody>{rows.map(item=><TableRow key={item.id}><TableCell>{item.descricao}</TableCell><TableCell>{item.unidade}</TableCell><TableCell><Badge variant="outline">{item.ativo?"Ativo":"Inativo"}</Badge></TableCell><TableCell className="space-x-2"><Button variant="outline" disabled={busy||Boolean(editando)} onClick={()=>{setEditando(item);setDescricao(item.descricao);setUnidade(item.unidade)}}>Editar {item.descricao}</Button><Button variant="outline" disabled={busy||Boolean(editando)} onClick={()=>void salvar(item,{ativo:!item.ativo})}>{item.ativo?"Desativar":"Ativar"} {item.descricao}</Button></TableCell></TableRow>)}</TableBody></Table>{!rows.length&&<p className="p-4">Nenhum item cadastrado.</p>}</CardContent></Card>}</section>;
}
