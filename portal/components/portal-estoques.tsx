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
