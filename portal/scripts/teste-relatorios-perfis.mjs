import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  criarServidorArquivos,
  reservarRelatorio,
  concluirRelatorio,
} from './processar-relatorios.mjs';

const porta = Number(process.env.PORTAL_TESTE_PORTA),
  [raiz, arquivo] = process.argv.slice(2);
if (
  process.env.PORTAL_TESTE_DESCARTAVEL !== 'SIM' ||
  !Number.isInteger(porta) ||
  porta < 1024 ||
  porta > 65534 ||
  !raiz ||
  !arquivo
)
  throw new Error('Exige instalação descartável.');
// No Windows, TEMP pode usar o alias 8.3 e o banco vir com o caminho longo.
// A resolução nativa expande ambos antes de verificar o confinamento.
const raizReal = fs.realpathSync.native(raiz);
const relativa = path.relative(raizReal, fs.realpathSync.native(arquivo));
assert(
  relativa &&
    !relativa.startsWith('..') &&
    !path.isAbsolute(relativa) &&
    raizReal.includes('portal-teste-'),
  'Banco fora da instalação descartável.',
);
const db = new DatabaseSync(arquivo);
db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON');
const adminCookie = process.env.PORTAL_TESTE_COOKIE,
  senha = 'senha-de-teste-perfis-1234';
