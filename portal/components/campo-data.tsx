'use client';
import { useState } from 'react';
import { dataBrasileiraParaIso, exibirDataBrasileira, mascararDataBrasileira } from '@/lib/data-brasileira';
import { Input } from './ui/input';

/** Displays a Brazilian date while preserving the ISO value used by the API. */
export function CampoData({ value, onChange, min, required, disabled, id }: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const [draft, setDraft] = useState({ iso: value, text: exibirDataBrasileira(value) });
  const text = draft.iso === value ? draft.text : exibirDataBrasileira(value);
  function validar(texto: string) {
    if (!texto) return required ? 'Informe a data.' : '';
    try {
      const iso = dataBrasileiraParaIso(texto);
      return min && iso < min ? `Use uma data a partir de ${exibirDataBrasileira(min)}.` : '';
    } catch { return 'Informe uma data válida em dd/mm/aaaa.'; }
  }
  const error = validar(text);
  return <Input id={id} type="text" inputMode="numeric" placeholder="dd/mm/aaaa" maxLength={10}
    required={required} disabled={disabled} value={text} aria-invalid={!!text && !!error}
    ref={node => { node?.setCustomValidity(error); }}
    onBlur={event => { event.currentTarget.reportValidity(); }}
    onChange={event => {
      const next = mascararDataBrasileira(event.target.value);
      const invalid = validar(next);
      const iso = !next ? '' : invalid ? value : dataBrasileiraParaIso(next);
      event.target.setCustomValidity(invalid);
      setDraft({ iso, text: next });
      if (!invalid || !next) onChange(iso);
    }} />;
}
