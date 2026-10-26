'use client';
import { rotuloSituacao } from '@/lib/solicitacoes-cliente';
import { TicketStatus } from './portal-tickets';

export function SituacaoSolicitacao({ value }: { value: string }) {
  const tons: Record<string, string> = {
    aberta: 'aberto',
    em_analise: 'aguardando_fornecedor',
    devolvida: 'aguardando_fornecedor',
    cadastrado: 'fechado',
    recusado: 'cancelado',
  };
  return <TicketStatus value={tons[value]} label={rotuloSituacao(value)} />;
}
