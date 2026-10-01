'use client';
import { useId, useState } from 'react';
import { correspondeBusca } from '@/lib/busca';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover } from '@base-ui/react/popover';
import { ChevronDown, X } from 'lucide-react';

export function SearchMultiSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState('');
  const id = useId();
  const visible = options.filter((option) =>
    correspondeBusca(option.name, query),
  );
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </legend>
      <Popover.Root>
        <Popover.Trigger className="flex h-10 w-full items-center justify-between rounded-lg border bg-background px-3 text-left text-sm">
          <span className="truncate">
            {value.length ? `${value.length} selecionado(s)` : 'Todos'}{' '}
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} className="z-50">
            <Popover.Popup className="w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border bg-popover p-3 shadow-xl">
              <Popover.Title className="text-sm font-semibold">
                {label}
              </Popover.Title>
              <Input
                id={id}
                aria-label={`Buscar ${label}`}
                placeholder="Digite para filtrar…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="max-h-60 overflow-y-auto rounded-lg border p-1">
                {visible.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={value.includes(option.id)}
                      onCheckedChange={(checked) =>
                        onChange(
                          checked
                            ? [...value, option.id]
                            : value.filter(
                                (selected) => selected !== option.id,
                              ),
                        )
                      }
                    />
                    <span className="break-words">{option.name}</span>
                  </label>
                ))}
                {!visible.length && (
                  <p className="p-2 text-sm text-muted-foreground">
                    Nenhum resultado
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                {!!value.length && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => onChange([])}
                  >
                    Limpar {label.toLowerCase()}
                  </button>
                )}
                <Popover.Close className="ml-auto rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground">
                  Concluir
                </Popover.Close>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {!!value.length && (
        <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
          {value.map((selected) => (
            <button
              key={selected}
              title="Remover filtro"
              onClick={() => onChange(value.filter((id) => id !== selected))}
              className="flex max-w-full items-center gap-1 rounded-md bg-teal-50 px-2 py-1 text-xs text-teal-800"
            >
              <span className="truncate">
                {options.find((option) => option.id === selected)?.name ||
                  selected}
              </span>
              <X className="size-3 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