const pedir = async (
  rota,
  { method = 'GET', body, cookie = adminCookie } = {},
) => {
  const res = await fetch(`http://127.0.0.1:${porta}/api/${rota}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, data: await res.json() };
};
const pedido = (action = 'paralelo') => ({
  action,
  requestKey: crypto.randomUUID(),
});
let servidor;
try {
  const itemTeste = 'ite_historico_legivel_teste';
  db.prepare('INSERT OR IGNORE INTO catalog_items(id,name) VALUES(?,?)').run(itemTeste, 'Amortecedor para histórico de teste');
  const usuarioAdmin = db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 LIMIT 1").get();
  const auditoriaId = `aud_${crypto.randomUUID()}`;
  const detalhesBrutos = JSON.stringify({ antes: { id: 'itm_teste', catalog_item_id: itemTeste, price: 2028, revision: 0 }, depois: { catalog_item_id: itemTeste, price: 2000 } });
  db.prepare("INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) VALUES(?,?,'UPDATE','agreement_item','itm_teste',?,?)").run(auditoriaId, usuarioAdmin.id, detalhesBrutos, new Date().toISOString());
  const auditoria = await pedir('audit?q=itm_teste');
  assert.equal(auditoria.status, 200);
  const registro = auditoria.data.logs.find(r => r.id === auditoriaId);
  assert.equal(registro.details, detalhesBrutos, 'O registro original permanece intacto');
  assert.match(registro.detailsText, /Amortecedor para histórico de teste/);
  assert.match(registro.detailsText, /Preço: R\$\s2\.028,00 → R\$\s2\.000,00/);
  assert.doesNotMatch(registro.detailsText, /itm_teste|revision|ite_historico/);
  console.log('[OK] Histórico traduz referências e valores, preservando o JSON original.');
  for (const role of ['viewer', 'editor']) {
    const email = `${role}-relatorios@teste.local`;
    assert.equal(
      (
        await pedir('users', {
          method: 'POST',
          body: { name: role, email, password: senha, role },
        })
      ).status,
      201,
    );
    const login = await fetch(`http://127.0.0.1:${porta}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: senha }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    for (const rota of [
      'reports',
      'reports/inexistente',
      'reports/inexistente/arquivo.xlsx',
      'audit',
      'email-notifications',
    ])
      assert.equal(
        (await pedir(rota, { cookie })).status,
        403,
        `${role}:${rota}`,
      );
    assert.equal(
      (await pedir('reports', { method: 'POST', body: pedido(), cookie }))
        .status,
      403,
    );
    assert.equal(
      (await pedir('reports/inexistente', { method: 'DELETE', cookie })).status,
      403,
    );
    assert.equal(
      (await pedir('mappings', { cookie })).status,
      role === 'editor' ? 200 : 403,
    );
    if (role === 'editor') {
      const target = db
        .prepare('SELECT id FROM units WHERE active=1 LIMIT 1')
        .get();
      const mapping = await pedir('mappings/units', {
        method: 'POST',
        cookie,
        body: { source: 'UNIDADE PERFIS TESTE', targetId: target.id },
      });
      assert.equal(mapping.status, 201);
      assert.equal(
        (
          await pedir(`mappings/units/${mapping.data.id}`, {
            method: 'PUT',
            cookie,
            body: {
              expectedRevision: db.prepare('SELECT revision FROM import_unit_mappings WHERE id=?').get(mapping.data.id).revision,
              source: 'UNIDADE PERFIS TESTE',
              targetId: target.id,
              notes: 'alterada',
            },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await pedir(`mappings/units/${mapping.data.id}?expectedRevision=${Number(db.prepare('SELECT revision FROM import_unit_mappings WHERE id=?').get(mapping.data.id).revision)}`, {
            method: 'DELETE',
            cookie,
          })
        ).status,
        200,
      );
    }
  }
  console.log(
    '[OK] Consulta e Suprimentos não acessam relatórios administrativos; Suprimentos gerencia De/Para.',
  );
  assert.equal(
    (await pedir('reports', { method: 'POST', body: pedido() })).status,
    503,
  );
  assert.equal(
    (
      await pedir('reports', {
        method: 'POST',
        body: {
          ...pedido('recorte'),
          from: '2020-02-30',
          to: '2020-01-31',
          recipient: 'a@x.com\r\nBcc:b@x.com',
        },
      })
    ).status,
    400,
  );
  db.prepare(
    'INSERT OR REPLACE INTO report_runner(id,heartbeat_at) VALUES(1,?)',
  ).run(new Date().toISOString());
  const repetido = pedido();
  const tentativas = await Promise.all(
    Array.from({ length: 4 }, () =>
      pedir('reports', { method: 'POST', body: repetido }),
    ),
  );
  for (const r of tentativas)
    assert.equal(r.status, 202, JSON.stringify(r.data));
  const jobId = tentativas[0].data.id;
  assert(tentativas.every((r) => r.data.id === jobId));
  assert.equal(
    db
      .prepare('SELECT COUNT(*) n FROM report_jobs WHERE request_key=?')
      .get(repetido.requestKey).n,
    1,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM audit_logs WHERE entity='report_job' AND entity_id=? AND action='CREATE'",
      )
      .get(jobId).n,
    1,
  );
  assert.equal(
    (
      await pedir('reports', {
        method: 'POST',
        body: { ...repetido, action: 'relatorio' },
      })
    ).status,
    409,
  );
  const job = reservarRelatorio(db);
  assert.equal(job.id, jobId);
  assert.equal(
    (await pedir(`reports/${jobId}`, { method: 'DELETE' })).status,
    409,
  );
  const pasta = path.join(raiz, 'alertas', 'relatorios', 'historicos');
  fs.mkdirSync(pasta, { recursive: true });
  const nome = `recorte_${jobId}.xlsx`,
    bytes = Buffer.from('arquivo fictício de integração');
  fs.writeFileSync(path.join(pasta, nome), bytes);
  concluirRelatorio(
    db,
    job,
    0,
    'Resultado fictício; nenhum Qlik ou SMTP utilizado.',
    [{ name: nome, relativePath: path.relative(raiz, path.join(pasta, nome)) }],
  );
  servidor = criarServidorArquivos({
    token: 'relatorios-token-ci',
    raiz,
    abrirBanco: () => new DatabaseSync(arquivo),
  });
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(porta + 1, '127.0.0.1', resolve);
  });
  const download = await fetch(
    `http://127.0.0.1:${porta}/api/reports/${jobId}/${nome}`,
    { headers: { cookie: adminCookie } },
  );
  assert.equal(download.status, 200, await download.clone().text());
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.equal((await pedir(`reports/${jobId}/segredo.txt`)).status, 404);
  assert.equal((await pedir(`reports/${jobId}`)).data.job.status, 'done');
  console.log(
    '[OK] Pedidos concorrentes são idempotentes; download passa pelo portal autenticado e não expõe outros arquivos.',
  );
  const historico = await pedir('reports', {
    method: 'POST',
    body: {
      ...pedido('recorte'),
      from: '2020-01-01',
      to: '2020-01-31',
      recipient: 'somente@example.com',
    },
  });
  assert.equal(historico.status, 202);
  db.prepare("UPDATE report_jobs SET status='done',completed_at=?,artifacts_json=? WHERE id=?").run(new Date(Date.now() - 25 * 3600000).toISOString(), JSON.stringify([{ name: nome, relativePath: path.relative(raiz, path.join(pasta, nome)) }]), historico.data.id);
  const expirado = await fetch(`http://127.0.0.1:${porta}/api/reports/${historico.data.id}/${nome}`, { headers: { cookie: adminCookie } });
  assert.equal(expirado.status, 410, await expirado.clone().text());
  assert.match((await expirado.json()).error, /expirado/);
  assert.equal(JSON.parse((await pedir('reports')).data.jobs.find(j => j.id === historico.data.id).artifactsJson)[0].expired, true);
  assert.equal(
    db
      .prepare('SELECT recipient FROM report_jobs WHERE id=?')
      .get(historico.data.id).recipient,
    null,
  );
  assert.equal(
    (await pedir(`reports/${historico.data.id}`, { method: 'DELETE' })).status,
    409,
  );
  for (let n = 0; n < 5; n++)
    assert.equal(
      (await pedir('reports', { method: 'POST', body: pedido() })).status,
      202,
    );
  assert.equal(
    (await pedir('reports', { method: 'POST', body: pedido() })).status,
    409,
  );
  const emExecucao = reservarRelatorio(db);
  assert.ok(emExecucao);
  assert.equal(
    (await pedir('reports', { method: 'POST', body: pedido() })).status,
    202,
  );
  assert.equal(
    (await pedir('reports', { method: 'POST', body: pedido() })).status,
    409,
  );
  assert.equal(reservarRelatorio(db), null, 'Uma execução ativa impede iniciar outra');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM report_jobs WHERE status='queued'").get().n, 5);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM report_jobs WHERE status='running'").get().n, 1);
  assert.equal((await pedir('reports')).data.jobs.length, 8);
  console.log(
    '[OK] Recorte sem destinatário, cancelamento só na fila e limite de cinco aguardando além da execução ativa.',
  );
} finally {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  db.close();
}
