import type { ComponentProps } from 'react';
import { Circle, Square, Triangle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const estados: Record<string, string> = {
  aberto: 'open', aberta: 'open', open: 'open', scheduled: 'open',
  em_analise: 'waiting', review: 'waiting', aguardando: 'waiting', aguardando_fornecedor: 'waiting', queued: 'waiting', pending: 'waiting', processing: 'waiting', running: 'waiting', expiring: 'waiting', suspended: 'waiting',
  devolvido: 'returned', devolvida: 'returned', conflict: 'returned',
  concluido: 'done', fechado: 'done', cadastrado: 'done', done: 'done', completed: 'done', sent: 'done', active: 'done',
  cancelado: 'cancelled', recusado: 'cancelled', cancelled: 'cancelled', rejected: 'cancelled', failed: 'cancelled', error: 'cancelled', expired: 'cancelled',
};
const icones = { open: Circle, waiting: Square, returned: Triangle, done: Check, cancelled: X, neutral: Circle };

/** Labels stay with callers; colour and shape have a single owner. */
export function Status({ value, children, className, ...props }: ComponentProps<'span'> & { value: string }) {
  const estado = estados[value] || 'neutral';
  const Icon = icones[estado as keyof typeof icones];
  return <span className={cn('patio-status', `patio-status-${estado}`, className)} {...props}><Icon aria-hidden="true"/>{children ?? value}</span>;
}
