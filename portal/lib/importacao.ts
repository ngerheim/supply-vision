import {
  isValidCnpj,
  isValidState,
  normalizeCnpj,
  normalizeImportCnpj,
  normalizeImportColumn,
  normalizeImportText,
  normalizeText,
} from './domain.ts';

export type MappingType = 'items' | 'models' | 'locations' | 'units';
export type ImportIssue = {
  campo: string;
  valor: string;
  erro: string;
  tipo?: MappingType;
};
export type ImportTarget = { id: string; name: string };
export type ImportRow = ReturnType<typeof parseImportRow>;

export function chaveLocalidade(cidade: unknown, uf: unknown) {
  return `${normalizeImportText(cidade)}/${normalizeImportText(uf)}`;
}

export function colunasAusentes(row: Record<string, unknown>, legacy: boolean) {
  const presentes = new Set(Object.keys(row).map(normalizeImportColumn));
  return [
    'CIDADE',
    'UF',
    'MODELO',
    'PECA_SERVICO',
    'MEDIDA',
    'PRECO',
    ...(legacy ? ['CNPJ'] : []),
  ].filter((coluna) => !presentes.has(coluna));
}

export function parseImportRow(
  row: Record<string, unknown>,
  rowNumber: number,
  legacy: boolean,
) {
  const values = new Map(
    Object.entries(row).map(([key, value]) => [
      normalizeImportColumn(key),
      value,
    ]),
  );
  const find = (key: string) => values.get(key) ?? '';
  const rawCnpj = legacy ? find('CNPJ') : '',
    cnpj = normalizeImportCnpj(rawCnpj);
  const rawCity = textoSeguro(find('CIDADE')),
    city = normalizeImportText(rawCity),
    state = normalizeImportText(find('UF'));
  const rawModel = textoSeguro(find('MODELO')),
    rawItem = textoSeguro(find('PECA_SERVICO')),
    rawUnit = textoSeguro(find('MEDIDA'));
  const price = parsePrice(find('PRECO'));
  const issues: ImportIssue[] = [];
  for (const [campo, value] of [
    ['CIDADE', city],
    ['UF', state],
    ['MODELO', rawModel],
    ['PECA_SERVICO', rawItem],
    ['MEDIDA', rawUnit],
  ]) {
    if (!normalizeImportText(value))
      issues.push({
        campo: '',
        valor: '',
        erro: `A coluna ${campo} está vazia.`,
      });
  }
  if (price.error) issues.push({ campo: '', valor: '', erro: price.error });
  if (legacy && !isValidCnpj(cnpj))
    issues.push({
      campo: '',
      valor: '',
      erro: `CNPJ inválido: "${textoSeguro(rawCnpj)}".`,
    });
  return {
    rowNumber,
    city,
    state,
    rawCity,
    cnpj,
    cnpjRecuperado: cnpj !== normalizeCnpj(rawCnpj),
    supplier: normalizeImportText(find('FORNECEDOR')),
    model: normalizeImportText(rawModel),
    item: normalizeImportText(rawItem),
    unit: normalizeImportText(rawUnit),
    brands: normalizeImportText(find('MARCAS')),
    price: price.value,
    rawModel,
    rawItem,
    rawUnit,
    itemId: '',
    modelId: '',
    unitId: '',
    locationId: '',
    error: issues[0]?.erro || '',
    issues,
  };
}

// Uma chave normalizada que identifica dois cadastros exige revisao humana.
export function uniqueIndex<T>(entries: Array<[string, T]>) {
  const result = new Map<string, T | null>();
  for (const [key, value] of entries) {
    if (key) result.set(key, result.has(key) ? null : value);
  }
  return result;
}

export type ImportReferences = {
  items: ReadonlyMap<string, ImportTarget>;
  models: ReadonlyMap<string, ImportTarget>;
  units: ReadonlyMap<string, ImportTarget | null>;
  locations: ReadonlyMap<
    string,
    { id: string; city: string; state: string } | null
  >;
  suppliers: ReadonlyMap<string, string>;
};

