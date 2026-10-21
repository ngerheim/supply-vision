'use client';
import { api, errorText } from '@/lib/api';
import {
  SearchMultiSelect,
  type SearchOption,
} from '@/components/search-multi-select';
import {
  CAMPOS_BUSCA,
  filtrosVazios,
  parametrosBusca,
} from '@/lib/filtros-busca';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, Search } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type JsonData,
  type AnyRow,
  money,
  Empty,
} from './portal-presentation';

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
    [searchError, setSearchError] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const searchSequence = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  type Options = Record<(typeof CAMPOS_BUSCA)[number], SearchOption[]>;
  const [optionResult, setOptionResult] = useState<{
    query: string;
    options: Options;
  } | null>(null);
  const [optionError, setOptionError] = useState(''),
    [optionRevision, setOptionRevision] = useState(0);
  const query = parametrosBusca(filters).toString();
  const loadingOptions = optionResult?.query !== query || !!optionError;
  const cancelSearch = () => {
    searchSequence.current++;
    searchController.current?.abort();
    setLoading(false);
    setSearchError('');
    setSearched(false);
  };
  useEffect(
    () => () => {
      searchSequence.current++;
      searchController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setOptionError('');
      void api<{ options: Options }>(`/api/search/options?${query}`, {
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
  }, [query, optionRevision]);
  const labels = {
    state: 'Estado',
    location: 'Cidade',
    model: 'Modelo',
    item: 'Peça ou serviço',
    supplier: 'Fornecedor',
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
  const search = async () => {
    const request = ++searchSequence.current;
    searchController.current?.abort();
    const pending = new AbortController();
    searchController.current = pending;
    setLoading(true);
    setSearchError('');
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
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2 xl:grid-cols-[minmax(5rem,.45fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.4fr)]">
          {(['state', 'location', 'model', 'item', 'supplier'] as const).map(
            (campo) => (
              <SearchMultiSelect
                key={campo}
                label={labels[campo]}
                value={filters[campo]}
                onChange={(v: string[]) => {
                  cancelSearch();
                  setFilters({ ...filters, [campo]: v });
                }}
                options={optionResult?.options[campo] || []}
                selectedOptions={selectedOptions[campo]}
                loading={loadingOptions}
              />
            ),
          )}
          <div className="flex items-center justify-between gap-3 md:col-span-2 xl:col-span-5">
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                cancelSearch();
                setFilters(filtrosVazios());
                setSearched(false);
                setRows([]);
              }}
            >
              Limpar filtros
            </Button>
            <Button
              size="lg"
              className="transition-transform active:scale-[.97]"
              onClick={search}
              disabled={loading}
            >
              {loading ? <LoaderCircle className="animate-spin" /> : <Search />}{' '}
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
            {optionError}{' '}
            <Button
              variant="outline"
              onClick={() => setOptionRevision((v) => v + 1)}
            >
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}
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
            <CardTitle>
              {meta.truncated
                ? `Mostrando ${rows.length.toLocaleString('pt-BR')} de ${Number(meta.total).toLocaleString('pt-BR')} condições`
                : `${Number(meta.total ?? rows.length).toLocaleString('pt-BR')} condições encontradas`}
            </CardTitle>
            {meta.truncated && (
              <Alert variant="destructive" className="mt-3">
                <AlertTriangle />
                <AlertTitle>Resultado incompleto</AlertTitle>
                <AlertDescription>
                  A consulta encontrou{' '}
                  {Number(meta.total).toLocaleString('pt-BR')} condições e
                  apenas as {rows.length.toLocaleString('pt-BR')} primeiras
                  estão na tabela. Use os filtros de item, modelo, cidade ou
                  fornecedor para reduzir a lista antes de comparar preços.
                </AlertDescription>
              </Alert>
            )}
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Peça / serviço</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Marcas</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <button
                        className="text-left text-primary hover:underline"
                        onClick={() => openAgreement(r.agreementId)}
                      >
                        {r.item}
                      </button>
                    </TableCell>
                    <TableCell>{r.model}</TableCell>
                    <TableCell>
                      <p className="font-medium">{r.supplier}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.number}
                      </p>
                    </TableCell>
                    <TableCell>
                      {r.city} / {r.state}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {r.brands || 'Livre'}
                    </TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {r.courtesy ? (
                        <Badge className="bg-sky-50 text-sky-700">
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
      ) : (
        <Empty
          icon={Search}
          title="Monte sua pesquisa"
          text="As opções se ajustam às escolhas nos outros filtros. Selecione uma ou mais opções e clique em Pesquisar."
        />
      )}
    </div>
  );
}
