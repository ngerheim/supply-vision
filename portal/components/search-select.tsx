'use client';

import { useId, useRef } from 'react';
import { correspondeBusca } from '@/lib/busca';
import { ancoraComZoom } from '@/lib/utils';
import { Combobox } from '@base-ui/react/combobox';
import { ChevronDown, Check, X } from 'lucide-react';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

export function SearchSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
  searchable = true,
  limit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  disabled?: boolean;
  searchable?: boolean;
  // Listas longas (ex.: municipios) mostram so os primeiros resultados.
  limit?: number;
}) {
  const id = useId(), campo = useRef<HTMLDivElement>(null);
  // Ao entrar no campo, o texto do valor atual fica selecionado: digitar
  // troca a busca em vez de filtrar pelo valor ja escolhido.
  if (searchable) return <div className="min-w-0 space-y-1.5"><label htmlFor={id} className="text-sm font-medium">{label}</label>
    <Combobox.Root items={options} limit={limit} value={options.find(o=>o.id===value)||null} disabled={disabled} itemToStringLabel={o=>o.name} isItemEqualToValue={(a,b)=>a.id===b.id} filter={(o,q)=>correspondeBusca(o.name,q)} onValueChange={o=>onChange(o?.id||'')}>
      <Combobox.InputGroup ref={campo} className="patio-combo flex items-center rounded-lg border bg-card px-2"><Combobox.Input placeholder="Buscar" id={id} onFocus={e=>e.currentTarget.select()} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"/><Combobox.Clear aria-label={`Limpar ${label}`}><X className="size-3"/></Combobox.Clear><Combobox.Trigger aria-label={`Selecionar ${label}`}><ChevronDown className="size-4"/></Combobox.Trigger></Combobox.InputGroup>
      <Combobox.Portal><Combobox.Positioner anchor={() => ancoraComZoom(campo)} align="start" sideOffset={4} className="z-[150]"><Combobox.Popup className="max-h-64 w-[var(--anchor-width)] min-w-48 overflow-auto rounded-lg border bg-popover p-1 shadow-lg"><Combobox.Empty className="p-2 text-sm empty:hidden">Nenhum resultado</Combobox.Empty><Combobox.List>{(o:{id:string;name:string})=><Combobox.Item key={o.id} value={o} className="flex items-center gap-2 rounded p-2 text-sm data-[highlighted]:bg-muted"><Combobox.ItemIndicator><Check className="size-4"/></Combobox.ItemIndicator><span>{o.name}</span></Combobox.Item>}</Combobox.List></Combobox.Popup></Combobox.Positioner></Combobox.Portal>
    </Combobox.Root></div>;
  const visible = options;
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <NativeSelect
        id={id}
        className="w-full"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <NativeSelectOption value="">
          {visible.length ? 'Selecione' : 'Nenhum resultado'}
        </NativeSelectOption>
        {visible.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
