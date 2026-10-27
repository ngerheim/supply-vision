'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, X } from 'lucide-react';
import { correspondeBusca } from '@/lib/busca';
export type SearchOption = { id: string; name: string };
export function SearchMultiSelect({
  label,
  value,
  onChange,
  options,
  selectedOptions = options,
  loading = false,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: SearchOption[];
  selectedOptions?: SearchOption[];
  loading?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false),
    [visibleCount, setVisibleCount] = useState(0);
  const control = useRef<HTMLDivElement>(null),
    measure = useRef<HTMLSpanElement>(null);
  // Uma seleção indisponível continua visível e removível; nunca desaparece
  // silenciosamente quando outro filtro restringe as opções.
  const selected = value.map(
    (id) =>
      options.find((o) => o.id === id) ||
      selectedOptions.find((o) => o.id === id) || {
        id,
        name: 'Seleção não disponível',
      },
  );
  const selectionKey = JSON.stringify(selected.map((o) => [o.id, o.name]));
  useEffect(() => {
    const node = control.current,
      sizes = measure.current;
    if (!node || !sizes) return;
    let active = true;
    const update = () => {
      if (!active) return;
      const widths = Array.from(
        sizes.children,
        (child) => child.getBoundingClientRect().width + 4,
      );
      const available = Math.max(0, node.clientWidth - 80);
      let used = 0,
        count = 0;
      for (const width of widths) {
        if (used + width > available - (count < widths.length - 1 ? 28 : 0))
          break;
        used += width;
        count++;
      }
      setVisibleCount((current) => (current === count ? current : count));
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    void document.fonts.ready.then(update);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [selectionKey]);
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Combobox.Root
        multiple
        items={options}
        value={selected}
        open={open}
        onOpenChange={(next, details) => {
          // O Base UI fecha ao selecionar um resultado quando há texto no input
          // externo. No filtro múltiplo, a pessoa deve poder continuar marcando.
          if (!next && details.reason === 'item-press') {
            details.cancel();
            return;
          }
          setOpen(next);
        }}
        onValueChange={(next) => onChange(next.map((o) => o.id))}
        itemToStringLabel={(o) => o.name}
        isItemEqualToValue={(a, b) => a.id === b.id}
        filter={(o, q) => correspondeBusca(o.name, q)}
      >
        <Combobox.Chips ref={control} className="patio-multicontrol">
          {selected.slice(0, visibleCount).map((o) => (
            <Combobox.Chip
              key={o.id}
              className="patio-chip"
              title={
                !loading && !options.some((option) => option.id === o.id)
                  ? 'Sem condições com os demais filtros. Remova esta seleção ou ajuste os outros filtros.'
                  : undefined
              }
            >
              <span className="truncate">{o.name}</span>
              <Combobox.ChipRemove aria-label={`Remover ${o.name}`}>
                <X className="size-3" />
              </Combobox.ChipRemove>
            </Combobox.Chip>
          ))}
          {selected.length > visibleCount && (
            <button
              type="button"
              className="patio-chip-overflow"
              title={selected
                .slice(visibleCount)
                .map((o) => o.name)
                .join(', ')}
              aria-label={`${selected.length - visibleCount} outras seleções de ${label}`}
              onClick={() => setOpen(true)}
            >
              +{selected.length - visibleCount}
            </button>
          )}
          <span ref={measure} className="patio-chip-measure" aria-hidden="true">
            {selected.map((o) => (
              <span key={o.id}>{o.name}</span>
            ))}
          </span>
          <Combobox.Input
            placeholder="Buscar"
            id={id}
            aria-label={`Buscar ${label}`}
            className="text-sm"
          />
          <Combobox.Trigger
            className="patio-multitrigger"
            aria-label={`Selecionar ${label}`}
          >
            <ChevronDown className="size-4" />
          </Combobox.Trigger>
        </Combobox.Chips>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="z-[150]">
            <Combobox.Popup className="max-h-64 w-[var(--anchor-width)] min-w-48 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
              {loading && (
                <output className="block p-2 text-sm text-muted-foreground">
                  Atualizando opções…
                </output>
              )}
              {selected.length > 0 && (
                <div className="border-b p-1">
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    Selecionadas
                  </p>
                  {selected.map((o) => {
                    const unavailable = !options.some(
                      (option) => option.id === o.id,
                    );
                    return (
                      <div
                        key={o.id}
                        className="flex items-center gap-2 rounded p-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 break-words">
                          {o.name}
                          {unavailable && (
                            <span className="ml-1 text-muted-foreground">
                              (indisponível)
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remover ${o.name}`}
                          className="shrink-0 rounded p-1 hover:bg-muted"
                          onClick={() =>
                            onChange(value.filter((id) => id !== o.id))
                          }
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <Combobox.Empty className="p-2 text-sm text-muted-foreground">
                {loading
                  ? ''
                  : 'Nenhuma opção disponível com os demais filtros'}
              </Combobox.Empty>
              <Combobox.List>
                {(o: SearchOption) => (
                  <Combobox.Item
                    key={o.id}
                    value={o}
                    disabled={loading}
                    className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm data-[highlighted]:bg-muted data-[disabled]:text-muted-foreground"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center rounded border">
                      <Combobox.ItemIndicator>
                        <Check className="size-3" />
                      </Combobox.ItemIndicator>
                    </span>
                    <span className="break-words">{o.name}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
