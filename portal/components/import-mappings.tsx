'use client';
import { useMemo, useState } from 'react';
import { suggestMatches } from '@/lib/sugestoes';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { type AnyRow } from './portal-presentation';

const names: Record<string, string> = {
  items: 'Peça ou serviço',
  models: 'Modelo',
  units: 'Unidade',
  locations: 'Cidade/UF',
};
function optionsFor(
  catalogs: AnyRow,
  type: string,
): { id: string; name: string }[] {
  return (catalogs[type] || [])
    .filter((row: AnyRow) => type === 'locations' || row.active)
    .map((row: AnyRow) => ({
      id: row.id,
      name:
        type === 'locations'
          ? `${row.city}/${row.state}`
          : type === 'units'
            ? row.code
            : row.name,
    }));
}

export function ResolveIssue({
  issue,
  catalogs,
  canManageMappings,
  busy,
  onSave,
  onCatalog,
}: {
  issue: AnyRow;
  catalogs: AnyRow;
  canManageMappings: boolean;
  busy: boolean;
  onSave: (targetId: string) => Promise<void>;
  onCatalog: (type: string, values?: AnyRow) => void;
}) {
  const [target, setTarget] = useState('');
  const options = useMemo(
    () => optionsFor(catalogs, issue.tipo),
    [catalogs, issue.tipo],
  );
  // Medida nao entra na sugestao por semelhanca. Nomenclatura e localidade a
  // pessoa confere batendo o olho; medida, nao — LITRO nao se parece com nada,
  // e aceitar a mais proxima grava preco de litro como preco de unidade em toda
  // a carga, sem travar e sem avisar. Sem cadastro correto, a importacao para.
  // Unidade aceita correspondencia confirmada por Suprimentos ou um administrador, mas nunca
  // por sugestao: medida errada corrompe o preco em silencio. Localidade nao
  // aceita correspondencia nenhuma (o servidor recusa): cidade se cadastra,
  // nao se traduz, entao o unico caminho e cadastrar o que falta.
  const aceitaDePara = Boolean(issue.tipo) && issue.tipo !== 'locations';
  const suggestions = useMemo(
    () => (issue.tipo === 'locations' || issue.tipo === 'units' ? [] : suggestMatches(issue.valor, options)),
    [issue.valor, issue.tipo, options],
  );
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <p className="font-medium">
        {names[issue.tipo || issue.campo] || issue.campo}: {issue.valor}
      </p>
      <p className="text-xs text-muted-foreground">
        {issue.linhas} linha(s), primeira ocorrência na linha{' '}
        {issue.primeiraLinha}. {issue.erro}
      </p>
      {aceitaDePara && canManageMappings ? (
        <>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">Sugestões para conferir:</span>
              {suggestions.map((option) => (
                <Button
                  size="sm"
                  variant="outline"
                  key={option.id}
                  disabled={busy}
                  onClick={() => setTarget(option.id)}
                >
                  {option.name}
                </Button>
              ))}
            </div>
          )}
          <SearchSelect
            label="Correspondência correta"
            value={target}
            onChange={setTarget}
            options={options}
            disabled={busy}
          />
          <Button
            disabled={busy || !target}
            onClick={() => void onSave(target)}
          >
            Confirmar e lembrar correspondência
          </Button>
        </>
      ) : aceitaDePara ? (
        <p className="text-sm">
          Peça a Suprimentos ou a um administrador para confirmar o De/Para ou corrija o valor na
          planilha.
        </p>
      ) : null}
      {issue.tipo && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onCatalog(issue.tipo)}
        >
          Cadastrar opção ausente
        </Button>
      )}
    </div>
  );
}
