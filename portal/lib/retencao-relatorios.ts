export const VALIDADE_HISTORICO_MS = 24 * 60 * 60 * 1000;
type Execucao = { action?: unknown; completed_at?: unknown; completedAt?: unknown };
type Arquivo = { expiresAt?: unknown; [key: string]: unknown };
export function prazoArquivoHistorico(job: Execucao, arquivo: Arquivo): string | null {
  if (job.action !== 'recorte') return null;
  if (typeof arquivo.expiresAt === 'string' && Number.isFinite(Date.parse(arquivo.expiresAt))) return arquivo.expiresAt;
  // Pedidos anteriores à atualização não tinham validade salva por arquivo.
  const conclusao = job.completed_at ?? job.completedAt;
  if (typeof conclusao !== 'string' || !Number.isFinite(Date.parse(conclusao))) return null;
  return new Date(Date.parse(conclusao) + VALIDADE_HISTORICO_MS).toISOString();
}
export function arquivoHistoricoExpirado(job: Execucao, arquivo: Arquivo, agora = Date.now()): boolean {
  const prazo = prazoArquivoHistorico(job, arquivo);
  return prazo !== null && agora >= Date.parse(prazo);
}
export function informarValidadeArquivos(job: Execucao & { artifactsJson?: unknown; artifacts_json?: unknown }, agora = Date.now()): string {
  let arquivos: unknown;
  try { arquivos = JSON.parse(String(job.artifactsJson ?? job.artifacts_json ?? '[]')); } catch { return '[]'; }
  if (!Array.isArray(arquivos)) return '[]';
  return JSON.stringify(arquivos.filter(a => a && typeof a === 'object').map(a => ({ ...a, expiresAt: prazoArquivoHistorico(job, a), expired: arquivoHistoricoExpirado(job, a, agora) })));
}
