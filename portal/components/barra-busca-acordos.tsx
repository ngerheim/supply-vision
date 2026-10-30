"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, LoaderCircle, Search } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { CAMPOS_BUSCA, filtrosVazios, parametrosBusca, type FiltrosBusca } from "@/lib/filtros-busca";
import { SearchMultiSelect, type SearchOption } from "@/components/search-multi-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type AnyRow } from "./portal-presentation";

export function BarraBuscaAcordos({
  catalogs, filters, setFilters, onChange, onClear, onSearch, loading,
  optionsPath = "/api/search/options",
}: {
  catalogs: AnyRow;
  filters: FiltrosBusca;
  setFilters: (value: FiltrosBusca) => void;
  onChange: () => void;
  onClear: () => void;
  onSearch: () => void;
  loading: boolean;
  optionsPath?: string;
}) {
  type Options = Record<(typeof CAMPOS_BUSCA)[number], SearchOption[]>;
  const [optionResult, setOptionResult] = useState<{
    query: string;
    options: Options;
  } | null>(null);
  const [optionError, setOptionError] = useState(""),
    [optionRevision, setOptionRevision] = useState(0);
  const query = parametrosBusca(filters).toString();
  const loadingOptions = optionResult?.query !== query || !!optionError;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setOptionError("");
      void api<{ options: Options }>(`${optionsPath}?${query}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted)
            setOptionResult({ query, options: result.options });
        })
        .catch((error) => {
          if (!controller.signal.aborted) setOptionError(errorText(error));
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, optionRevision, optionsPath]);
  const labels = {
    state: "Estado",
    location: "Cidade",
    model: "Modelo",
    item: "Peça ou serviço",
    supplier: "Fornecedor",
  };
  const selectedOptions: Options = {
    state: Array.from(
      new Set<string>(
        (catalogs.locations || []).map((x: AnyRow) => String(x.state)),
      ),
    ).map((uf) => ({ id: uf, name: uf })),
    location: (catalogs.locations || []).map((x: AnyRow) => ({
      id: x.id,
      name: x.city,
    })),
    model: catalogs.models || [],
    item: catalogs.items || [],
    supplier: (catalogs.suppliers || []).map((x: AnyRow) => ({
      id: x.id,
      name: x.tradeName,
    })),
  };
  return <>
      <Card className="overflow-hidden">
        <CardContent className="patio-search-filters">
          {(["state", "location", "model", "item", "supplier"] as const).map(
            (campo) => (
              <SearchMultiSelect
                key={campo}
                label={labels[campo]}
                value={filters[campo]}
                onChange={(v: string[]) => {
                  onChange();
                  setFilters({ ...filters, [campo]: v });
                }}
                options={optionResult?.options[campo] || []}
                selectedOptions={selectedOptions[campo]}
                loading={loadingOptions}
              />
            ),
          )}
          <div className="patio-search-actions">
            {" "}
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                onChange();
                setFilters(filtrosVazios());
                onClear();
              }}
            >
              Limpar filtros
            </Button>
            <Button
              size="lg"
              className="transition-transform active:scale-[.97]"
              onClick={onSearch}
              disabled={loading}
            >
              {loading ? <LoaderCircle className="animate-spin" /> : <Search />}{" "}
              Pesquisar
            </Button>
          </div>
        </CardContent>
      </Card>
      {optionError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Não foi possível atualizar os filtros</AlertTitle>
          <AlertDescription>
            {optionError}{" "}
            <Button
              variant="outline"
              onClick={() => setOptionRevision((v) => v + 1)}
            >
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}
  </>;
}
