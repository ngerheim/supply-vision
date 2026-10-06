import { env } from 'cloudflare:workers';
import { id, now, rawDb } from './database';
import { validarPedidoRelatorio } from './relatorios.ts';
import { informarValidadeArquivos, arquivoHistoricoExpirado } from './retencao-relatorios.ts';

const resposta = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function consultarRelatorios(jobId?: string, arquivo?: string) {
  if (!jobId) {
    const [jobs, runner] = await Promise.all([
      rawDb()
        .prepare(
          `SELECT j.id,j.action,j.from_date AS "from",j.to_date AS "to",j.recipient,j.dry_run AS dryRun,j.status,j.created_at AS createdAt,j.started_at AS startedAt,j.completed_at AS completedAt,j.artifacts_json AS artifactsJson,u.name AS requestedBy FROM report_jobs j JOIN users u ON u.id=j.created_by ORDER BY j.created_at DESC,j.id DESC LIMIT 100`,
        )
        .all(),
      rawDb()
        .prepare(
          'SELECT heartbeat_at AS heartbeatAt FROM report_runner WHERE id=1',
        )
        .first<{ heartbeatAt: string }>(),
    ]);
    return resposta({
      jobs: jobs.results.map(job => ({ ...job, artifactsJson: informarValidadeArquivos(job) })),
      runnerOnline:
        !!runner && Date.now() - Date.parse(runner.heartbeatAt) < 30_000,
    });
  }
  const job = await rawDb()
    .prepare(
      'SELECT *,artifacts_json AS artifactsJson FROM report_jobs WHERE id=?',
    )
    .bind(jobId)
    .first();
  if (!job) return resposta({ error: 'Execução não encontrada.' }, 404);
  if (!arquivo) return resposta({ job: { ...job, artifactsJson: informarValidadeArquivos(job) } });
  const artifact = JSON.parse(informarValidadeArquivos(job)).find((a: { name: string }) => a.name === arquivo);
  if (!artifact) return resposta({ error: 'Arquivo não encontrado nesta execução.' }, 404);
  if (artifact && arquivoHistoricoExpirado(job, artifact)) return resposta({ error: 'Arquivo expirado. Os históricos ficam disponíveis por 24 horas. Gere um novo recorte.' }, 410);
  const vars = env as unknown as {
    PORTAL_API_TOKEN?: string;
    RELATORIOS_PORTA?: string;
  };
  const token = vars.PORTAL_API_TOKEN,
    porta = Number(vars.RELATORIOS_PORTA || 3001);
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535)
    return resposta({ error: 'Porta do serviço de relatórios inválida.' }, 503);
  if (!/^[a-zA-Z0-9_.-]+$/.test(arquivo) || !token)
    return resposta({ error: 'Arquivo não encontrado.' }, 404);
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const download = await fetch(
      `http://127.0.0.1:${porta}/${encodeURIComponent(jobId)}/${encodeURIComponent(arquivo)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    if (!download.ok)
      return resposta(
        {
          error:
            download.status === 410
              ? 'Arquivo expirado. Gere um novo recorte para baixar.'
              : download.status === 404
              ? 'Arquivo não disponível; pode ter sido apagado pela limpeza.'
              : 'Serviço de relatórios indisponível.',
        },
        download.status === 410 ? 410 : download.status === 404 ? 404 : 503,
      );
    return new Response(download.body, {
      headers: {
        'cache-control': 'no-store',
        'content-type':
          download.headers.get('content-type') || 'application/octet-stream',
        'content-disposition': `attachment; filename="${arquivo}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (erro) {
    console.error('[relatorios] download indisponivel:', erro);
    return resposta(
      {
        error:
          'Serviço de relatórios indisponível. Confira se a operação está iniciada.',
      },
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}
export async function solicitarRelatorio(body: unknown, userId: string) {
  const pedido = validarPedidoRelatorio(body);
  const anterior = await rawDb()
    .prepare(
      'SELECT id,action,from_date,to_date,recipient,dry_run,created_by FROM report_jobs WHERE request_key=?',
    )
    .bind(pedido.requestKey)
    .first();
  if (anterior) {
    if (
      anterior.created_by !== userId ||
      anterior.action !== pedido.action ||
      anterior.from_date !== pedido.from ||
      anterior.to_date !== pedido.to ||
      anterior.recipient !== pedido.recipient ||
      Boolean(anterior.dry_run) !== pedido.dryRun
    )
      return resposta(
        {
          error:
            'Esta solicitação já foi usada para outra operação. Atualize a tela.',
        },
        409,
      );
    return resposta({ id: anterior.id }, 202);
  }
  const runner = await rawDb()
    .prepare('SELECT heartbeat_at AS heartbeatAt FROM report_runner WHERE id=1')
    .first<{ heartbeatAt: string }>();
  if (!runner || Date.now() - Date.parse(runner.heartbeatAt) >= 30_000)
    return resposta(
      { error: 'Inicie a operação na central para habilitar os relatórios.' },
      503,
    );
  const jobId = id('rpt'),
    timestamp = now();
  try {
    const [inserida] = await rawDb().batch([
      rawDb()
        .prepare(
          `INSERT INTO report_jobs(id,request_key,action,from_date,to_date,recipient,dry_run,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM report_jobs WHERE status='queued')<5`,
        )
        .bind(
          jobId,
          pedido.requestKey,
          pedido.action,
          pedido.from,
          pedido.to,
          pedido.recipient,
          pedido.dryRun ? 1 : 0,
          userId,
          timestamp,
        ),
      rawDb()
        .prepare(
          `INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) SELECT ?,?,'CREATE','report_job',?,?,? WHERE EXISTS(SELECT 1 FROM report_jobs WHERE id=?)`,
        )
        .bind(
          id('aud'),
          userId,
          jobId,
          JSON.stringify(pedido),
          timestamp,
          jobId,
        ),
    ]);
    if (!inserida.meta.changes)
      return resposta(
        { error: 'A fila está cheia. Aguarde a conclusão de uma execução.' },
        409,
      );
  } catch (error) {
    // Outro envio da mesma solicitação pode ter vencido a corrida.
    const existente = await rawDb()
      .prepare(
        'SELECT id FROM report_jobs WHERE request_key=? AND created_by=?',
      )
      .bind(pedido.requestKey, userId)
      .first();
    if (existente) return solicitarRelatorio(body, userId);
    throw error;
  }
  return resposta({ id: jobId }, 202);
}
export async function cancelarRelatorio(jobId: string, userId: string) {
  const timestamp = now();
  const [alterada] = await rawDb().batch([
    rawDb()
      .prepare(
        "UPDATE report_jobs SET status='cancelled',completed_at=? WHERE id=? AND status IN ('queued','review')",
      )
      .bind(timestamp, jobId),
    rawDb()
      .prepare(
        "INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) SELECT ?,?,'UPDATE','report_job',?,'Pedido cancelado antes de iniciar',? WHERE EXISTS(SELECT 1 FROM report_jobs WHERE id=? AND status='cancelled' AND completed_at=?)",
      )
      .bind(id('aud'), userId, jobId, timestamp, jobId, timestamp),
  ]);
  return alterada.meta.changes
    ? resposta({ success: true })
    : resposta(
        {
          error:
            'A execução já começou ou foi concluída. Só pedidos na fila ou aguardando revisão podem ser cancelados.',
        },
        409,
      );
}
