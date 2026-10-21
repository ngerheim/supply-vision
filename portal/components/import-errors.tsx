'use client';
import { type AnyRow, type JsonData } from './portal-presentation';

// Le tanto o formato novo (nomenclaturas agrupadas + erros de linha) quanto o
// antigo (sampleErrors), porque o historico guarda importacoes ja feitas.
export function ListaErros({ resumo }: JsonData) {
  if (!resumo) return null;
  const nomenclaturas = resumo.nomenclaturas || [],
    outros = resumo.outrosErros || [],
    legado = resumo.sampleErrors || [];
  if (!nomenclaturas.length && !outros.length && !legado.length) return null;
  return (
    <div className="mt-2 space-y-3">
      {nomenclaturas.length > 0 && (
        <div>
          <p className="mb-1 font-medium">
            Nomenclaturas sem correspondência ({nomenclaturas.length})
          </p>
          <ul className="max-h-64 space-y-1 overflow-auto rounded-lg border p-3">
            {nomenclaturas.map((n: AnyRow, index: number) => (
              <li key={`${n.campo}-${n.valor}-${index}`} className="text-xs">
                <b>{n.campo}:</b> {n.valor} —{' '}
                {Number(n.linhas).toLocaleString('pt-BR')} linha(s), a partir da
                linha {n.primeiraLinha}
              </li>
            ))}
          </ul>
          {resumo.nomenclaturasOmitidas > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              e mais {resumo.nomenclaturasOmitidas} não exibida(s).
            </p>
          )}
        </div>
      )}
      {outros.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Outros erros</p>
          <ul className="max-h-64 space-y-1 overflow-auto rounded-lg border p-3">
            {outros.map((e: AnyRow, index: number) => (
              <li key={`${e.linha}-${index}`} className="text-xs">
                <b>Linha {e.linha}:</b> {e.erro}
              </li>
            ))}
          </ul>
          {resumo.outrosErrosOmitidos > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              e mais {resumo.outrosErrosOmitidos} não exibido(s).
            </p>
          )}
        </div>
      )}
      {legado.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Erros encontrados</p>
          <ul className="max-h-64 space-y-1 overflow-auto rounded-lg border p-3">
            {legado.map((e: AnyRow, index: number) => (
              <li key={`${e.row}-${index}`} className="text-xs">
                <b>Linha {e.row}:</b> {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
