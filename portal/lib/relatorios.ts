import { EntradaInvalida } from './limites-entrada.ts';
import { isIsoDate, isRecord } from './domain.ts';
import { dataDeNegocio } from './data-negocio.ts';

export const ACOES_RELATORIO = [
  'relatorio',
  'paralelo',
  'debug',
  'recorte',
  'limpeza',
] as const;
export type AcaoRelatorio = (typeof ACOES_RELATORIO)[number];
export const NOMES_ACAO: Record<AcaoRelatorio, string> = {
  relatorio: 'Gerar e enviar relatório',
  paralelo: 'Gerar sem enviar',
  debug: 'Executar com diagnóstico',
  recorte: 'Recorte histórico',
  limpeza: 'Limpeza de arquivos antigos',
};
export type PedidoRelatorio = {
  action: AcaoRelatorio;
  from: string | null;
  to: string | null;
  recipient: string | null;
  dryRun: boolean;
  requestKey: string;
};
export function gerarChaveRelatorio(
  fonte: Pick<Crypto, 'getRandomValues'> = globalThis.crypto,
): string {
  // getRandomValues também funciona no HTTP da rede interna; randomUUID exige HTTPS.
  const bytes = fonte.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function validarPedidoRelatorio(
  body: unknown,
  hoje = dataDeNegocio(),
): PedidoRelatorio {
  if (
    !isRecord(body) ||
    !ACOES_RELATORIO.includes(body.action as AcaoRelatorio)
  )
    throw new EntradaInvalida('Selecione uma operação válida.');
  if (
    typeof body.requestKey !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(body.requestKey)
  )
    throw new EntradaInvalida(
      'Identificador da solicitação inválido. Atualize a tela.',
    );
  const action = body.action as AcaoRelatorio;
  let from: string | null = null,
    to: string | null = null;
  const recipient = null;
  if (action === 'recorte') {
    if (
      typeof body.from !== 'string' ||
      typeof body.to !== 'string' ||
      !isIsoDate(body.from) ||
      !isIsoDate(body.to) ||
      body.from > body.to ||
      body.to > hoje
    )
      throw new EntradaInvalida(
        'Informe um período válido, em ordem e sem datas futuras.',
      );
    from = body.from;
    to = body.to;
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean')
    throw new EntradaInvalida('Opção de simulação inválida.');
  return {
    action,
    from,
    to,
    recipient,
    dryRun: action === 'limpeza' && body.dryRun === true,
    requestKey: body.requestKey,
  };
}
export const SCHEMA_RELATORIOS = [
  `CREATE TABLE IF NOT EXISTS report_jobs (id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,action TEXT NOT NULL,from_date TEXT,to_date TEXT,recipient TEXT,dry_run INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'queued',created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,log TEXT NOT NULL DEFAULT '',artifacts_json TEXT NOT NULL DEFAULT '[]',exit_code INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_report_jobs_queue ON report_jobs(status,created_at)`,
  `CREATE TABLE IF NOT EXISTS report_runner (id INTEGER PRIMARY KEY CHECK(id=1),heartbeat_at TEXT NOT NULL)`,
];
