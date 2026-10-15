'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { TableHead, TableRow } from '@/components/ui/table';
import { type JsonData, type AnyRow } from './portal-presentation';

// Ordenacao no cliente: a listagem ja vem inteira do servidor, entao nao ha
// motivo para ida e volta. Sao tres estados por coluna — crescente, decrescente
// e sem ordenacao — para dar como voltar a ordem original. A comparacao usa
// colacao pt-BR com numeric, para "HILUX 2.10" vir depois de "HILUX 2.8" e
// acento nao jogar a palavra para o fim da lista.
export function useOrdenacao(chave?: string) {
  const [escolha, setEscolha] = useState<AnyRow | null>(null);
  // A escolha guarda a aba em que foi feita. Trocar de aba muda o significado
  // das colunas, entao a escolha antiga passa a ser ignorada — derivado, sem
  // efeito colateral, que e o que o react-compiler exige.
  const ordem = escolha && escolha.chave === chave ? escolha : null;
  const alternar = (coluna: number) =>
    setEscolha(
      !ordem || ordem.coluna !== coluna
        ? { chave, coluna, direcao: 1 }
        : ordem.direcao === 1
          ? { chave, coluna, direcao: -1 }
          : null,
    );
  // Converte so o que tem representacao textual obvia. String() sobre valor de
  // tipo desconhecido produziria "[object Object]" numa celula que fosse um no
  // de JSX, e a ordenacao sairia errada sem ninguem notar.
  const texto = (valor: unknown) =>
    typeof valor === 'string'
      ? valor
      : typeof valor === 'number' || typeof valor === 'boolean'
        ? String(valor)
        : '';
  const ordenar = (linhas: AnyRow[], valores: (linha: AnyRow) => unknown[]) => {
    if (!ordem) return linhas;
    const colacao = new Intl.Collator('pt-BR', {
      numeric: true,
      sensitivity: 'base',
    });
    return [...linhas].sort(
      (a, b) =>
        colacao.compare(
          texto(valores(a)[ordem.coluna]),
          texto(valores(b)[ordem.coluna]),
        ) * ordem.direcao,
    );
  };
  return { ordem, alternar, ordenar };
}

export function CabecalhoOrdenavel({
  titulos,
  ordem,
  onAlternar,
  acoes = true,
}: JsonData) {
  return (
    <TableRow>
      {titulos.map((titulo: string, indice: number) => (
        <TableHead key={titulo}>
          <button
            type="button"
            className="flex items-center gap-1 hover:text-foreground"
            onClick={() => onAlternar(indice)}
            aria-label={`Ordenar por ${titulo}`}
          >
            {titulo}
            {ordem?.coluna === indice ? (
              ordem.direcao === 1 ? (
                <ArrowUp className="size-3" />
              ) : (
                <ArrowDown className="size-3" />
              )
            ) : (
              <ArrowUpDown className="size-3 opacity-40" />
            )}
          </button>
        </TableHead>
      ))}
      {acoes && <TableHead />}
    </TableRow>
  );
}
