'use client';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  busy = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  busy?: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      aria-label="Paginação"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm"
    >
      <span aria-live="polite">
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`
          : '0'}{' '}
        de {total.toLocaleString('pt-BR')} registros
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label="Registros por página"
          value={pageSize}
          disabled={busy}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {[25, 50, 100].map((size) => (
            <NativeSelectOption key={size} value={size}>
              {size} por página
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          disabled={busy || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Anterior
        </Button>
        <span>
          Página {page} de {pages}
        </span>
        <Button
          variant="outline"
          disabled={busy || page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Próxima
        </Button>
      </div>
    </nav>
  );
}
