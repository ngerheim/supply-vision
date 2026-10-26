'use client';
import { PageHeader } from './page-header';
import { BRAZILIAN_STATES } from '@/lib/domain';
import { correspondeBusca } from '@/lib/busca';
import { useState } from 'react';
import {
  CheckCircle2,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { type JsonData, type AnyRow, cnpj, Field } from './portal-presentation';
import { useOrdenacao, CabecalhoOrdenavel } from './portal-table';

export function CatalogPage({
  type,
  rows,
  onAdd,
  onEdit,
  onDelete,
  tabs,
}: JsonData) {
  const [q, setQ] = useState(''),
    [page, setPage] = useState(1);
  const { ordem, alternar, ordenar } = useOrdenacao(type);
  const names: AnyRow = {
    suppliers: ['Fornecedores'],
    items: ['Peças e serviços'],
    models: ['Modelos de veículos'],
    units: ['Unidades de medida'],
    locations: ['Localidades'],
  };
  const list = rows.filter((r: AnyRow) =>
      correspondeBusca(JSON.stringify(r), q),
    ),
    ordered = ordenar(list, (r: AnyRow) => catalogCells(type, r)),
    pageCount = Math.max(1, Math.ceil(list.length / 25)),
    currentPage = Math.min(page, pageCount),
    visible =
      type === 'suppliers'
        ? ordered.slice((currentPage - 1) * 25, currentPage * 25)
        : ordered;
  return (
    <div className="patio-page">
      <PageHeader
        actions={
          <Button variant="create" onClick={onAdd}>
            <Plus /> Novo
          </Button>
        }
      />
      {tabs}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar"
              className="pl-9"
            aria-label={`Pesquisar ${names[type][0].toLowerCase()}`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <Card>
        <CardHeader className="border-b">
          <p className="patio-result-count">
            {list.length}{' '}
            {list.length === 1
              ? (
                  {
                    suppliers: 'fornecedor',
                    items: 'peça ou serviço',
                    models: 'modelo de veículo',
                    units: 'unidade de medida',
                    locations: 'localidade',
                  } as AnyRow
                )[type]
              : names[type][0].toLowerCase()}
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table
            horizontalControls={type === 'suppliers'}
            className={
              type === 'suppliers'
                ? 'w-full min-w-[850px] table-fixed'
                : undefined
            }
          >
            {type === 'suppliers' && (
              <colgroup>
                {[38, 22, 23, 7, 10].map((width, i) => (
                  <col key={i} style={{ width: `${width}%` }} />
                ))}
              </colgroup>
            )}
            <TableHeader>
              <CabecalhoOrdenavel
                titulos={catalogHeaders(type)}
                ordem={ordem}
                onAlternar={alternar}
              />
            </TableHeader>
            <TableBody>
              {visible.map((r: AnyRow) => (
                <TableRow key={r.id}>
                  {catalogCells(type, r).map((x, i) => (
                    <TableCell
                      key={i}
                      className={i === 0 ? 'truncate font-medium' : 'truncate'}
                      title={String(x)}
                    >
                      {x}
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Editar"
                        onClick={() => onEdit(r)}
                      >
                        <Pencil />
                      </Button>
                      {onDelete && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Excluir"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => onDelete(r)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        {type === 'suppliers' && pageCount > 1 && (
          <div className="flex items-center justify-end gap-2 border-t p-3">
            <span className="mr-3 text-sm text-muted-foreground">
              Página {currentPage} de {pageCount}
            </span>
            <Button
              variant="outline"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Próxima
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
export function Catalogs({ data, onAdd, onEdit, onDelete }: JsonData) {
  const [type, setType] = useState('items');
  const labels: AnyRow = {
    items: 'Peças e serviços',
    models: 'Modelos',
    units: 'Unidades',
    locations: 'Localidades',
  };
  return (
    <CatalogPage
      tabs={
        <div className="patio-choice-tabs">
          {Object.entries(labels).map(([k, v]) => (
            <Button
              key={k}
              variant={type === k ? 'default' : 'outline'}
              onClick={() => setType(k)}
            >
              {String(v)}
            </Button>
          ))}
        </div>
      }
      type={type}
      rows={data.catalogs[type]}
      onAdd={() => onAdd(type)}
      onEdit={(row: AnyRow) => onEdit(type, row)}
      onDelete={(row: AnyRow) => onDelete(type, row)}
    />
  );
}

function catalogHeaders(type: string) {
  if (type === 'suppliers') return ['Nome', 'CNPJ', 'Cidade', 'UF'];
  if (type === 'locations') return ['UF', 'Cidade'];
  if (type === 'units') return ['Unidade'];
  return ['Nome'];
}
function catalogCells(type: string, r: AnyRow) {
  if (type === 'suppliers')
    return [r.tradeName, cnpj(r.cnpj), r.city || '—', r.state || '—'];
  if (type === 'locations') return [r.state, r.city];
  if (type === 'units') return [r.code];
  return [r.name];
}
export function CatalogDialog({
  open,
  value,
  busy,
  onClose,
  onSave,
}: JsonData) {
  const [form, setForm] = useState<AnyRow>(value || {});
  const t = form.type;
  return (
    <Dialog open={open} onOpenChange={(x) => !x && !busy && onClose()}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{form.id ? 'Editar' : 'Novo'} cadastro</DialogTitle>
        </DialogHeader>
        <fieldset disabled={busy} className="space-y-4">
          {t === 'suppliers' && (
            <>
              <Field label="Nome do fornecedor *">
                <Input
                  value={form.tradeName || ''}
                  onChange={(e) =>
                    setForm({ ...form, tradeName: e.target.value })
                  }
                />
              </Field>
              <Field label="Razão social">
                <Input
                  value={form.legalName || ''}
                  onChange={(e) =>
                    setForm({ ...form, legalName: e.target.value })
                  }
                />
              </Field>
              <Field label="CNPJ *">
                <Input
                  value={form.cnpj || ''}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                />
              </Field>
              <Field label="Cidade">
                <Input
                  value={form.city || ''}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
              <Field label="UF">
                <Input
                  maxLength={2}
                  value={form.state || ''}
                  onChange={(e) =>
                    setForm({ ...form, state: e.target.value.toUpperCase() })
                  }
                />
              </Field>
            </>
          )}
          {['items', 'models'].includes(t) && (
            <Field label="Nome *">
              <Input
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
          )}
          {t === 'units' && (
            <Field label="Unidade *">
              <Input
                value={form.code || ''}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </Field>
          )}
          {t === 'locations' && (
            <>
              <SearchSelect
                disabled={busy}
                searchable={false}
                label="UF *"
                value={form.state || ''}
                onChange={(state: string) => setForm({ ...form, state })}
                options={BRAZILIAN_STATES.map((state) => ({
                  id: state,
                  name: state,
                }))}
              />
              <Field label="Cidade *">
                <Input
                  value={form.city || ''}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
            </>
          )}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy} onClick={() => !busy && onSave(form)}>
            {busy ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <CheckCircle2 />
            )}{' '}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
