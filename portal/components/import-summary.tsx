'use client';
import { type AnyRow } from './portal-presentation';

export const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    value,
  );
type Estado = 'previa' | 'criado' | 'falhou';

// Um texto so, decidido pelo estado da importacao: na previa nada foi gravado,
// na conclusao os cadastros existem, e numa importacao recusada nada chegou a
// ser criado — dizer "criados" ali seria mentira.
const TITULO_BASE: Record<Estado, string> = {
  previa: 'Cadastros que serão criados a partir do arquivo:',
  criado: 'Cadastros criados a partir do arquivo:',
  falhou: 'Cadastros previstos no arquivo. A importação não foi concluída:',
};

function BaseCriada({ base, estado }: { base: AnyRow; estado: Estado }) {
  // A carga inicial saiu do Portal, mas o historico ainda guarda importacoes
  // dela: este bloco e o aviso de CNPJ abaixo so aparecem para esses registros
  // antigos, e ficam para o historico continuar mostrando o que foi criado.
  const grupos: { chave: string; singular: string; rotulo: string }[] = [
    { chave: 'localidades', singular: 'localidade', rotulo: 'localidades' },
    { chave: 'itens', singular: 'item', rotulo: 'itens' },
    { chave: 'modelos', singular: 'modelo', rotulo: 'modelos' },
    { chave: 'fornecedores', singular: 'fornecedor', rotulo: 'fornecedores' },
  ];
  const quantos = (chave: string) => Number(base[chave]) || 0;
  const amostraDe = (chave: string): string[] => {
    const lista: unknown = base.amostra?.[chave];
    return Array.isArray(lista) ? lista.map((nome) => String(nome)) : [];
  };
  const presentes = grupos.filter((grupo) => quantos(grupo.chave) > 0);
  if (!presentes.length) return null;
  return (
    <div className="space-y-2">
      <p className="font-medium">
        {TITULO_BASE[estado]}{' '}
        {presentes
          .map((grupo) => `${quantos(grupo.chave).toLocaleString('pt-BR')} ${quantos(grupo.chave) === 1 ? grupo.singular : grupo.rotulo}`)
          .join(', ')}
        .
      </p>
      {presentes.map((grupo) => {
        const amostra = amostraDe(grupo.chave);
        if (!amostra.length) return null;
        return (
          <details key={grupo.chave}>
            <summary className="cursor-pointer">
              Ver {grupo.rotulo} ({quantos(grupo.chave)})
            </summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
              {amostra.map((nome, index) => (
                <li key={index}>{nome}</li>
              ))}
            </ul>
            {quantos(grupo.chave) > amostra.length && (
              <p>Amostra dos primeiros {amostra.length}.</p>
            )}
          </details>
        );
      })}
    </div>
  );
}

export function ImportSummary({ summary, estado }: { summary: AnyRow; estado: Estado }) {
  return (
    <div className="space-y-2 text-sm">
      {!!summary.baseCriada && <BaseCriada base={summary.baseCriada} estado={estado} />}
      {!!summary.cnpjsRecuperados && (
        <p>
          {summary.cnpjsRecuperados} CNPJ(s) tiveram zeros à esquerda
          recuperados.
        </p>
      )}
      {!!summary.duplicatas && (
        <details>
          <summary className="cursor-pointer font-medium">
            {summary.duplicatas} linha(s) repetida(s) resolvida(s) pelo menor
            preço
          </summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
            {(summary.amostraDuplicatas || []).map(
              (row: AnyRow, index: number) => (
                <li key={index}>
                  Linha {row.linhaMantida}: {row.item}, {row.cidade} — mantido{' '}
                  {money(row.precoMantido)}; linha {row.linhaDescartada}{' '}
                  descartada ({money(row.precoDescartado)}).
                </li>
              ),
            )}
          </ul>
          {summary.duplicatas > 50 && (
            <p>Amostra dos primeiros 50 descartes.</p>
          )}
        </details>
      )}
    </div>
  );
}
