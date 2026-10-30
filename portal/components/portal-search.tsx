"use client";
import { PageHeader } from "./page-header";
import { BarraBuscaAcordos } from "./barra-busca-acordos";
import { api, errorText } from "@/lib/api";
import {
  parametrosBusca,
} from "@/lib/filtros-busca";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type JsonData,
  type AnyRow,
  money,
} from "./portal-presentation";

export function SearchPage({
  catalogs,
  openAgreement,
  filters,
  setFilters,
}: JsonData) {
  const [rows, setRows] = useState<AnyRow[]>([]),
    [meta, setMeta] = useState<AnyRow>({}),
    [loading, setLoading] = useState(false),
    [searched, setSearched] = useState(false),
    [searchError, setSearchError] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const searchSequence = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  const cancelSearch = () => {
    searchSequence.current++;
    searchController.current?.abort();
    setLoading(false);
    setSearchError("");
    setSearched(false);
  };
  useEffect(
    () => () => {
      searchSequence.current++;
      searchController.current?.abort();
    },
    [],
  );
  const query = parametrosBusca(filters).toString();
  const search = async () => {
    const request = ++searchSequence.current;
    searchController.current?.abort();
    const pending = new AbortController();
    searchController.current = pending;
    setLoading(true);
    setSearchError("");
    try {
      const p = parametrosBusca(filters);
      const x = await api(`/api/search?${p}`, { signal: pending.signal });
      if (request !== searchSequence.current) return;
      setRows(x.rows);
      setMeta({ total: x.total, truncated: x.truncated, limit: x.limit });
      setSearched(true);
      setSearchedQuery(query);
    } catch (error) {
      if (request !== searchSequence.current) return;
      setSearchError(errorText(error));
      setSearched(false);
      setRows([]);
    } finally {
      if (request === searchSequence.current) setLoading(false);
    }
  };
  return (
    <div className="patio-page">
      <PageHeader />
      <BarraBuscaAcordos catalogs={catalogs} filters={filters} setFilters={setFilters}
        onChange={cancelSearch} onClear={() => setRows([])} onSearch={search} loading={loading} />
      {searchError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Não foi possível pesquisar</AlertTitle>
          <AlertDescription>{searchError}</AlertDescription>
        </Alert>
      )}
      {searched && searchedQuery === query ? (
        <Card>
          <CardHeader className="border-b">
            <p className="patio-result-count">
              {meta.truncated
                ? `Mostrando ${rows.length.toLocaleString("pt-BR")} de ${Number(meta.total).toLocaleString("pt-BR")} condições`
                : `${Number(meta.total ?? rows.length).toLocaleString("pt-BR")} ${Number(meta.total ?? rows.length) === 1 ? "condição encontrada" : "condições encontradas"}`}
            </p>
            {meta.truncated && (
              <Alert variant="destructive" className="mt-3">
                <AlertTriangle />
                <AlertTitle>Resultado incompleto</AlertTitle>
                <AlertDescription>
                  Refine os filtros antes de comparar preços.
                </AlertDescription>
              </Alert>
            )}
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table className="patio-search-table">
              <colgroup>
                {[
                  "item",
                  "model",
                  "supplier",
                  "city",
                  "brands",
                  "unit",
                  "price",
                ].map((c) => (
                  <col key={c} className={`search-col-${c}`} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>Peça / serviço</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead className="search-secondary-col">Marcas</TableHead>
                  <TableHead className="search-secondary-col">Unid.</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <button
                        className="text-left text-link hover:underline"
                        onClick={() => openAgreement(r.agreementId)}
                      >
                        {r.item}
                      </button>
                      <p className="search-item-meta text-xs text-muted-foreground">
                        {r.brands || "Livre"} · {r.unit}
                      </p>
                    </TableCell>
                    <TableCell>{r.model}</TableCell>
                    <TableCell>
                      <p className="font-medium">{r.supplier}</p>
                      <button
                        className="text-xs text-link"
                        onClick={() => openAgreement(r.agreementId)}
                      >
                        {r.number}
                      </button>
                    </TableCell>
                    <TableCell>
                      {r.city} / {r.state}
                    </TableCell>
                    <TableCell className="search-secondary-col text-muted-foreground">
                      {r.brands || "Livre"}
                    </TableCell>
                    <TableCell className="search-secondary-col">
                      {r.unit}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {r.courtesy ? (
                        <Badge className="bg-muted text-muted-foreground">
                          Cortesia
                        </Badge>
                      ) : (
                        money(r.price)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
