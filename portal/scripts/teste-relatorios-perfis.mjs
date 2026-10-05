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
const relativa = path.relative(fs.realpathSync(raiz), fs.realpathSync(arquivo));
assert(
  relativa &&
    !relativa.startsWith('..') &&
    !path.isAbsolute(relativa) &&
    raiz.includes('portal-teste-'),
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
          await pedir(`mappings/units/${mapping.data.id}`, {
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
          from: '2020-01-01',
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
  assert.equal(
    db
      .prepare('SELECT recipient FROM report_jobs WHERE id=?')
      .get(historico.data.id).recipient,
    'somente@example.com',
  );
  assert.equal(
    (await pedir(`reports/${historico.data.id}`, { method: 'DELETE' })).status,
    200,
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
  assert.equal((await pedir('reports')).data.jobs.length, 7);
  console.log(
    '[OK] Recorte preserva destinatário, cancelamento só vale na fila e o limite não aceita excesso de pedidos.',
  );
} finally {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  db.close();
}
