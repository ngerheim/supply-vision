'use client';
import { correspondeSituacaoAcordo } from '@/lib/situacao-acordos';
import { api, errorText } from '@/lib/api';
import { correspondeBusca } from '@/lib/busca';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export function Agreements({ data, onOpen, onNew, canWrite }: JsonData) {
  const [q, setQ] = useState(''),
    [status, setStatus] = useState('');
  const rows = data.agreements.filter(
    (r: AnyRow) =>
      (!q ||
        correspondeBusca(
          `${r.number} ${r.supplier} ${r.cnpj} ${r.locations}`,
          q,
        )) &&
      correspondeSituacaoAcordo(r.effectiveStatus || r.status, status),
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-0 basis-64 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="Pesquisar acordos"
            placeholder="Número, fornecedor, CNPJ ou cidade"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <NativeSelect
          className="w-48"
          aria-label="Situação do acordo"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
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
        {canWrite && (
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = '/api/export/agreements';
            }}
          >
            <Download /> Exportar acordos
          </Button>
        )}
        {canWrite && (
          <Button onClick={onNew}>
            <Plus /> Novo
          </Button>
        )}
      </div>
      <AgreementTable
        rows={rows}
        onOpen={onOpen}
        title={`${rows.length} acordos`}
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
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <Table>
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
                    <button className="text-left" onClick={() => onOpen(r.id)}>
                      <span className="block font-mono text-xs font-semibold text-primary hover:underline">
                        {r.number}
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
        </Table>
      </CardContent>
      <PaginacaoDeLista
        pagina={currentPage}
        paginas={pageCount}
        alterar={setPage}
      />
    </Card>
  );
}

export function AgreementDetail({
  id,
  revision,
  canWrite,
  isAdmin,
  onBack,
  onEdit,
  onItem,
  onImport,
  onDelete,
  run,
}: JsonData) {
  const [snapshot, setSnapshot] = useState<{
      key: string;
      detail: AnyRow;
    } | null>(null),
    [q, setQ] = useState(''),
    [loadError, setLoadError] = useState(''),
    [moreBusy, setMoreBusy] = useState(false),
    [ordem, setOrdem] = useState({ coluna: 0, direcao: 1 });
  const sortKeys = ['item', 'model', 'location', 'brands', 'unit', 'price'];
  const querySort = `sort=${sortKeys[ordem.coluna]}&direction=${ordem.direcao === 1 ? 'asc' : 'desc'}`;
  const key = `${id}?${querySort}`;
  const detail = snapshot?.key === key ? snapshot.detail : null;
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
        next.totalItems !== detail.totalItems
      ) {
        setSnapshot(null);
        await load();
        return;
      }
      setSnapshot({
        key,
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
      setSnapshot({ key, detail: next });
    } catch (error) {
      if (request === sequence.current) setLoadError(errorText(error));
    }
  }, [key]);
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
  if (!detail) return <Loading label="Abrindo acordo…" />;
  const a = detail.agreement,
    items = detail.items.filter(
      (x: AnyRow) =>
        !q || correspondeBusca(`${x.item} ${x.model} ${x.city} ${x.brands}`, q),
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          ← Voltar
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-2xl font-semibold">{a.number}</h2>
            <Status value={a.effectiveStatus || a.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {a.supplier} · {cnpj(a.cnpj)}
          </p>
        </div>
        {canWrite && (
          <>
            <Button
              variant="outline"
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
            {isAdmin && (
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => onDelete(a, detail)}
              >
                <Trash2 /> Excluir acordo
              </Button>
            )}
            <Button
              onClick={() =>
                onItem({
                  agreementId: id,
                  modelIds: [],
                  price: '',
                  locationIds: detail.locations.map((x: AnyRow) => x.id),
                  locationId:
                    detail.locations.length === 1 ? detail.locations[0].id : '',
                })
              }
            >
              <Plus /> Nova condição
            </Button>
          </>
        )}
      </div>
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
          <div>
            <CardTitle>Tabela vigente</CardTitle>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
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
                      <Badge className="bg-sky-50 text-sky-700">Cortesia</Badge>
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
              A ordenação considera todas as condições. O filtro considera
              apenas as já carregadas.
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
    active: [
      'Vigente',
      'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    ],
    scheduled: ['Agendado', 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'],
    expiring: [
      'Vence em até 60 dias',
      'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    ],
    expired: ['Expirado', 'bg-red-50 text-red-700 ring-1 ring-red-200'],
    suspended: ['Suspenso', 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'],
  };
  const x = map[value] || [value, 'bg-slate-100'];
  return <Badge className={x[1]}>{x[0]}</Badge>;
}
