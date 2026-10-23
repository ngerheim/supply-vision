'use client';
import { api, errorText } from '@/lib/api';
import { normalizeImportText } from '@/lib/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SearchSelect } from '@/components/search-select';
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
  FalhaDeCarregamento,
  Field,
} from './portal-presentation';
import { useOrdenacao, CabecalhoOrdenavel } from './portal-table';

export function Mappings({ catalogs, run }: JsonData) {
  const [data, setData] = useState<AnyRow>({ items: [], models: [] }),
    [type, setType] = useState<'items' | 'models' | 'units'>('items'),
    [edit, setEdit] = useState<AnyRow | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const cancelLoad = useCallback(() => {
    sequence.current++;
    controller.current?.abort();
  }, []);
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    const request = ++sequence.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setLoading(true);
    setLoadError('');
    try {
      const next = await api('/api/mappings', { signal: pending.signal });
      if (request === sequence.current) setData(next);
    } catch (error) {
      if (request === sequence.current) setLoadError(errorText(error));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      cancelLoad();
    };
  }, [load, cancelLoad]);
  const rows = data[type] || [],
    targets = catalogs[edit?.type || type].map((row: AnyRow) => ({
      ...row,
      name: (edit?.type || type) === 'units' ? row.code : row.name,
    }));
  const { ordem, alternar, ordenar } = useOrdenacao(type);
  const valoresDoMapeamento = (linha: AnyRow) => [linha.source, linha.target];
  const remove = (row: AnyRow) => {
    if (!confirm(`Excluir a correspondência "${row.source}"?`)) return;
    void run(async () => {
      await api(
        `/api/mappings/${type}/${row.id}?expectedRevision=${row.revision}`,
        { method: 'DELETE' },
      );
      await load();
    }, 'Correspondência excluída.');
  };
  if (loadError)
    return <FalhaDeCarregamento erro={loadError} tentar={() => void load()} />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">De/Para da importação</h1>
        </div>
        <Button variant="create" disabled={busy} onClick={() => setEdit({ type, active: true })}>
          <Plus /> Nova correspondência
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['items', 'models', 'units'] as const).map((value) => (
          <Button
            key={value}
            variant={type === value ? 'default' : 'outline'}
            onClick={() => setType(value)}
          >
            {{ items: 'Itens', models: 'Modelos', units: 'Unidades' }[value]}
          </Button>
        ))}
      </div>
      <Card>
        <CardContent className="px-0 pb-0">
          {loading ? (
            <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Carregando
              correspondências…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <CabecalhoOrdenavel
                  titulos={['Original', 'Correspondente']}
                  ordem={ordem}
                  onAlternar={alternar}
                />
              </TableHeader>
              <TableBody>
                {ordenar(rows, valoresDoMapeamento).map((row: AnyRow) => (
                  <TableRow
                    key={row.id}

                  >
                    <TableCell>
                      <p className="font-medium">{row.source}</p>
                      {normalizeImportText(row.source) !== row.sourceKey && (
                        <p className="text-xs text-muted-foreground">
                          Chave: {row.sourceKey}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{row.target}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Editar correspondência"
                        disabled={busy}
                        onClick={() =>
                          setEdit({
                            ...row,
                            type,
                            expectedRevision: row.revision,
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Excluir correspondência"
                        disabled={busy}
                        onClick={() => remove(row)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!loading && !rows.length && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {type === 'units'
                ? 'Nenhuma correspondência cadastrada. As unidades ativas escritas com a nomenclatura correta já são reconhecidas direto. Cadastre uma correspondência apenas para abreviações, variações de grafia ou nomes alternativos.'
                : 'Nenhuma correspondência cadastrada. A importação será recusada até que os valores da planilha tenham De/Para.'}
            </div>
          )}
        </CardContent>
      </Card>
      {edit && (
        <MappingDialog
          value={edit}
          busy={busy}
          targets={targets}
          onClose={() => setEdit(null)}
          onSave={async (body: AnyRow) => {
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            try {
              await run(async () => {
                const path = body.id
                  ? `/api/mappings/${body.type}/${body.id}`
                  : `/api/mappings/${body.type}`;
                await api(path, {
                  method: body.id ? 'PUT' : 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(body),
                });
                setEdit(null);
                await load();
              }, 'Correspondência salva.');
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function MappingDialog({ value, targets, busy, onClose, onSave }: JsonData) {
  const [form, setForm] = useState<AnyRow>({ ...value });
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            {form.id ? 'Editar correspondência' : 'Nova correspondência'}
          </DialogTitle>
        </DialogHeader>
        <fieldset disabled={busy} className="space-y-4">
          <Field label="Original *">
            <Input
              value={form.source || ''}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            />
          </Field>
          <SearchSelect
            disabled={busy}
            label="Correspondente *"
            value={form.targetId || ''}
            onChange={(targetId: string) => setForm({ ...form, targetId })}
            options={targets.filter(
              (row: AnyRow) => row.active || row.id === form.targetId,
            )}
          />
        </fieldset>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={busy || !form.source?.trim() || !form.targetId}
            onClick={() => !busy && onSave(form)}
          >
            <CheckCircle2 /> Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
