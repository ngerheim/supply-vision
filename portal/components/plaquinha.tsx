import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Plaquinha({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('patio-placa', className)} {...props}/>;
}
