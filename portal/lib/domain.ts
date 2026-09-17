export const ROLES = ['admin', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const BRAZILIAN_STATES = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;

export function isValidState(value: unknown) {
  return isOneOf(normalizeText(value), BRAZILIAN_STATES);
}

// Situacoes escolhidas manualmente. 'expired' NAO entra aqui: e derivado da
// data de fim da vigencia, para que um acordo nunca fique marcado como vigente
// com a data ja vencida.
export const AGREEMENT_STATUSES = ['active', 'suspended'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const TICKET_STATUSES = ['aberto', 'aguardando_fornecedor', 'fechado', 'cancelado'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['alta', 'media', 'baixa'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 50_000;
export const MIN_PASSWORD_LENGTH = 10;

export function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

export function normalizeText(value: unknown) {
  const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  return text.trim().replace(/\s+/g, ' ').toUpperCase();
}

// Forma canônica usada exclusivamente na entrada de planilhas e nas chaves
// de De/Para. Além de caixa e espaços, remove acentos e caracteres invisíveis
// que costumam vir de cópias do Excel. A pontuação legível é preservada.
export function normalizeImportText(value: unknown) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0141ØĐÐ]/g, (character) => ({ 'Ł': 'L', 'Ø': 'O', 'Đ': 'D', 'Ð': 'D' })[character] || character)
    .replace(/\u00c6/g, 'AE')
    .replace(/\u0152/g, 'OE')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .split('').filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && (code < 127 || code > 159);
    }).join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveImportMapping<T>(value: unknown, mappings: ReadonlyMap<string, T>) {
  return mappings.get(normalizeImportText(value)) ?? null;
}

export function normalizeImportColumn(value: unknown) {
  const key = normalizeImportText(value).replace(/[\s/]+/g, '_');
  const aliases: Record<string, string> = { ITEM: 'PECA_SERVICO', UNIDADE: 'MEDIDA', VALOR: 'PRECO', MARCA: 'MARCAS' };
  return Object.hasOwn(aliases, key) ? aliases[key] : key;
}

export function resolveImportUnit(value: unknown, units: ReadonlyArray<{ code: string; name: string }>) {
  const key = normalizeImportText(value);
  const matches = units.filter((unit) => normalizeImportText(unit.code) === key || normalizeImportText(unit.name) === key);
  return key && matches.length === 1 ? normalizeImportText(matches[0].code) : null;
}

export function normalizeCnpj(value: unknown) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return text.replace(/\D/g, '');
}

// O Excel grava CNPJ como número quando a célula não está formatada como
// texto, e o zero à esquerda se perde no caminho. Como CNPJ tem 14 dígitos
// fixos, um valor com 12 ou 13 dígitos é reconstituível sem ambiguidade.
// Abaixo disso não há o que presumir: não é CNPJ encurtado pela planilha,
// é dado errado, e preencher com zeros transformaria lixo em CNPJ plausível.
export function normalizeImportCnpj(value: unknown) {
  const digits = normalizeCnpj(value);
  return digits.length === 12 || digits.length === 13 ? digits.padStart(14, '0') : digits;
}

export function isValidCnpj(value: unknown) {
  const digits = normalizeCnpj(value);
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;

  const calculateDigit = (length: 12 | 13) => {
    let factor = length - 7;
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * factor;
      factor -= 1;
      if (factor === 1) factor = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return Number(digits[12]) === calculateDigit(12) && Number(digits[13]) === calculateDigit(13);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function isValidDateRange(startDate: unknown, endDate: unknown) {
  if (!isIsoDate(startDate)) return false;
  return endDate === null || endDate === undefined || endDate === '' || (isIsoDate(endDate) && endDate >= startDate);
}

export function toNonNegativeMoney(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

export function validatePassword(value: unknown) {
  const password = typeof value === 'string' ? value : '';
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= 200;
}

export function isAgreementEffective(
  agreement: { status: string; startDate: string; endDate?: string | null },
  today: string,
) {
  return agreement.status === 'active' && agreement.startDate <= today && (!agreement.endDate || agreement.endDate >= today);
}

export function safeFilename(value: unknown) {
  const filename = typeof value === 'string' && value.trim() ? value : 'arquivo.xlsx';
  return filename.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 180);
}

export function errorMessage(error: unknown, fallback = 'Falha inesperada.') {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
