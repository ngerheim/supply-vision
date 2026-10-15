'use client';
import { api, errorText } from '@/lib/api';
import { normalizeImportText } from '@/lib/domain';
import { useCallback, useEffect, useState } from 'react';
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
  SelectField,
} from './portal-presentation';
import { useOrdenacao, CabecalhoOrdenavel } from './portal-table';

export function Mappings({ catalogs, run }: JsonData) {
  const [data, setData] = useState<AnyRow>({ items: [], models: [] }),
    [type, setType] = useState<'items' | 'models' | 'units'>('items'),
    [edit, setEdit] = useState<AnyRow | null>(null),
    [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setData(await api('/api/mappings'));
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);
  const rows = data[type] || [],
    targets = catalogs[type].map((row: AnyRow) => ({
      ...row,
      name: type === 'units' ? row.code : row.name,
      active: row.active,
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
        <Button onClick={() => setEdit({ type, active: true })}>
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
                    className={row.active ? '' : 'opacity-50'}
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
          targets={targets}
          onClose={() => setEdit(null)}
          onSave={(body: AnyRow) =>
            run(async () => {
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
            }, 'Correspondência salva.')
          }
        />
      )}
    </div>
  );
}

function MappingDialog({ value, targets, onClose, onSave }: JsonData) {
  const [form, setForm] = useState<AnyRow>({ ...value });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {form.id ? 'Editar' : 'Nova correspondência'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field
            label={
              form.type === 'locations'
                ? 'Original (CIDADE/UF) *'
                : 'Original *'
            }
          >
            <Input
              value={form.source || ''}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            />
          </Field>
          <SelectField
            label="Correspondente *"
            value={form.targetId || ''}
            onChange={(targetId: string) => setForm({ ...form, targetId })}
            rows={targets.filter((row: AnyRow) => row.active)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!form.source || !form.targetId}
            onClick={() => onSave(form)}
          >
            <CheckCircle2 /> Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