export function resolveImportRows(
  rows: ImportRow[],
  refs: ImportReferences,
  legacy: boolean,
) {
  for (const row of rows) {
    const issue = (
      campo: string,
      valor: string,
      erro: string,
      tipo?: MappingType,
    ) => row.issues.push({ campo, valor, erro, ...(tipo ? { tipo } : {}) });
    if (legacy && isValidCnpj(row.cnpj)) {
      if (!refs.suppliers.has(row.cnpj))
        issue(
          'CNPJ',
          row.cnpj,
          `Fornecedor sem cadastro ativo para o CNPJ ${row.cnpj}. Cadastre ou reative o fornecedor.`,
        );
      else row.supplier = refs.suppliers.get(row.cnpj)!;
    }
    if (row.city && row.state) {
      const key = chaveLocalidade(row.city, row.state),
        location = refs.locations.get(key);
      if (!location || !isValidState(location.state))
        issue(
          'CIDADE',
          key,
          `Localidade sem correspondência: "${row.rawCity}/${row.state}".${isValidState(row.state) ? '' : ' UF inválida: confira a cidade e o estado.'}`,
          'locations',
        );
      else {
        row.city = normalizeImportText(location.city);
        row.state = location.state;
        row.locationId = location.id;
      }
    }
    for (const [field, value, raw, type] of [
      ['PECA_SERVICO', row.item, row.rawItem, 'items'],
      ['MODELO', row.model, row.rawModel, 'models'],
      ['MEDIDA', row.unit, row.rawUnit, 'units'],
    ] as const) {
      if (!value) continue;
      const target = refs[type].get(value);
      if (!target)
        issue(
          field,
          raw,
          `${type === 'units' ? 'UNIDADE (MEDIDA)' : field} sem correspondência ativa ou ambígua: "${raw}".`,
          type,
        );
      else if (type === 'items') {
        row.itemId = target.id;
        row.item = normalizeImportText(target.name);
      } else if (type === 'models') {
        row.modelId = target.id;
        row.model = normalizeImportText(target.name);
      } else {
        row.unitId = target.id;
        row.unit = normalizeImportText(target.name);
      }
    }
    row.error = row.issues[0]?.erro || '';
  }
}

export function summarizeImportErrors(rows: ImportRow[], sheet: string) {
  const grouped = new Map<
    string,
    {
      campo: string;
      valor: string;
      linhas: number;
      primeiraLinha: number;
      erro: string;
      tipo?: MappingType;
    }
  >();
  const other: { linha: number; erro: string }[] = [];
  const invalid = rows.filter((row) => row.issues.length);
  for (const row of invalid)
    for (const issue of row.issues) {
      if (!issue.campo) {
        other.push({ linha: row.rowNumber, erro: issue.erro });
        continue;
      }
      const key = JSON.stringify([
        issue.campo,
        normalizeImportText(issue.valor),
      ]);
      const previous = grouped.get(key);
      if (previous) previous.linhas++;
      else
        grouped.set(key, { ...issue, linhas: 1, primeiraLinha: row.rowNumber });
    }
  const names = [...grouped.values()].sort((a, b) => b.linhas - a.linhas);
  return {
    sheet,
    totalErros: invalid.length,
    nomenclaturas: names.slice(0, 500),
    nomenclaturasOmitidas: Math.max(0, names.length - 500),
    outrosErros: other.slice(0, 50),
    outrosErrosOmitidos: Math.max(0, other.length - 50),
  };
}

export type Duplicate = {
  item: string;
  modelo: string;
  cidade: string;
  linhaMantida: number;
  linhaDescartada: number;
  precoMantido: number;
  precoDescartado: number;
  motivo: string;
};

