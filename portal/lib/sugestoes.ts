import { normalizeImportText } from './domain.ts';

type Option = { id: string; name: string };

// Apenas ordena candidatos para revisao humana. Nunca resolve a importacao.
function pairs(value: string) {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index++)
    result.add(value.slice(index, index + 2));
  return result;
}

export function suggestMatches(
  source: string,
  options: readonly Option[],
  limit = 3,
): Option[] {
  const key = normalizeImportText(source),
    sourcePairs = pairs(key);
  if (!key) return [];
  return options
    .map((option) => {
      const target = normalizeImportText(option.name),
        targetPairs = pairs(target);
      let common = 0;
      for (const pair of sourcePairs) if (targetPairs.has(pair)) common++;
      const score =
        key === target
          ? 1
          : (2 * common) / Math.max(1, sourcePairs.size + targetPairs.size);
      return { option, score };
    })
    .filter((candidate) => candidate.score >= 0.35)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.option.name.localeCompare(b.option.name, 'pt-BR'),
    )
    .slice(0, limit)
    .map((candidate) => candidate.option);
}
