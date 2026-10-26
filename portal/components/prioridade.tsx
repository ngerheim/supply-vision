import { cn } from '@/lib/utils';

const nomes: Record<string, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
};
export function Prioridade({ value }: { value: string }) {
  return (
    <span className={cn('patio-prioridade', `patio-prioridade-${value}`)}>
      {nomes[value] ?? value}
    </span>
  );
}
