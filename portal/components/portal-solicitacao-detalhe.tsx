"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiError, errorText } from "@/lib/api";
import { pode } from "@/lib/permissoes";
import {
  corpoJson,
  erroDeRevisao,
  rotuloSituacao,
  dataHoraSolicitacao,
  formatarCnae,
  mascaraCep,
  mascaraTelefone,
} from "@/lib/solicitacoes-cliente";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { gerarChaveRelatorio } from "@/lib/relatorios";
import {
  type AnyRow,
  Field,
  Info,
  Loading,
  FalhaDeCarregamento,
  cnpj,
} from "./portal-presentation";
import { PageHeader } from "./page-header";
import { Plaquinha } from "./plaquinha";
import { FormularioSolicitacao } from "./portal-solicitacao-formulario";
import { SituacaoSolicitacao } from "./portal-solicitacao-situacao";

export function DetalheSolicitacao({
  id,
  user,
  onBack,
}: {
  id: string;
  user: AnyRow;
  onBack: () => void;
}) {
  const [dados, setDados] = useState<AnyRow | null>(null),
    [erro, setErro] = useState(""),
    [falha, setFalha] = useState("");
  const [versao, setVersao] = useState(0),
    [busy, setBusy] = useState(false),
    [corrigir, setCorrigir] = useState(false);
  const [acao, setAcao] = useState(""),
    [texto, setTexto] = useState("");
  const trava = useRef(false),
    tentativa = useRef({ corpo: "", chave: "" }),
    sequencia = useRef(0);
  useEffect(() => {
    const atual = ++sequencia.current,
      controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setDados(null);
        setFalha("");
        setErro("");
        setAcao("");
        setTexto("");
      }
    });
    void api(`/api/solicitacoes/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((x) => {
        if (atual === sequencia.current && !controller.signal.aborted)
          setDados(x);
      })
      .catch((e) => {
        if (atual === sequencia.current && !controller.signal.aborted)
          setFalha(
            e instanceof ApiError && [403, 404].includes(e.details.status)
              ? "Solicitação não encontrada."
              : errorText(e),
          );
      });
    return () => {
      controller.abort();
      sequencia.current = atual + 1;
    };
  }, [id, versao]);
  const executar = async (para: string) => {
    if (trava.current || !dados) return;
    if (["devolvida", "recusado"].includes(para) && !texto.trim()) {
      setErro(
        para === "devolvida"
          ? "Informe a mensagem de devolução."
          : "Informe o motivo da recusa.",
      );
      return;
    }
    trava.current = true;
    setBusy(true);
    setErro("");
    const atual = sequencia.current;
    const body = {
      expectedRevision: dados.solicitacao.revision,
      ...(para === "reconsultar" ? {} : { para, texto: texto.trim() }),
    }, corpo = JSON.stringify(body);
    if (tentativa.current.corpo !== corpo)
      tentativa.current = { corpo, chave: gerarChaveRelatorio() };
    try {
      await api(
        `/api/solicitacoes/${encodeURIComponent(id)}/${para === "reconsultar" ? "reconsultar" : "transicao"}`,
        { ...corpoJson("POST", body), headers: { "content-type": "application/json", "idempotency-key": tentativa.current.chave } },
      );
      tentativa.current = { corpo: "", chave: "" };
      if (atual === sequencia.current) setVersao((v) => v + 1);
    } catch (e) {
      if (atual === sequencia.current) setErro(erroDeRevisao(e));
    } finally {
      trava.current = false;
      setBusy(false);
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
  if (!dados) return <Loading label="Carregando solicitação…" />;
  const s = dados.solicitacao;
  const devolucao = [...dados.andamentos]
    .reverse()
    .find((a: AnyRow) => a.para_status === "devolvida")?.texto;
  const podeCorrigir =
    pode(user, "solicitacao:abrir") &&
    s.solicitante_id === user.id &&
    s.status === "devolvida";
  const cnae = [formatarCnae(s.cnae_codigo), s.cnae_descricao]
    .filter(Boolean)
    .join(" — ");
  const endereco = [
    [s.logradouro, s.numero].filter(Boolean).join(", "),
    s.complemento,
    s.bairro,
  ]
    .filter(Boolean)
    .join(" · ");
  const cidadeUf = [s.cidade, s.uf].filter(Boolean).join(" / ");
  const atendimento = [s.atendimento_cidade, s.atendimento_uf]
    .filter(Boolean)
    .join(" / ");
  const blocos = (
    [
      [
        "Fornecedor",
        [
          ["Razão social", s.razao_social],
          ["Nome fantasia", s.nome_fantasia],
          ["Situação cadastral", s.situacao_cadastral],
          ["CNAE", cnae],
        ],
      ],
      [
        "Endereço",
        [
          ["Logradouro", endereco],
          ["Cidade", cidadeUf],
          ["CEP", s.cep ? mascaraCep(s.cep) : ""],
        ],
      ],
      [
        "Contato e pedido",
        [
          ["Telefone", s.telefone ? mascaraTelefone(s.telefone) : ""],
          ["E-mail", s.email],
          [
            "Categorias",
            dados.categorias.map((c: AnyRow) => c.nome).join(", "),
          ],
          ["Atendimento", atendimento],
        ],
      ],
    ] as [string, [string, string][]][]
  )
    .map(
      ([t, itens]) =>
        [t, itens.filter(([, v]) => v)] as [string, [string, string][]],
    )
    .filter(([, itens]) => itens.length);
  if (corrigir && podeCorrigir)
    return (
      <FormularioSolicitacao
        key={s.id}
        value={s}
        categoriasIniciais={dados.categorias}
        devolucao={devolucao}
        onCancel={() => setCorrigir(false)}
        onSaved={() => {
          setCorrigir(false);
          setVersao((v) => v + 1);
        }}
        onOpen={() => {
          setCorrigir(false);
          setVersao((v) => v + 1);
        }}
      />
    );
  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "← Chamados", onClick: onBack }}
        title={s.razao_social || s.codigo}
        status={
          <>
            <Plaquinha>{s.codigo}</Plaquinha>
            <SituacaoSolicitacao value={s.status} />
            {s.urgencia === "urgente" && (
              <Badge className="bg-red-50 text-red-700">Urgente</Badge>
            )}
          </>
        }
        actions={
          <Button
            variant="outline"
            size="icon"
            aria-label="Recarregar"
            title="Recarregar"
            disabled={busy}
            onClick={() => setVersao((v) => v + 1)}
          >
            <RefreshCw />
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">
        <span className="font-mono">{cnpj(s.cnpj)}</span> ·{" "}
        {s.nao_verificado
          ? "Não verificado"
          : `Verificado na Receita${s.consultada_em ? ` em ${dataHoraSolicitacao(s.consultada_em)}` : ""}`}
      </p>
      {s.status === "devolvida" && devolucao && (
        <div
          role="note"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"
        >
          <b>Mensagem da devolução</b>
          <p className="whitespace-pre-wrap">{devolucao}</p>
        </div>
      )}
      {blocos.map(([titulo, itens]) => (
        <Card key={titulo}>
          <CardContent className="space-y-3">
            <h3 className="text-lg font-semibold">{titulo}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {itens.map(([label, value]) => (
                <Info key={label} label={label} value={value} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
      {podeCorrigir && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => setCorrigir(true)}>
            Corrigir e reenviar
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setAcao("recusado");
              setTexto("");
              setErro("");
            }}
          >
            Cancelar solicitação
          </Button>
        </div>
      )}
      {pode(user, "solicitacao:atender") && (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {s.status === "aberta" && (
                <Button
                  disabled={busy}
                  onClick={() => void executar("em_analise")}
                >
                  Iniciar análise
                </Button>
              )}
              {s.status === "em_analise" &&
                [
                  ["cadastrado", "Marcar como cadastrado"],
                  ["devolvida", "Devolver"],
                  ["recusado", "Recusar"],
                ].map(([para, label]) => (
                  <Button
                    key={para}
                    disabled={busy}
                    variant={para === "cadastrado" ? "default" : "outline"}
                    onClick={() => {
                      setAcao(para);
                      setTexto("");
                      setErro("");
                    }}
                  >
                    {label}
                  </Button>
                ))}
              {s.status === "devolvida" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setAcao("recusado");
                    setTexto("");
                    setErro("");
                  }}
                >
                  Recusar devolvida
                </Button>
              )}
              {["aberta", "em_analise"].includes(s.status) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void executar("reconsultar")}
                >
                  Reconsultar na Receita
                </Button>
              )}
            </div>
            {acao && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void executar(acao);
                }}
              >
                <fieldset disabled={busy} className="space-y-3">
                  <Field
                    label={
                      acao === "devolvida"
                        ? "Mensagem de devolução (obrigatória)"
                        : acao === "recusado"
                          ? podeCorrigir && s.solicitante_id === user.id
                            ? "Motivo do cancelamento (obrigatório)"
                            : "Motivo da recusa (obrigatório)"
                          : "Observação (opcional)"
                    }
                  >
                    <Textarea
                      name="texto"
                      value={texto}
                      required={acao !== "cadastrado"}
                      maxLength={4000}
                      onChange={(e) => setTexto(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" disabled={busy}>
                    Confirmar
                  </Button>
                  <Button
                    className="ml-2"
                    type="button"
                    variant="outline"
                    onClick={() => setAcao("")}
                  >
                    Cancelar
                  </Button>
                </fieldset>
              </form>
            )}
          </CardContent>
        </Card>
      )}
      {erro && <p role="alert">{erro}</p>}
      <Card>
        <CardContent className="space-y-3">
          <h3 className="text-lg font-semibold">Andamento</h3>
          <ol className="space-y-2">
            {dados.andamentos.map((a: AnyRow) => (
              <li key={a.id} className="border-l-2 pl-4 text-sm">
                <time dateTime={a.criado_em}>
                  {dataHoraSolicitacao(a.criado_em)}
                </time>{" "}
                · <b>{a.usuario}</b> ·{" "}
                {a.de_status ? `${rotuloSituacao(a.de_status)} → ` : ""}
                {rotuloSituacao(a.para_status)}
                {a.texto && (
                  <span className="whitespace-pre-wrap text-muted-foreground">
                    {" "}
                    — {a.texto}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      {dados.relacionados && (
        <Card>
          <CardContent>
            <h3 className="mb-3 text-lg font-semibold">Relacionados</h3>
            {dados.relacionados.length ? (
              <ul className="space-y-2">
                {dados.relacionados.map((r: AnyRow) => (
                  <li key={r.codigo}>
                    <span className="font-mono font-semibold">{r.codigo}</span>{" "}
                    · {r.fornecedor} · <span>{r.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nenhum chamado de parceria relacionado.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
