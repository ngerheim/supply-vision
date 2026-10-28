'use client';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { Table } from '@/components/ui/table';
import { PaginacaoDeLista } from './portal-presentation';

export function BarraFiltros({
  busca, onBusca, placeholder = 'Buscar', children,
}: { busca?: string; onBusca?: (valor: string) => void; placeholder?: string; children?: ReactNode }) {
  return <div className="patio-filters">
    {onBusca && <div className="patio-filter-search"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={placeholder} className="pl-9" placeholder={placeholder} value={busca || ''} onChange={e => onBusca(e.target.value)} /></div>}
    {children}
  </div>;
}

export function TabelaPadrao({ contador, children, pagina, vazio }: { contador: string; children: ReactNode; pagina?: ReactNode; vazio?: ReactNode }) {
  return <Card className="min-w-0 patio-table-card"><CardHeader className="border-b"><p className="patio-result-count">{contador}</p></CardHeader><CardContent className="min-w-0 px-0 pb-0">{vazio || <Table>{children}</Table>}</CardContent>{pagina}</Card>;
}
