import { isRecord } from './domain.ts';
import { NOMES_ACAO } from './relatorios.ts';
import { exibirDataBrasileira } from './data-brasileira.ts';

const aliases: Record<string, string> = { catalogItemId: 'catalog_item_id', modelId: 'vehicle_model_id', locationId: 'location_id', unitId: 'unit_id', supplierId: 'supplier_id', agreement_id: 'agreementId', brands: 'brands_text', startDate: 'start_date', endDate: 'end_date' };
export const CAMPOS_REFERENCIAS = ['catalog_item_id', 'vehicle_model_id', 'location_id', 'unit_id', 'supplier_id', 'agreementId'] as const;
const labels: Record<string, string> = { catalog_item_id: 'Item', vehicle_model_id: 'Modelo', location_id: 'Localidade', unit_id: 'Unidade', supplier_id: 'Fornecedor', agreementId: 'Acordo', price: 'Preço', courtesy: 'Cortesia', brands_text: 'Marcas', notes: 'Observações', name: 'Nome', number: 'Número', status: 'Situação', active: 'Ativo', start_date: 'Início', end_date: 'Fim', from: 'Data inicial', to: 'Data final', action: 'Operação', dryRun: 'Simulação', recipient: 'Destinatário' };
const acoes: Record<string, string> = { CREATE: 'Criação', UPDATE: 'Alteração', DELETE: 'Exclusão', IMPORT: 'Importação', COMMENT: 'Andamento', LOGIN: 'Acesso', LOGOUT: 'Saída', EXPORT: 'Exportação', RETRY: 'Reenvio', BLOCKED: 'Bloqueio', UPSERT: 'Inclusão em lote' };
const entidades: Record<string, string> = { agreement: 'Acordo', agreement_item: 'Condição', ticket: 'Chamado', user: 'Usuário', session: 'Sessão', system: 'Sistema', report_job: 'Relatório', legacy_base: 'Carga inicial', suppliers: 'Fornecedor', items: 'Item', models: 'Modelo', units: 'Unidade', brands: 'Marca', locations: 'Localidade', import_mapping: 'De/Para', email_notification: 'Notificação por e-mail' };
export const rotuloAcaoHistorico = (acao: string) => acoes[acao] || acao;
export const rotuloEntidadeHistorico = (entidade: string) => entidades[entidade] || entidade;
function ler(texto: unknown): Record<string, unknown> | null {
  if (typeof texto !== 'string') return null;
  try { const parsed: unknown = JSON.parse(texto); return isRecord(parsed) ? parsed : null; } catch { return null; }
}
function normalizar(obj: unknown): Record<string, unknown> {
  return isRecord(obj) ? Object.fromEntries(Object.entries(obj).map(([key, value]) => [aliases[key] || key, value])) : {};
}
export function referenciasHistorico(textos: unknown[]): Record<string, string[]> {
  const refs = Object.fromEntries([...CAMPOS_REFERENCIAS, 'version_id'].map(c => [c, new Set<string>()]));
  for (const texto of textos) {
    const parsed = ler(texto);
    for (const obj of [parsed, parsed?.antes, parsed?.depois]) {
      const row = normalizar(obj);
      for (const c of [...CAMPOS_REFERENCIAS, 'version_id']) if (typeof row[c] === 'string') refs[c].add(row[c]);
    }
  }
  return Object.fromEntries(Object.entries(refs).map(([c, valores]) => [c, [...valores]]));
}
export function detalhesHistorico(texto: unknown, nomes: Record<string, string> = {}): string {
  if (typeof texto !== 'string' || !texto) return 'Sem detalhes adicionais.';
  const parsed = ler(texto);
  if (!parsed) return texto.trim().startsWith('{') || texto.trim().startsWith('[') ? 'Detalhes técnicos não disponíveis para exibição.' : texto;
  const antes = normalizar(parsed.antes), depois = normalizar(parsed.depois);
  const numeroAcordo = typeof antes.agreementNumber === 'string' && antes.agreementNumber.trim() ? antes.agreementNumber : null;
  const acordoLegado = typeof antes.version_id === 'string' ? nomes[`version_id:${antes.version_id}`] : null;
  const valor = (campo: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return 'Não informado';
    if (campo === 'agreementId' && numeroAcordo) return numeroAcordo;
    if ((CAMPOS_REFERENCIAS as readonly string[]).includes(campo)) return typeof value === 'string' ? nomes[`${campo}:${value}`] || 'Cadastro não disponível' : 'Cadastro não disponível';
    if (campo === 'price' && typeof value === 'number') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    if (['courtesy', 'active', 'dryRun'].includes(campo)) return value === true || value === 1 ? 'Sim' : 'Não';
    if (campo === 'action' && typeof value === 'string') return (NOMES_ACAO as Record<string, string>)[value] || value;
    if (typeof value === 'string' && ['from', 'to', 'start_date', 'end_date'].includes(campo)) return exibirDataBrasileira(value);
    if (campo === 'status' && typeof value === 'string') return ({ active: 'Vigente', suspended: 'Suspenso', closed: 'Concluído', cancelled: 'Cancelado' } as Record<string, string>)[value] || value;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : 'Informação registrada';
  };
  if ('antes' in parsed && 'depois' in parsed) {
    const contexto = { ...antes, ...depois };
    const identificacao = CAMPOS_REFERENCIAS.filter(c => contexto[c] != null).map(c => `${labels[c]}: ${valor(c, contexto[c])}`);
    if (parsed.depois === null) return ['Condição excluída.', ...(!antes.agreementId && acordoLegado ? [`Acordo: ${acordoLegado}`] : []), ...Object.entries(antes).filter(([c]) => labels[c]).map(([c, v]) => `${labels[c]}: ${valor(c, v)}`)].join('\n');
    const mudancas = Object.entries(depois).filter(([c, v]) => labels[c] && JSON.stringify(v) !== JSON.stringify(antes[c])).map(([c, v]) => `${labels[c]}: ${valor(c, antes[c])} → ${valor(c, v)}`);
    return [...identificacao, ...mudancas.length ? mudancas : ['Nenhum campo de negócio alterado.']].join('\n');
  }
  const campos = Object.entries(normalizar(parsed)).filter(([c]) => labels[c]).map(([c, v]) => `${labels[c]}: ${valor(c, v)}`);
  return campos.join('\n') || 'Alteração registrada.';
}
