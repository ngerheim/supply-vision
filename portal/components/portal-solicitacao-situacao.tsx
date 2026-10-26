'use client';
import { rotuloSituacao } from '@/lib/solicitacoes-cliente';
import { Status } from './status';

export function SituacaoSolicitacao({ value }: { value: string }) {
  return <Status value={value}>{rotuloSituacao(value)}</Status>;
}
