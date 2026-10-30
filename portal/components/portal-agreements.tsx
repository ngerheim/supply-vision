'use client';
import { BarraBuscaAcordos } from './barra-busca-acordos';
import { CAMPOS_BUSCA, filtrosVazios, parametrosBusca, type FiltrosBusca } from '@/lib/filtros-busca';
import { PageHeader, LinhaDeAba } from './page-header';
import { BarraFiltros, TabelaPadrao } from './tela-padrao';
import { Plaquinha } from './plaquinha';
import { correspondeSituacaoAcordo } from '@/lib/situacao-acordos';
import { api, errorText, baixarArquivo } from '@/lib/api';
import { correspondeBusca } from '@/lib/busca';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { Status as PatioStatus } from './status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type JsonData,
  type AnyRow,
  money,
  date,
  cnpj,
  Loading,
  Info,
  PaginacaoDeLista,
} from './portal-presentation';
import { useOrdenacao, CabecalhoOrdenavel } from './portal-table';

export function Agreements({ data, catalogs, onOpen, onNew, canWrite }: JsonData) {
  const [filters, setFilters] = useState<FiltrosBusca>(filtrosVazios);
  const [applied, setApplied] = useState('');
  const [result, setResult] = useState<{ query: string; rows: AnyRow[] } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const readUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const next = filtrosVazios();
      for (const campo of CAMPOS_BUSCA) next[campo] = params.getAll(campo);
      setFilters(next);
      setStatus(params.get('situacao') || '');
      setApplied(parametrosBusca(next).toString());
    };
    queueMicrotask(readUrl);
    window.addEventListener('popstate', readUrl);
    return () => window.removeEventListener('popstate', readUrl);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api<{ agreements: AnyRow[] }>(`/api/agreements?${applied}`, { signal: controller.signal })
      .then(value => {
        if (!controller.signal.aborted) {
          setResult({ query: applied, rows: value.agreements });
          setLoadError('');
        }
      })
      .catch(error => { if (!controller.signal.aborted) setLoadError(errorText(error)); });
    return () => controller.abort();
  }, [applied, data]);

  const apply = (next: FiltrosBusca) => {
    const params = new URLSearchParams(window.location.search);
    for (const campo of CAMPOS_BUSCA) {
      params.delete(campo);
      for (const value of next[campo]) params.append(campo, value);
    }
    window.history.pushState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
    setApplied(parametrosBusca(next).toString());
  };
  const rows = (result?.query === applied ? result.rows : []).filter((r: AnyRow) =>
    correspondeSituacaoAcordo(r.effectiveStatus || r.status, status),
  );
  return (
    <div className="patio-page">
      <LinhaDeAba
        actions={
          <>
            {' '}
            {canWrite && (
              <Button
                variant="outline"
                onClick={() => {
                  void baixarArquivo('/api/export/agreements').catch((error) =>
                    alert(errorText(error)),
                  );
                }}
              >
                <Download /> Exportar acordos
              </Button>
            )}
            {canWrite && (
              <Button variant="create" onClick={onNew}>
                <Plus /> Novo
              </Button>
            )}
          </>
        }
      />
      <BarraBuscaAcordos optionsPath="/api/agreements/options" catalogs={catalogs} filters={filters} setFilters={setFilters}
        onChange={() => {}} onClear={() => apply(filtrosVazios())}
        onSearch={() => apply(filters)} loading={false} />
      {loadError && <p role="alert">{loadError}</p>}
      <BarraFiltros>
        <NativeSelect
          className="w-48"
          aria-label="Situação do acordo"
          value={status}
          onChange={(e) => {
            const value = e.target.value;
            const params = new URLSearchParams(window.location.search);
            if (value) params.set('situacao', value);
            else params.delete('situacao');
            window.history.pushState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
            setStatus(value);
          }}
        >
          <NativeSelectOption value="">Todas as situações</NativeSelectOption>
          <NativeSelectOption value="active">Vigente</NativeSelectOption>
          <NativeSelectOption value="expiring">
            Vence em até 60 dias
          </NativeSelectOption>
          <NativeSelectOption value="scheduled">Agendado</NativeSelectOption>
          <NativeSelectOption value="expired">Expirado</NativeSelectOption>
          <NativeSelectOption value="suspended">Suspenso</NativeSelectOption>
        </NativeSelect>
      </BarraFiltros>
      <AgreementTable
        rows={rows}
        onOpen={onOpen}
        title={`${rows.length} ${rows.length === 1 ? 'acordo' : 'acordos'}`}
      />
    </div>
  );
}