// A mesma regra serve a previa, carga inicial e substituicao.
export function deduplicateImportRows(rows: ImportRow[], legacy: boolean) {
  const unique = new Map<string, ImportRow>(),
    duplicates: Duplicate[] = [];
  for (const row of rows) {
    const key = JSON.stringify([
      legacy ? row.cnpj : '',
      row.locationId,
      row.itemId,
      row.modelId,
    ]);
    const previous = unique.get(key);
    if (previous && previous.unitId !== row.unitId)
      throw new Error(
        `Medidas diferentes para o mesmo item nas linhas ${previous.rowNumber} e ${row.rowNumber}: ${row.rawItem}, ${row.model}, ${row.city}/${row.state} — "${previous.rawUnit}" e "${row.rawUnit}". Confira a medida na planilha.`,
      );
    if (!previous) {
      unique.set(key, row);
      continue;
    }
    const kept = row.price < previous.price ? row : previous,
      discarded = kept === row ? previous : row;
    duplicates.push({
      item: discarded.rawItem,
      modelo: discarded.model,
      cidade: chaveLocalidade(discarded.city, discarded.state),
      linhaMantida: kept.rowNumber,
      linhaDescartada: discarded.rowNumber,
      precoMantido: kept.price,
      precoDescartado: discarded.price,
      motivo: kept.price === discarded.price ? 'linha repetida' : 'preço maior',
    });
    unique.set(key, kept);
  }
  const effectiveRows = [...unique.values()];
  return {
    rows: effectiveRows,
    summary: {
      items: effectiveRows.length,
      duplicatas: duplicates.length,
      amostraDuplicatas: duplicates.slice(0, 50),
      locations: new Set(effectiveRows.map((row) => row.locationId)).size,
      ...(legacy
        ? {
            agreements: new Set(effectiveRows.map((row) => row.cnpj)).size,
            suppliers: new Set(effectiveRows.map((row) => row.cnpj)).size,
          }
        : {}),
    },
  };
}

function textoSeguro(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean')
    return String(valor);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return '';
}

function parsePrice(raw: unknown): { value: number; error: string } {
  if (raw === null || raw === undefined)
    return { value: Number.NaN, error: 'A coluna PRECO está vazia.' };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw))
      return { value: Number.NaN, error: 'O preço não é um número válido.' };
    if (raw < 0)
      return { value: Number.NaN, error: `Preço negativo (${raw}).` };
    return { value: raw, error: '' };
  }
  const text = textoSeguro(raw).trim();
  if (!text) return { value: Number.NaN, error: 'A coluna PRECO está vazia.' };

  // Marcadores comuns de "preco ainda nao definido" ganham mensagem propria,
  // porque a correcao e negociar o preco, nao arrumar a planilha.
  const semPreco = [
    'SOB CONSULTA',
    'A COMBINAR',
    'A DEFINIR',
    'CONSULTAR',
    'ORCAMENTO',
    'ORÇAMENTO',
    'N/A',
    'NA',
    'ND',
    '-',
    '--',
    'SEM PRECO',
    'SEM PREÇO',
    '?',
  ];
  if (semPreco.includes(normalizeText(text)))
    return {
      value: Number.NaN,
      error: `Preço não informado ("${text}"). Defina o valor negociado antes de importar.`,
    };

  const limpo = text.replace(/^R\$\s*/i, '').replace(/\s/g, '');
  // Formato brasileiro: ponto e separador de milhar, virgula e decimal.
  if (limpo.includes(',') && !/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(limpo))
    return { value: Number.NaN, error: `Preço inválido: "${text}".` };
  const numerico = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;
  if (!/^\d+(\.\d+)?$/.test(numerico))
    return { value: Number.NaN, error: `Preço inválido: "${text}".` };
  const value = Number(numerico);
  if (!Number.isFinite(value))
    return { value: Number.NaN, error: `Preço inválido: "${text}".` };
  if (value < 0)
    return { value: Number.NaN, error: `Preço negativo: "${text}".` };
  return { value, error: '' };
}
