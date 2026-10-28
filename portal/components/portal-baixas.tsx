"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiError, errorText } from "@/lib/api";
import { pode } from "@/lib/permissoes";
import {
  exibirPlaca,
  linkBaixa,
  normalizarPlaca,
  SITUACOES_BAIXA,
} from "@/lib/baixas";
import { corpoJson, dataHoraSolicitacao } from "@/lib/solicitacoes-cliente";
import { gerarChaveRelatorio } from "@/lib/relatorios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "./page-header";
import { Plaquinha } from "./plaquinha";
import { Status } from "./status";
import { Card, CardContent } from "@/components/ui/card";
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
  Info,
  Loading,
  FalhaDeCarregamento,
  PaginacaoDeLista,
} from "./portal-presentation";

const situacao = (valor: string) =>
  SITUACOES_BAIXA[valor as keyof typeof SITUACOES_BAIXA] || valor;
const selectClass = "rounded-md border bg-background p-2";
function seguir(
  e: React.MouseEvent<HTMLAnchorElement>,
  id: string,
  abrir: (id: string) => void,
) {
  if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    abrir(id);
  }
}
// Cada montagem pertence a uma conta; leituras anteriores sao canceladas.
function useLeitura(caminho: string, versao: number) {
  const [dados, setDados] = useState<AnyRow | null>(null),
    [erro, setErro] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setDados(null);
        setErro("");
      }
    });
    void api(caminho, { signal: controller.signal })
      .then((x) => {
        if (!controller.signal.aborted) setDados(x);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setErro(errorText(e));
      });
    return () => controller.abort();
  }, [caminho, versao]);
  return { dados, erro };
}
export function Baixas({
  user,
  initialDetail,
  onOpen,
}: {
  user: AnyRow;
  initialDetail?: string | null;
  onOpen: (id: string | null) => void;
}) {
  const [nova, setNova] = useState(false);
  if (initialDetail)
    return (
      <DetalheBaixa
        user={user}
        id={initialDetail}
        onBack={() => onOpen(null)}
      />
    );
  if (nova)
    return <FormularioBaixa onCancel={() => setNova(false)} onOpen={onOpen} />;
  return (
    <ListaBaixas user={user} onNew={() => setNova(true)} onOpen={onOpen} />
  );
}
export function ListaBaixas({
  user,
  onNew,
  onOpen,
}: {
  user: AnyRow;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const [filtros, setFiltros] = useState({
      status: "",
      estoque: "",
      de: "",
      ate: "",
    }),
    [pagina, setPagina] = useState(1),
    [versao, setVersao] = useState(0);
  const params = new URLSearchParams({ page: String(pagina) });
  for (const [nome, valor] of Object.entries(filtros))
    if (valor) params.set(nome, valor);
  const { dados, erro } = useLeitura(`/api/baixas?${params}`, versao),
    estoques = useLeitura("/api/estoques", versao);
  const todas = pode(user, "baixa:ver_todas");
  const filtrar = (nome: keyof typeof filtros, valor: string) => {
    setFiltros({ ...filtros, [nome]: valor });
    setPagina(1);
  };
  // O estoque inativo ainda precisa ser filtravel nos pedidos historicos.
  const opcoes = new Map<string, string>(
    (estoques.dados?.estoques || []).map((e: AnyRow) => [e.id, e.nome]),
  );
  for (const e of dados?.estoques_com_pedidos || []) opcoes.set(e.id, e.nome);
  for (const b of dados?.baixas || []) opcoes.set(b.estoque_id, b.estoque);
  if (filtros.estoque && !opcoes.has(filtros.estoque))
    opcoes.set(filtros.estoque, "Estoque selecionado");
  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="Atualizar"
              title="Atualizar"
              onClick={() => setVersao((v) => v + 1)}
            >
              <RefreshCw />
            </Button>
            {pode(user, "baixa:abrir") && (
              <Button variant="create" onClick={onNew}>
                Nova baixa
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="Situação">
            <select
              name="status"
              className={selectClass}
              value={filtros.status}
              onChange={(e) => filtrar("status", e.target.value)}
            >
              <option value="">Todas</option>
              {Object.entries(SITUACOES_BAIXA).map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estoque">
            <select
              name="estoque"
              className={selectClass}
              value={filtros.estoque}
              onChange={(e) => filtrar("estoque", e.target.value)}
            >
              <option value="">Todos</option>
              {[...opcoes].map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
            </select>
          </Field>
          <Field label="De">
            <Input
              name="de"
              type="date"
              value={filtros.de}
              onChange={(e) => filtrar("de", e.target.value)}
            />
          </Field>
          <Field label="Até">
            <Input
              name="ate"
              type="date"
              min={filtros.de}
              value={filtros.ate}
              onChange={(e) => filtrar("ate", e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>
      {estoques.erro && <p role="alert">{estoques.erro}</p>}
      {erro ? (
        <FalhaDeCarregamento
          erro={erro}
          tentar={() => setVersao((v) => v + 1)}
        />
      ) : !dados ? (
        <Loading label="Carregando baixas…" />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Código",
                    "Nº da OS",
                    "Itens",
                    "Placa",
                    "Estoque",
                    "Situação",
                    ...(todas ? ["Solicitante"] : []),
                    "Atualizado em",
                  ].map((t) => (
                    <TableHead key={t}>{t}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dados.baixas.map((b: AnyRow) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <a
                        className="text-link hover:underline"
                        href={linkBaixa(b.id)}
                        onClick={(e) => seguir(e, b.id, onOpen)}
                      >
                        <Plaquinha>{b.codigo}</Plaquinha>
                      </a>
                    </TableCell>
                    <TableCell>{b.numero_os}</TableCell>
                    <TableCell>{b.itens_total || 0} itens · {b.itens_pendentes || 0} pendente{b.itens_pendentes===1?'':'s'}</TableCell>
                    <TableCell>{exibirPlaca(b.placa)}</TableCell>
                    <TableCell>{b.estoque}</TableCell>
                    <TableCell>
                      <Status value={b.status}>{situacao(b.status)}</Status>
                    </TableCell>
                    {todas && <TableCell>{b.solicitante}</TableCell>}
                    <TableCell>
                      <time dateTime={b.atualizado_em}>
                        {dataHoraSolicitacao(b.atualizado_em)}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!dados.baixas.length && (
              <p className="p-6 text-center text-muted-foreground">
                Nenhuma baixa encontrada.
              </p>
            )}
            <PaginacaoDeLista
              pagina={dados.page}
              paginas={dados.pageCount}
              alterar={setPagina}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export function FormularioBaixa({
  onCancel,
  onOpen,
}: {
  onCancel: () => void;
  onOpen: (id: string) => void;
}) {
  const [os, setOs] = useState(""),
    [placa, setPlaca] = useState(""),
    [estoque, setEstoque] = useState(""),
    [consultaItem, setConsultaItem] = useState(""),
    [selecionado, setSelecionado] = useState(""),
    [itens, setItens] = useState<{itemId:string;quantidade:string;descricao:string;unidade:string}[]>([]),
    [versao, setVersao] = useState(0);
  const [erro, setErro] = useState(""),
    [existente, setExistente] = useState<AnyRow | null>(null),
    [busy, setBusy] = useState(false);
  const { dados, erro: falha } = useLeitura("/api/estoques", versao),
    catalogo=useLeitura(`/api/catalogs/items?q=${encodeURIComponent(consultaItem)}`,versao),
    trava = useRef(false),
    tentativa = useRef({ corpo: "", chave: "" }),
    montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);
  const valida = normalizarPlaca(placa),
    ativos = (dados?.estoques || []).filter((e: AnyRow) => e.ativo);
  const enviar = async () => {
    if (
      trava.current ||
      !valida ||
      !/^\d{1,20}$/.test(os) ||
      !ativos.some((e: AnyRow) => e.id === estoque) || !itens.length || itens.some(i=>!i.quantidade||Number(i.quantidade)<=0||(i.unidade==='un'&&!Number.isInteger(Number(i.quantidade)))||!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(i.quantidade))
    )
      return;
    trava.current = true;
    setBusy(true);
    setErro("");
    setExistente(null);
    const corpo = JSON.stringify({
      numero_os: os,
      placa: valida,
      estoque_id: estoque,
      itens: itens.map(i=>({itemId:i.itemId,quantidade:Number(i.quantidade)})),
    });
    if (tentativa.current.corpo !== corpo)
      tentativa.current = { corpo, chave: gerarChaveRelatorio() };
    try {
      const criada = await api("/api/baixas", {
        ...corpoJson("POST", JSON.parse(corpo)),
        headers: {
          "content-type": "application/json",
          "idempotency-key": tentativa.current.chave,
        },
      });
      if (montado.current) onOpen(criada.id);
    } catch (e) {
      if (montado.current) {
        setErro(errorText(e));
        if (e instanceof ApiError && e.details.status === 409)
          setExistente(e.details.existente || null);
      }
    } finally {
      trava.current = false;
      if (montado.current) setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "← Chamados", onClick: onCancel }}
        title="Nova baixa"
      />
      <Card>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <fieldset disabled={busy} className="space-y-4">
              <Field label="Nº da OS">
                <Input
                  name="numero_os"
                  inputMode="numeric"
                  maxLength={20}
                  required
                  value={os}
                  onChange={(e) =>
                    setOs(e.target.value.replace(/\D/g, "").slice(0, 20))
                  }
                />
              </Field>
              <Field label="Placa">
                <Input
                  name="placa"
                  maxLength={8}
                  required
                  value={placa}
                  aria-invalid={Boolean(placa && !valida)}
                  aria-describedby="validacao-placa"
                  onChange={(e) => setPlaca(e.target.value.toUpperCase())}
                />
              </Field>
              {placa && !valida && (
                <p id="validacao-placa" role="alert">
                  Informe uma placa válida (AAA-9999 ou AAA9A99).
                </p>
              )}
              <Field label="Estoque">
                <select
                  name="estoque_id"
                  className={selectClass}
                  required
                  value={estoque}
                  onChange={(e) => setEstoque(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {ativos.map((e: AnyRow) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Buscar item do catálogo">
                <Input name="buscar_item" value={consultaItem} onChange={e=>setConsultaItem(e.target.value)} placeholder="Descrição do item" />
                <select aria-label="Item do catálogo" className={selectClass} value={selecionado} onChange={e=>setSelecionado(e.target.value)}>
                  <option value="">Selecione um item</option>
                  {(catalogo.dados?.itens||[]).filter((i:AnyRow)=>!itens.some(x=>x.itemId===i.id)).map((i:AnyRow)=><option key={i.id} value={i.id}>{i.descricao} · {i.unidade}</option>)}
                </select>
                <Button type="button" variant="outline" disabled={!selecionado||itens.length>=50} onClick={()=>{const i=(catalogo.dados?.itens||[]).find((x:AnyRow)=>x.id===selecionado);if(i)setItens([...itens,{itemId:i.id,descricao:i.descricao,unidade:i.unidade,quantidade:''}]);setSelecionado('');}}>Adicionar item</Button>
              </Field>
              {itens.map((i,index)=><div key={i.itemId} className="flex items-end gap-3"><Field label={`${i.descricao} (${i.unidade})`}><Input aria-label={`Quantidade ${i.descricao}`} inputMode="decimal" value={i.quantidade} onChange={e=>setItens(itens.map((x,n)=>n===index?{...x,quantidade:e.target.value}:x))}/></Field><Button type="button" variant="outline" aria-label={`Remover ${i.descricao}`} onClick={()=>setItens(itens.filter((_,n)=>n!==index))}>Remover</Button></div>)}
              {falha && (
                <FalhaDeCarregamento
                  erro={falha}
                  tentar={() => setVersao((v) => v + 1)}
                />
              )}
              {dados && !ativos.length && (
                <p role="alert">Nenhum estoque ativo disponível.</p>
              )}
              {erro && <p role="alert">{erro}</p>}
              {existente && (
                <a
                  className="text-primary hover:underline"
                  href={linkBaixa(existente.id)}
                  onClick={(e) => seguir(e, existente.id, onOpen)}
                >
                  Abrir {existente.codigo}
                </a>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !valida ||
                    !os ||
                    !itens.length ||
                    !ativos.some((e: AnyRow) => e.id === estoque)
                  }
                >
                  Enviar
                </Button>
                <Button type="button" variant="outline" onClick={onCancel}>
                  Cancelar
                </Button>
              </div>
            </fieldset>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
export function DetalheBaixa({
  id,
  user,
  onBack,
}: {
  id: string;
  user: AnyRow;
  onBack: () => void;
}) {
  const [versao, setVersao] = useState(0),
    [erro, setErro] = useState(""),
    [selecionados, setSelecionados] = useState<string[]>([]),
    [motivos, setMotivos] = useState<Record<string,string>>({}),
    [quantidades, setQuantidades] = useState<Record<string,string>>({}),
    [removidos,setRemovidos]=useState<string[]>([]),
    [buscaCatalogo,setBuscaCatalogo]=useState(''),
    [novoCatalogo,setNovoCatalogo]=useState(''),
    [adicionais,setAdicionais]=useState<{itemId:string;quantidade:number}[]>([]),
    [busy, setBusy] = useState(false),
    [conflito, setConflito] = useState(false);
  const { dados, erro: falha } = useLeitura(
      `/api/baixas/${encodeURIComponent(id)}`,
      versao,
    ),
    catalogoItens=useLeitura(`/api/catalogs/items?q=${encodeURIComponent(buscaCatalogo)}`,versao),
    trava = useRef(false),
    tentativa = useRef({ corpo: "", chave: "" });
  const atenderSelecionados=async(para:'baixado'|'recusado')=>{
    if(!dados||!selecionados.length||trava.current||conflito)return;
    if(para==='recusado'&&selecionados.some(i=>!motivos[i]?.trim())){setErro('Informe o motivo da recusa de cada item selecionado.');return;}
    const body={expectedRevision:dados.baixa.revision,itens:selecionados.map(id=>({id,para,motivo:para==='recusado'?motivos[id].trim():''}))},corpo=JSON.stringify(body);
    if(tentativa.current.corpo!==corpo)tentativa.current={corpo,chave:gerarChaveRelatorio()};
    trava.current=true;setBusy(true);setErro('');
    try{await api(`/api/baixas/${encodeURIComponent(id)}/atender-itens`,{...corpoJson('POST',body),headers:{'content-type':'application/json','idempotency-key':tentativa.current.chave}});setSelecionados([]);setMotivos({});setVersao(v=>v+1);}
    catch(e){const mudou=e instanceof ApiError&&e.details.status===409&&e.details.codigo==='revisao';setConflito(mudou);setErro(mudou?'A baixa foi alterada; recarregue antes de tentar novamente.':errorText(e));}
    finally{trava.current=false;setBusy(false);}
  };
  const salvarPendentes=async()=>{
    if(!dados)return;
    const pendentes=(dados.itens||[]).filter((i:AnyRow)=>i.status==='pendente'&&!removidos.includes(i.id)),body={expectedRevision:b.revision,itens:[...pendentes.map((i:AnyRow)=>({itemId:i.item_id,quantidade:Number(quantidades[i.id]??i.quantidade)})),...adicionais]};
    const corpo=JSON.stringify(body);if(tentativa.current.corpo!==corpo)tentativa.current={corpo,chave:gerarChaveRelatorio()};
    try{await api(`/api/baixas/${encodeURIComponent(id)}/itens`,{...corpoJson('PUT',body),headers:{'content-type':'application/json','idempotency-key':tentativa.current.chave}});setRemovidos([]);setAdicionais([]);setQuantidades({});setVersao(v=>v+1);}
    catch(e){const mudou=e instanceof ApiError&&e.details.status===409&&e.details.codigo==='revisao';setConflito(mudou);setErro(mudou?'A baixa foi alterada; recarregue antes de tentar novamente.':errorText(e));}
  };
  if (falha)
    return (
      <FalhaDeCarregamento
        erro={falha}
        tentar={() => setVersao((v) => v + 1)}
        voltar={onBack}
      />
    );
  if (!dados) return <Loading label="Carregando baixa…" />;
  const b = dados.baixa;
  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "← Chamados", onClick: onBack }}
        title={`Baixa ${b.numero_os}`}
        status={
          <>
            <Plaquinha>{b.codigo}</Plaquinha>
            <Status value={b.status}>{situacao(b.status)}</Status>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="icon"
            aria-label="Recarregar"
            title="Recarregar"
            disabled={busy}
            onClick={() => {
              setErro("");
              setConflito(false);
              setVersao((v) => v + 1);
            }}
          >
            <RefreshCw />
          </Button>
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <Info label="Nº da OS" value={b.numero_os} />
          <Info label="Placa" value={exibirPlaca(b.placa)} />
          <Info label="Estoque" value={b.estoque} />
          <Info label="Solicitante" value={b.solicitante} />
          <Info
            label="Atualizado em"
            value={dataHoraSolicitacao(b.atualizado_em)}
          />
          {b.motivo_recusa && (
            <Info label="Motivo da recusa" value={b.motivo_recusa} />
          )}
        </CardContent>
      </Card>
      {erro && <p role="alert">{erro}</p>}
      <Card><CardContent className="space-y-3"><h3 className="font-semibold">Itens da baixa</h3><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Quantidade / saldo atual</TableHead><TableHead>Status</TableHead><TableHead>Motivo</TableHead><TableHead>Atendente</TableHead></TableRow></TableHeader><TableBody>{(dados.itens||[]).filter((i:AnyRow)=>!removidos.includes(i.id)).map((i:AnyRow)=><TableRow key={i.id}><TableCell>{pode(user,'baixa:atender')&&i.status==='pendente'&&<input type="checkbox" aria-label={`Selecionar ${i.descricao}`} checked={selecionados.includes(i.id)} onChange={e=>setSelecionados(e.target.checked?[...selecionados,i.id]:selecionados.filter(x=>x!==i.id))}/>} {i.descricao}</TableCell><TableCell><div>{b.status==='aberta'&&b.solicitante_id===user.id&&i.status==='pendente'?<Input aria-label={`Quantidade ${i.descricao}`} value={quantidades[i.id]??String(i.quantidade)} onChange={e=>setQuantidades({...quantidades,[i.id]:e.target.value})}/>:`${i.quantidade} ${i.unidade}`}</div>{i.status==='pendente'&&<div className={Number(quantidades[i.id]??i.quantidade)>Number(i.saldo)?'text-sm font-semibold text-red-700':'text-sm text-muted-foreground'}>Saldo: {i.saldo} {i.unidade}{Number(quantidades[i.id]??i.quantidade)>Number(i.saldo)?' · quantidade acima do saldo':''}</div>}</TableCell><TableCell>{i.status}</TableCell><TableCell>{i.motivo_recusa||''}{pode(user,'baixa:atender')&&selecionados.includes(i.id)&&<Input aria-label={`Motivo ${i.descricao}`} value={motivos[i.id]||''} onChange={e=>setMotivos({...motivos,[i.id]:e.target.value})}/>}</TableCell><TableCell>{i.atendente||''}{i.atendido_em?` · ${dataHoraSolicitacao(i.atendido_em)}`:''}{b.solicitante_id===user.id&&i.status==='pendente'&&<Button type="button" variant="outline" onClick={()=>setRemovidos([...removidos,i.id])}>Remover</Button>}</TableCell></TableRow>)}</TableBody></Table>
      {b.status==='aberta'&&b.solicitante_id===user.id&&<div className="flex gap-2"><Input aria-label="Buscar item do catálogo" value={buscaCatalogo} onChange={e=>setBuscaCatalogo(e.target.value)}/><select aria-label="Adicionar item do catálogo" className={selectClass} value={novoCatalogo} onChange={e=>setNovoCatalogo(e.target.value)}><option value="">Selecione</option>{(catalogoItens.dados?.itens||[]).filter((i:AnyRow)=>!(dados.itens||[]).some((x:AnyRow)=>x.item_id===i.id&&!removidos.includes(x.id))&&!adicionais.some(x=>x.itemId===i.id)).map((i:AnyRow)=><option value={i.id} key={i.id}>{i.descricao} · {i.unidade}</option>)}</select><Button type="button" variant="outline" disabled={!novoCatalogo||adicionais.length+dados.itens.filter((i:AnyRow)=>i.status==='pendente').length>=50} onClick={()=>{const i=(catalogoItens.dados?.itens||[]).find((x:AnyRow)=>x.id===novoCatalogo);if(i)setAdicionais([...adicionais,{itemId:i.id,quantidade:1}]);setNovoCatalogo('');}}>Adicionar item</Button></div>}
      {adicionais.map((item,index)=>{const cat=(catalogoItens.dados?.itens||[]).find((i:AnyRow)=>i.id===item.itemId);return <div key={item.itemId} className="flex items-end gap-2"><span>{cat?.descricao} · {cat?.unidade}</span><Input aria-label={`Quantidade adicionada ${cat?.descricao}`} inputMode="decimal" value={item.quantidade} onChange={e=>setAdicionais(adicionais.map((x,n)=>n===index?{...x,quantidade:Number(e.target.value)}:x))}/><Button type="button" variant="outline" onClick={()=>setAdicionais(adicionais.filter((_,n)=>n!==index))}>Remover</Button></div>;})}
      {b.status==='aberta'&&b.solicitante_id===user.id&&<Button disabled={busy||conflito} onClick={()=>void salvarPendentes()}>Salvar itens pendentes</Button>}
      {pode(user,'baixa:atender')&&b.status==='aberta'&&<div className="flex gap-3"><Button disabled={busy||conflito||!selecionados.length} onClick={()=>void atenderSelecionados('baixado')}>Baixar selecionados</Button><Button variant="outline" disabled={busy||conflito||!selecionados.length} onClick={()=>void atenderSelecionados('recusado')}>Recusar selecionados</Button></div>}</CardContent></Card>
      <Card>
        <CardContent className="space-y-4">
          <h3 className="font-semibold">Andamento</h3>
          {dados.andamentos.map((a: AnyRow) => (
            <div key={a.id} className="rounded-lg border p-3">
              <p className="font-medium">
                {situacao(a.para_status)} · {a.usuario}
              </p>
              <time dateTime={a.criado_em}>
                {dataHoraSolicitacao(a.criado_em)}
              </time>
              {a.texto && <p className="whitespace-pre-wrap">{a.texto}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
