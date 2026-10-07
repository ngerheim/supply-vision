'use client';
import { useId, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, X } from 'lucide-react';
import { correspondeBusca } from '@/lib/busca';
export type SearchOption = { id: string; name: string };
export function SearchMultiSelect({ label, value, onChange, options, selectedOptions = options, loading = false }: {
 label: string; value: string[]; onChange: (value: string[]) => void; options: SearchOption[];
 selectedOptions?: SearchOption[]; loading?: boolean;
}) {
 const id = useId();
 const [open, setOpen] = useState(false);
 // Uma seleção indisponível continua visível e removível; nunca desaparece
 // silenciosamente quando outro filtro restringe as opções.
 const selected = value.map(id => options.find(o => o.id === id) || selectedOptions.find(o => o.id === id) || { id, name: 'Seleção não disponível' });
 return <div className="min-w-0 space-y-1.5">
 <label htmlFor={id} className="text-sm font-medium">{label}</label>
 <Combobox.Root multiple items={options} value={selected} open={open}
 onOpenChange={(next, details)=>{
   // O Base UI fecha ao selecionar um resultado quando há texto no input
   // externo. No filtro múltiplo, a pessoa deve poder continuar marcando.
   if (!next && details.reason === 'item-press') { details.cancel(); return; }
   setOpen(next);
 }}
 onValueChange={next=>onChange(next.map(o=>o.id))} itemToStringLabel={o=>o.name}
 isItemEqualToValue={(a,b)=>a.id===b.id} filter={(o,q)=>correspondeBusca(o.name,q)}>
 <Combobox.Chips className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border bg-background px-2 py-1">
 {selected.map(o=><Combobox.Chip key={o.id} className="flex max-w-full items-center gap-1 rounded bg-muted px-1 text-xs" title={!loading && !options.some(option => option.id === o.id) ? 'Sem condições com os demais filtros. Remova esta seleção ou ajuste os outros filtros.' : undefined}>
 <span className="truncate">{o.name}</span><Combobox.ChipRemove aria-label={`Remover ${o.name}`}><X className="size-3"/></Combobox.ChipRemove>
 </Combobox.Chip>)}
 <Combobox.Input id={id} aria-label={`Buscar ${label}`} className="min-w-8 flex-1 bg-transparent text-sm outline-none"/>
 <Combobox.Trigger aria-label={`Selecionar ${label}`}><ChevronDown className="size-4"/></Combobox.Trigger>
 </Combobox.Chips>
 <Combobox.Portal><Combobox.Positioner sideOffset={4} className="z-[150]">
 <Combobox.Popup className="max-h-64 w-[var(--anchor-width)] min-w-48 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
 {loading && <output className="block p-2 text-sm text-muted-foreground">Atualizando opções…</output>}
 <Combobox.Empty className="p-2 text-sm text-muted-foreground">{loading ? '' : 'Nenhuma opção disponível com os demais filtros'}</Combobox.Empty>
 <Combobox.List>{(o:SearchOption)=><Combobox.Item key={o.id} value={o} disabled={loading} className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm data-[highlighted]:bg-muted data-[disabled]:opacity-50">
 <span className="flex size-4 shrink-0 items-center justify-center rounded border"><Combobox.ItemIndicator><Check className="size-3"/></Combobox.ItemIndicator></span><span className="break-words">{o.name}</span>
 </Combobox.Item>}</Combobox.List>
 <div className="sticky bottom-0 mt-1 border-t bg-popover p-1"><button type="button" className="w-full rounded px-3 py-2 text-sm font-medium text-primary hover:bg-muted" onClick={()=>setOpen(false)}>Concluir seleção</button></div>
 </Combobox.Popup>
 </Combobox.Positioner></Combobox.Portal>
 </Combobox.Root>
 </div>;
}
