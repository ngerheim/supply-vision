'use client';

import { useState } from 'react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { correspondeBusca } from '@/lib/busca';
import { BRAZILIAN_STATES } from '@/lib/domain';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type AnyRow = Record<string, ReturnType<typeof JSON.parse>>;
type Props = {
  open: boolean;
  value: AnyRow;
  catalogs: AnyRow;
  busy: boolean;
  onClose: () => void;
  onSave: (value: AnyRow) => unknown;
};
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function AgreementDialog({
  open,
  value,
  catalogs,
  busy,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<AnyRow>(value);
  const [query, setQuery] = useState(''),
    [state, setState] = useState('');
  const selected: string[] = form.locationIds || [];
  const locations = catalogs.locations.filter(
    (row: AnyRow) =>
      (!state || row.state === state) && correspondeBusca(row.city, query),
  );
  const toggle = (id: string) =>
    setForm({
      ...form,
      locationIds: selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    });
  const ready =
    form.number?.trim() && form.supplierId && form.startDate && selected.length;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Editar acordo' : 'Novo acordo'}</DialogTitle>
          <DialogDescription>
            Identifique o acordo. Depois de salvar, inclua os preços manualmente
            ou por planilha.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) onSave(form);
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Número do acordo *">
                <Input
                  required
                  maxLength={80}
                  value={form.number || ''}
                  onChange={(event) =>
                    setForm({ ...form, number: event.target.value })
                  }
                />
              </Field>
              <SearchSelect
                label="Fornecedor / CNPJ *"
                value={form.supplierId || ''}
                onChange={(supplierId) => setForm({ ...form, supplierId })}
                options={catalogs.suppliers
                  .filter(
                    (row: AnyRow) => row.active || row.id === form.supplierId,
                  )
                  .map((row: AnyRow) => ({
                    id: row.id,
                    name: `${row.tradeName} · ${row.cnpj}`,
                  }))}
              />
              <Field label="Início da vigência *">
                <Input
                  type="date"
                  required
                  value={form.startDate || ''}
                  onChange={(event) =>
                    setForm({ ...form, startDate: event.target.value })
                  }
                />
              </Field>
              <Field label="Fim da vigência (opcional)">
                <Input
                  type="date"
                  min={form.startDate || undefined}
                  value={form.endDate || ''}
                  onChange={(event) =>
                    setForm({ ...form, endDate: event.target.value })
                  }
                />
              </Field>
              <SearchSelect
                label="Situação"
                value={form.status || 'active'}
                onChange={(status) => setForm({ ...form, status })}
                options={[
                  { id: 'active', name: 'Vigente' },
                  { id: 'suspended', name: 'Suspenso' },
                ]}
              />
              <p className="self-end text-xs text-muted-foreground">
                O acordo fica expirado automaticamente ao fim da vigência.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Localidades abrangidas * · {selected.length} selecionada(s)
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <SearchSelect
                  searchable={false}
                  label="Filtrar por UF"
                  value={state}
                  onChange={setState}
                  options={BRAZILIAN_STATES.map((state) => ({
                    id: state,
                    name: state,
                  }))}
                />
                <Field label="Buscar cidade">
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Digite parte do nome…"
                  />
                </Field>
              </div>
              <div className="grid max-h-48 gap-1 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
                {locations.map((row: AnyRow) => (
                  <label
                    key={row.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-muted"
                  >
                    <Checkbox
                      checked={selected.includes(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                    />
                    <span>
                      {row.city} / {row.state}
                    </span>
                  </label>
                ))}
                {!locations.length && (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma localidade encontrada. Confira o filtro ou inclua a
                    cidade em Cadastros.
                  </p>
                )}
              </div>
            </div>
            {!catalogs.suppliers.length && (
              <p className="text-sm text-muted-foreground">
                Inclua o fornecedor na aba Fornecedores antes de criar o acordo.
              </p>
            )}
            <Field label="Observações">
              <Textarea
                value={form.notes || ''}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </Field>
          </fieldset>
          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <CheckCircle2 />
              )}{' '}
              Salvar acordo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ItemDialog({
  open,
  value,
  catalogs,
  busy,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<AnyRow>(value),
    [query, setQuery] = useState('');
  const editing = !!form.id,
    selected: string[] = form.modelIds || [];
  const options = (type: string) =>
    catalogs[type]
      .filter((row: AnyRow) => row.active)
      .map((row: AnyRow) => ({
        id: row.id,
        name: type === 'units' ? row.code : row.name,
      }));
  const locations = catalogs.locations.filter((row: AnyRow) =>
    (value.locationIds || []).includes(row.id),
  );
  const toggle = (id: string) =>
    setForm({
      ...form,
      modelIds: selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    });
  const ready =
    form.catalogItemId &&
    form.locationId &&
    form.unitId &&
    (editing ? form.modelId : selected.length) &&
    form.price !== '' &&
    form.price !== undefined &&
    form.price !== null &&
    Number(form.price) >= 0;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Editar condição' : 'Nova condição acordada'}
          </DialogTitle>
          <DialogDescription>
            Escolha a peça, a cidade e o preço. Você pode aplicar o mesmo preço
            a vários modelos.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) onSave(form);
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <SearchSelect
                label="Peça ou serviço *"
                value={form.catalogItemId || ''}
                onChange={(catalogItemId) =>
                  setForm({ ...form, catalogItemId })
                }
                options={options('items')}
              />
              <SearchSelect
                label="Localidade do acordo *"
                value={form.locationId || ''}
                onChange={(locationId) => setForm({ ...form, locationId })}
                options={locations.map((row: AnyRow) => ({
                  id: row.id,
                  name: `${row.city} / ${row.state}`,
                }))}
              />
              <Field label="Preço (R$) *">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.price ?? ''}
                  onChange={(event) =>
                    setForm({ ...form, price: event.target.value })
                  }
                />
                <span className="text-xs text-muted-foreground">
                  Use zero para cortesia.
                </span>
              </Field>
              <SearchSelect
                label="Unidade *"
                value={form.unitId || ''}
                onChange={(unitId) => setForm({ ...form, unitId })}
                options={options('units')}
              />
            </div>
            {editing ? (
              <SearchSelect
                label="Modelo *"
                value={form.modelId || ''}
                onChange={(modelId) => setForm({ ...form, modelId })}
                options={options('models')}
              />
            ) : (
              <div className="space-y-2">
                <Field
                  label={`Modelos aplicáveis * · ${selected.length} selecionado(s)`}
                >
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar modelo…"
                  />
                </Field>
                <div className="grid max-h-48 gap-1 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
                  {options('models')
                    .filter((row: AnyRow) => correspondeBusca(row.name, query))
                    .map((row: AnyRow) => (
                      <label
                        key={row.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-muted"
                      >
                        <Checkbox
                          checked={selected.includes(row.id)}
                          onCheckedChange={() => toggle(row.id)}
                        />
                        <span>{row.name}</span>
                      </label>
                    ))}
                </div>
              </div>
            )}
            <Field label="Marcas aceitas (opcional)">
              <Input
                placeholder="Ex.: BOSCH / FRASLE / TRW"
                value={form.brands || ''}
                onChange={(event) =>
                  setForm({ ...form, brands: event.target.value })
                }
              />
            </Field>
            <Field label="Observações">
              <Textarea
                value={form.notes || ''}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </Field>
          </fieldset>
          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <CheckCircle2 />
              )}{' '}
              Salvar condição
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
