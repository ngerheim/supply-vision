'use client';

import { useId, useState } from 'react';
import { correspondeBusca } from '@/lib/busca';
import { Input } from '@/components/ui/input';
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  disabled?: boolean;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const id = useId();
  const visible = options.filter(
    (option) => option.id === value || correspondeBusca(option.name, query),
  );
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {searchable && options.length > 8 && (
        <Input
          aria-label={`Buscar ${label}`}
          placeholder="Digite para filtrar…"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
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
