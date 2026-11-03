'use client';
import { useState } from 'react';
import { AcoesAnalise } from './portal-analise-acoes';
import { DetalheFornecedor } from './portal-analise';

// Sub-aba Analise > Proximas acoes, com o painel do fornecedor a um clique.
export function PaginaAcoesAnalise() {
  const [fornecedor, setFornecedor] = useState<string | null>(null);
  return <>
    <AcoesAnalise abrirFornecedor={setFornecedor} />
    <DetalheFornecedor nome={fornecedor} fechar={() => setFornecedor(null)} />
  </>;
}
