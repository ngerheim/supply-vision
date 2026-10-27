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
import { Textarea } from "@/components/ui/textarea";
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
    [versao, setVersao] = useState(0);
  const [erro, setErro] = useState(""),
    [existente, setExistente] = useState<AnyRow | null>(null),
    [busy, setBusy] = useState(false);
  const { dados, erro: falha } = useLeitura("/api/estoques", versao),
    trava = useRef(false),
    tentativa = useRef({ corpo: "", chave: "" }),
    montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const valida = normalizarPlaca(placa),
    ativos = (dados?.estoques || []).filter((e: AnyRow) => e.ativo);
  const enviar = async () => {
    if (
      trava.current ||
      !valida ||
      !/^\d{1,20}$/.test(os) ||
      !ativos.some((e: AnyRow) => e.id === estoque)
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
    [texto, setTexto] = useState(""),
    [recusar, setRecusar] = useState(false),
    [busy, setBusy] = useState(false),
    [conflito, setConflito] = useState(false);
  const { dados, erro: falha } = useLeitura(
      `/api/baixas/${encodeURIComponent(id)}`,
      versao,
    ),
    trava = useRef(false),
    tentativa = useRef({ corpo: "", chave: "" }),
    montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const executar = async (para: string) => {
    if (trava.current || !dados || conflito) return;
    if (para === "recusada" && !texto.trim()) {
      setErro("Informe o motivo da recusa.");
      return;
    }
    trava.current = true;
    setBusy(true);
    setErro("");
    const body = {
        para,
        texto: para === "recusada" ? texto.trim() : "",
        expectedRevision: dados.baixa.revision,
      },
      corpo = JSON.stringify(body);
    if (tentativa.current.corpo !== corpo)
      tentativa.current = { corpo, chave: gerarChaveRelatorio() };
    try {
      await api(`/api/baixas/${encodeURIComponent(id)}/transicao`, {
        ...corpoJson("POST", body),
        headers: {
          "content-type": "application/json",
          "idempotency-key": tentativa.current.chave,
        },
      });
      if (montado.current) {
        setVersao((v) => v + 1);
        setRecusar(false);
        setTexto("");
      }
    } catch (e) {
      if (montado.current) {
        const mudou = e instanceof ApiError && e.details.status === 409 && e.details.codigo === "revisao";
        setConflito(mudou);
        setErro(
          mudou
            ? "A baixa foi alterada; recarregue antes de tentar novamente."
            : errorText(e),
        );
      }
    } finally {
      trava.current = false;
      if (montado.current) setBusy(false);
    }
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
              setRecusar(false);
              setTexto("");
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
      {pode(user, "baixa:atender") && b.status === "aberta" && (
        <Card>
          <CardContent>
            <fieldset disabled={busy || conflito} className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void executar("baixada")}>
                  Marcar como baixada
                </Button>
                <Button variant="outline" onClick={() => setRecusar(true)}>
                  Recusar
                </Button>
              </div>
              {recusar && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void executar("recusada");
                  }}
                  className="space-y-4"
                >
                  <Field label="Motivo da recusa">
                    <Textarea
                      name="motivo_recusa"
                      required
                      maxLength={2000}
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" disabled={!texto.trim()}>
                    Confirmar recusa
                  </Button>
                </form>
              )}
            </fieldset>
          </CardContent>
        </Card>
      )}
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
