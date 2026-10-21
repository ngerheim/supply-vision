'use client';
import { NOMES_PERFIL } from '@/lib/navegacao';
import { SearchSelect } from '@/components/search-select';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export type JsonData = ReturnType<typeof JSON.parse>;
export type AnyRow = Record<string, JsonData>;

const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR');
export const money = (value: number) => moneyFormatter.format(value ?? 0);
export const date = (value?: string | null) =>
  value
    ? dateFormatter.format(
        new Date(`${value.slice(0, 10)}T12:00:00`),
      )
    : 'Indeterminado';
export const cnpj = (value: string) =>
  (value || '').replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5',
  );
export function Loading({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#eef2f5]">
      <div className="flex items-center gap-3 rounded-2xl bg-white px-6 py-5 shadow-lg">
        <LoaderCircle className="size-5 animate-spin text-primary" />
        <output className="text-sm font-medium">{label}</output>
      </div>
    </div>
  );
}
export function PaginacaoDeLista({
  pagina,
  paginas,
  alterar,
}: {
  pagina: number;
  paginas: number;
  alterar: (pagina: number) => void;
}) {
  return paginas > 1 ? (
    <div className="flex justify-end gap-2 border-t p-3">
      <Button
        variant="outline"
        disabled={pagina === 1}
        onClick={() => alterar(pagina - 1)}
      >
        Anterior
      </Button>
      <Button
        variant="outline"
        disabled={pagina === paginas}
        onClick={() => alterar(pagina + 1)}
      >
        Próxima
      </Button>
    </div>
  ) : null;
}

export function FalhaDeCarregamento({
  erro,
  tentar,
  voltar,
}: {
  erro: string;
  tentar: () => void;
  voltar?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>Não foi possível carregar</AlertTitle>
      <AlertDescription>
        <p>{erro}</p>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" onClick={tentar}>
            Tentar novamente
          </Button>
          {voltar && (
            <Button variant="outline" onClick={voltar}>
              ← Voltar
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
export function Field({ label, children, className = '' }: JsonData) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
export function SelectField({
  label,
  value,
  onChange,
  rows,
  labelFn = (x: AnyRow) => x.name,
  disabled = false,
}: JsonData) {
  return (
    <SearchSelect
      searchable={!label.includes('UF')}
      label={label}
      disabled={disabled}
      value={value}
      onChange={onChange}
      options={rows.map((row: AnyRow) => ({ id: row.id, name: labelFn(row) }))}
    />
  );
}
export const roleName = (x: string) => (NOMES_PERFIL as AnyRow)[x] || x;
export function Empty({ icon: Icon, title, text }: JsonData) {
  return (
    <Card>
      <CardContent className="grid min-h-72 place-items-center text-center">
        <div>
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Icon />
          </div>
          <p className="mt-4 font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function Info({ label, value }: JsonData) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