function AgreementTable({ rows, onOpen, title }: JsonData) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / 50)),
    currentPage = Math.min(page, pageCount);
  const { ordem, alternar, ordenar } = useOrdenacao('agreements');
  const ordenadas = ordenar(rows, (r: AnyRow) => [
    r.number,
    r.supplier,
    r.locations,
    r.effectiveStatus || r.status,
  ]);
  return (
    <TabelaPadrao contador={title} pagina={<PaginacaoDeLista pagina={currentPage} paginas={pageCount} alterar={setPage} />}>
      <TableHeader>
            <CabecalhoOrdenavel
              acoes={false}
              titulos={['Acordo', 'Fornecedor', 'Localidades', 'Situação']}
              ordem={ordem}
              onAlternar={alternar}
            />
          </TableHeader>
          <TableBody>
            {ordenadas
              .slice((currentPage - 1) * 50, currentPage * 50)
              .map((r: AnyRow) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <button
                      className="text-left"
                      aria-label={r.number}
                      onClick={() => onOpen(r.id)}
                    >
                      <span className="block text-link hover:underline">
                        <Plaquinha>{r.number}</Plaquinha>
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{r.supplier}</p>
                    <p className="text-xs text-muted-foreground">
                      {cnpj(r.cnpj)}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-72 truncate">
                    {r.locations || '—'}
                  </TableCell>
                  <TableCell>
                    <Status value={r.effectiveStatus || r.status} />
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
    </TabelaPadrao>
  );
}

export function AgreementDetail({
  id,
  revision,
  canWrite,
  busy,
  canDelete,
  onBack,
  onEdit,
  onItem,
  onImport,
  onDelete,
  run,
}: JsonData) {
  const [snapshot, setSnapshot] = useState<{
      key: string;
      revision: unknown;
      detail: AnyRow;
    } | null>(null),
    [q, setQ] = useState(''),
    [loadError, setLoadError] = useState(''),
    [moreBusy, setMoreBusy] = useState(false),
    [ordem, setOrdem] = useState({ coluna: 0, direcao: 1 });
  const sortKeys = ['item', 'model', 'location', 'brands', 'unit', 'price'];
  const querySort = `sort=${sortKeys[ordem.coluna]}&direction=${ordem.direcao === 1 ? 'asc' : 'desc'}`;
  const key = `${id}?${querySort}`;
  // O bootstrap mudou: o detalhe anterior pode ter uma revisao ja consumida
  // pela edicao de uma condicao. Aguarde a nova leitura antes de abrir formularios.
  const detail =
    snapshot?.key === key && snapshot.revision === revision
      ? snapshot.detail
      : null;
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const moreRequest = useRef<number | null>(null);
  const cancelLoad = useCallback(() => {
    sequence.current++;
    controller.current?.abort();
  }, []);
  const alternar = (coluna: number) =>
    setOrdem((atual) => ({
      coluna,
      direcao: atual.coluna === coluna ? -atual.direcao : 1,
    }));
  const loadMore = async () => {
    if (!detail || moreRequest.current !== null) return;
    const request = sequence.current;
    moreRequest.current = request;
    setMoreBusy(true);
    try {
      const next = await api(
        `/api/agreements/${id}?${querySort}&offset=${detail.items.length}`,
        { signal: controller.current?.signal },
      );
      if (request !== sequence.current) return;
      if (
        next.version !== detail.version ||
        next.revision !== detail.revision ||
        next.totalItems !== detail.totalItems
      ) {
        setSnapshot(null);
        await load();
        return;
      }
      setSnapshot({
        key,
        revision,
        detail: { ...next, items: [...detail.items, ...next.items] },
      });
    } catch (error) {
      if (request === sequence.current) setLoadError(errorText(error));
    } finally {
      if (request === sequence.current) {
        moreRequest.current = null;
        setMoreBusy(false);
      }
    }
  };
  const load = useCallback(async () => {
    const request = ++sequence.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    moreRequest.current = null;
    setMoreBusy(false);
    setLoadError('');
    try {
      const next = await api(`/api/agreements/${key}`, {
        signal: pending.signal,
      });
      if (request !== sequence.current) return;
      setSnapshot({ key, revision, detail: next });
    } catch (error) {
      if (request === sequence.current) setLoadError(errorText(error));
    }
  }, [key, revision]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      cancelLoad();
    };
  }, [load, revision, cancelLoad]);
  if (loadError)
    return (
      <div className="space-y-4">
        <p role="alert">{loadError}</p>
        <Button onClick={() => void load()}>Tentar novamente</Button>
        <Button variant="outline" onClick={onBack}>
          ← Voltar
        </Button>
      </div>
    );
  if (!detail)
    return (
      <div className="patio-page">
        <PageHeader />
        <Loading label="Abrindo acordo…" compact />
      </div>
    );
  const a = detail.agreement,
    items = detail.items.filter(
      (x: AnyRow) =>
        !q || correspondeBusca(`${x.item} ${x.model} ${x.city} ${x.brands}`, q),
    );
  return (
    <div className="patio-page">
      <PageHeader
        back={{ label: '← Acordos', onClick: onBack }}
        title={
          <>
            <Plaquinha>{a.number}</Plaquinha>
            <span className="patio-detail-name" title={a.supplier}>
              {a.supplier}
            </span>
          </>
        }
        status={<Status value={a.effectiveStatus || a.status} />}
        description={cnpj(a.cnpj)}
        actions={
          <>
            {canWrite && (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    onEdit({
                      ...a,
                      locationIds: detail.locations.map((x: AnyRow) => x.id),
                      supplierId: a.supplier_id,
                      startDate: a.start_date,
                      endDate: a.end_date,
                    })
                  }
                >
                  <Pencil /> Editar acordo
                </Button>
                <Button variant="outline" onClick={onImport}>
                  <Upload /> Substituir tabela
                </Button>
                {canDelete && (
                  <Button
                    variant="outline"
                    className="patio-action-delete text-destructive hover:bg-destructive/10"
                    aria-label="Excluir acordo"
                    title="Excluir acordo"
                    onClick={() => onDelete(a, detail)}
                  >
                    <Trash2 />
                    <span>Excluir acordo</span>
                  </Button>
                )}
                <Button
                  variant="create"
                  onClick={() =>
                    onItem({
                      agreementId: id,
                      modelIds: [],
                      price: '',
                      locationIds: detail.locations.map((x: AnyRow) => x.id),
                      locationId:
                        detail.locations.length === 1
                          ? detail.locations[0].id
                          : '',
                    })
                  }
                >
                  <Plus /> Nova condição
                </Button>
              </>
            )}
          </>
        }
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Info label="Início" value={date(a.start_date)} />
        <Info label="Fim" value={date(a.end_date)} />
      </section>
      {a.notes && (
        <Card size="sm">
          <CardContent>
            <p className="text-xs font-medium text-muted-foreground">
              Observações
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words">{a.notes}</p>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="border-b sm:grid-cols-[1fr_auto]">
          <p className="patio-result-count">{detail.totalItems} {detail.totalItems === 1 ? 'condição' : 'condições'}</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar"
              className="pl-9"
              aria-label="Filtrar condições carregadas"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <CabecalhoOrdenavel
                titulos={[
                  'Item',
                  'Modelo',
                  'Local',
                  'Marcas',
                  'Unid.',
                  'Preço',
                ]}
                ordem={ordem}
                onAlternar={alternar}
                acoes={canWrite}
              />
            </TableHeader>
            <TableBody>
              {items.map((r: AnyRow) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.item}</TableCell>
                  <TableCell>{r.model}</TableCell>
                  <TableCell>
                    {r.city} / {r.state}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground">
                    {r.brands || 'Livre'}
                  </TableCell>
                  <TableCell>{r.unit}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {r.courtesy ? (
                      <Badge className="bg-muted text-muted-foreground">
                        Cortesia
                      </Badge>
                    ) : (
                      money(r.price)
                    )}
                  </TableCell>
                  {canWrite && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Editar condição"
                          onClick={() =>
                            onItem({
                              ...r,
                              agreementId: id,
                              modelIds: [r.modelId],
                              locationIds: detail.locations.map(
                                (x: AnyRow) => x.id,
                              ),
                            })
                          }
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Remover condição"
                          className="text-destructive"
                          onClick={() =>
                            confirm('Remover esta condição?') &&
                            run(async () => {
                              const request = sequence.current;
                              await api(
                                `/api/items/${r.id}?expectedRevision=${encodeURIComponent(String(r.revision))}`,
                                { method: 'DELETE' },
                              );
                              if (request === sequence.current) await load();
                            }, 'Condição removida.')
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        {detail.items.length < detail.totalItems && (
          <div className="space-y-2 p-4">
            <p className="text-sm text-muted-foreground">
              O filtro considera apenas as condições carregadas.
            </p>
            <Button
              variant="outline"
              disabled={moreBusy}
              onClick={() => void loadMore()}
            >
              {moreBusy ? 'Carregando…' : 'Carregar mais condições'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function Status({ value }: JsonData) {
  const map: AnyRow = {
    active: ['Vigente', 'bg-muted text-muted-foreground ring-1 ring-border'],
    scheduled: [
      'Agendado',
      'bg-muted text-muted-foreground ring-1 ring-border',
    ],
    expiring: [
      'Vence em até 60 dias',
      'bg-muted text-muted-foreground ring-1 ring-border',
    ],
    expired: ['Expirado', 'bg-muted text-muted-foreground ring-1 ring-border'],
    suspended: [
      'Suspenso',
      'bg-muted text-muted-foreground ring-1 ring-border',
    ],
  };
  const x = map[value] || [value, 'bg-muted'];
  return <PatioStatus value={value}>{x[0]}</PatioStatus>;
}
