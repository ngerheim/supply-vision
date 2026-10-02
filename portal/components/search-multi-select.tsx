'use client';
import { useId, useState } from 'react';
import { correspondeBusca } from '@/lib/busca';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

export function SearchMultiSelect({ label, value, onChange, options }: {
  label: string; value: string[]; onChange: (value: string[]) => void;
  options: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState('');
  const id = useId();
  const visible = options.filter(option => correspondeBusca(option.name, query));
  return <fieldset className="min-w-0 space-y-2">
    <legend className="text-sm font-medium">{label}</legend>
    <Input id={id} aria-label={`Buscar ${label}`} placeholder="Digite para filtrar…" value={query} onChange={event => setQuery(event.target.value)}/>
    <div className="h-40 overflow-y-auto rounded-lg border p-1">
      {visible.map(option => <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-muted">
        <Checkbox checked={value.includes(option.id)} onCheckedChange={checked => onChange(checked ? [...value, option.id] : value.filter(selected => selected !== option.id))}/>
        <span className="break-words">{option.name}</span>
      </label>)}
      {!visible.length && <p className="p-2 text-sm text-muted-foreground">Nenhum resultado</p>}
    </div>
    {!!value.length && <button type="button" className="text-xs text-primary hover:underline" onClick={() => onChange([])}>Limpar {label.toLowerCase()}</button>}
  </fieldset>;
}
