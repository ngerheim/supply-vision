import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_RELATORIOS } from '../lib/relatorios.ts';
import {
  identificadorExecucao,
  comandoRelatorio,
  reservarRelatorio,
  revisarPedidosInterrompidos,
  concluirRelatorio,
  listarArquivos,
  arquivoPermitido,
  criarServidorArquivos,
  limparHistoricosExpirados,
} from '../scripts/processar-relatorios.mjs';
import { VALIDADE_HISTORICO_MS } from '../lib/retencao-relatorios.ts';

void test('histórico expirado retorna 410 e limpeza exclui só seus arquivos mantendo registros', async () => {
  const ctx = preparar();
  const pasta = path.join(ctx.pasta, 'alertas/relatorios/historicos');
  fs.mkdirSync(pasta, { recursive: true });
  const antigo = path.join(pasta, 'recorte_rptteste.xlsx');
  const atual = path.join(pasta, 'atual_rptteste.xlsx');
  fs.writeFileSync(antigo, 'antigo'); fs.writeFileSync(atual, 'atual');
  const idade = new Date(Date.now() - VALIDADE_HISTORICO_MS - 1000);
  fs.utimesSync(antigo, idade, idade);
  const artifacts = listarArquivos('rpt_teste', ctx.pasta);
  ctx.db.prepare("UPDATE report_jobs SET action='recorte',status='done',completed_at=?,log='Preservar este registro',artifacts_json=?").run(new Date().toISOString(), JSON.stringify(artifacts));
  const server = criarServidorArquivos({ token: 'teste', raiz: ctx.pasta, abrirBanco: () => new DatabaseSync(ctx.arquivo) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/rpt_teste/recorte_rptteste.xlsx`;
  try {
    assert.equal((await fetch(url, { headers: { authorization: 'Bearer teste' } })).status, 410);
    assert.equal(limparHistoricosExpirados(ctx.db, ctx.pasta), 1);
    assert.equal(fs.existsSync(antigo), false); assert.equal(fs.existsSync(atual), true);
    assert.equal(ctx.db.prepare('SELECT log FROM report_jobs').get().log, 'Preservar este registro');
    assert.equal((await fetch(url, { headers: { authorization: 'Bearer teste' } })).status, 410);
    assert.equal(limparHistoricosExpirados(ctx.db, ctx.pasta), 0);
  } finally { await new Promise(resolve => server.close(resolve)); ctx.close(); }
});

function preparar() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-relatorio-')),
    arquivo = path.join(pasta, 'teste.sqlite');
  const db = new DatabaseSync(arquivo);
  db.exec(
    "CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,active INTEGER);INSERT INTO users VALUES('admin','admin',1);CREATE TABLE audit_logs(id TEXT,user_id TEXT,action TEXT,entity TEXT,entity_id TEXT,details TEXT,created_at TEXT);",
  );
  for (const sql of SCHEMA_RELATORIOS) db.exec(sql);
  db.prepare(
    'INSERT INTO report_jobs(id,request_key,action,created_by,created_at) VALUES(?,?,?,?,?)',
  ).run(
    'rpt_teste',
    '12345678-1234-1234-1234-123456789012',
    'paralelo',
    'admin',
    '2026-01-01',
  );
  return {
    db,
    pasta,
    arquivo,
    close() {
      db.close();
      fs.rmSync(pasta, { recursive: true, force: true });
    },
  };
}

void test('segunda limpeza nao revisita mil recortes removidos e preserva metadados', () => {
  const ctx=preparar(), agora=Date.now();
  try {
    const inserir=ctx.db.prepare("INSERT INTO report_jobs(id,request_key,action,status,created_by,created_at,completed_at,artifacts_json,log) VALUES(?,?,'recorte','done','admin',?,?,?,'historico preservado')");
    ctx.db.exec('BEGIN');
    for(let i=0;i<1000;i++)inserir.run(`antigo${i}`,`chave${i}`,new Date(agora-2*VALIDADE_HISTORICO_MS).toISOString(),new Date(agora-VALIDADE_HISTORICO_MS-1000).toISOString(),JSON.stringify([{name:`${i}.xlsx`,relativePath:`alertas/relatorios/historicos/${i}.xlsx`}]));
    ctx.db.exec('COMMIT');
    assert.equal(limparHistoricosExpirados(ctx.db,ctx.pasta,agora),0);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM report_jobs WHERE artifacts_cleaned_at IS NOT NULL').get().n,1000);
    const lstat=fs.lstatSync;
    try {
      fs.lstatSync=()=>{throw new Error('Nao deve revisitar arquivos removidos')};
      assert.equal(limparHistoricosExpirados(ctx.db,ctx.pasta,agora),0);
    } finally { fs.lstatSync=lstat; }
    assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM report_jobs WHERE log='historico preservado' AND artifacts_json!='[]'").get().n,1000);
  } finally { ctx.close(); }
});

void test('falha ao excluir nao marca limpeza concluida e permite retentativa', () => {
  const ctx=preparar(), agora=Date.now();
  const pasta=path.join(ctx.pasta,'alertas/relatorios/historicos');fs.mkdirSync(pasta,{recursive:true});
  const arquivo=path.join(pasta,'recorte_rptteste.xlsx');fs.writeFileSync(arquivo,'dados');
  ctx.db.prepare("UPDATE report_jobs SET action='recorte',status='done',completed_at=?,artifacts_json=?").run(new Date(agora-VALIDADE_HISTORICO_MS-1000).toISOString(),JSON.stringify([{name:'recorte_rptteste.xlsx',relativePath:'alertas/relatorios/historicos/recorte_rptteste.xlsx'}]));
  const unlink=fs.unlinkSync;
  try {
    fs.unlinkSync=()=>{throw Object.assign(new Error('sem permissao'),{code:'EACCES'})};
    assert.equal(limparHistoricosExpirados(ctx.db,ctx.pasta,agora),0);
    assert.equal(ctx.db.prepare('SELECT artifacts_cleaned_at FROM report_jobs').get().artifacts_cleaned_at,null);
    fs.unlinkSync=unlink;
    assert.equal(limparHistoricosExpirados(ctx.db,ctx.pasta,agora),1);
    assert.ok(ctx.db.prepare('SELECT artifacts_cleaned_at FROM report_jobs').get().artifacts_cleaned_at);
  } finally { fs.unlinkSync=unlink;ctx.close(); }
});
void test('runner monta argumentos sem shell e cobre todas as funções do bat', () => {
  assert.match(
    identificadorExecucao('rpt_abc123', new Date(2026, 9, 5, 11, 12, 13)),
    /^20261005_111213_rptabc123$/,
  );
  const job = {
    action: 'recorte',
    from_date: '2026-01-01',
    to_date: '2026-01-31',
    recipient: 'destino@example.com',
    request_key: '12345678-1234-1234-1234-123456789012',
  };
  assert.deepEqual(comandoRelatorio(job), [
    'panorama/executar.py',
    '--inicio',
    '01/01/2026',
    '--fim',
    '31/01/2026',
  ]);
  assert.deepEqual(comandoRelatorio({ ...job, action: 'paralelo' }), [
    'processo/pipeline.py',
    '--sem-envio',
  ]);
  for (const action of ['relatorio', 'debug'])
    assert.deepEqual(comandoRelatorio({ ...job, action }), [
      'processo/pipeline.py',
    ]);
  assert.deepEqual(
    comandoRelatorio({ ...job, action: 'limpeza', dry_run: 1 }),
    ['processo/limpeza.py', '--dry-run'],
  );
  assert.throws(() => comandoRelatorio({ ...job, action: 'cmd /c' }));
});
void test('dois consumidores não reservam o mesmo trabalho e falha não reenfileira envio', () => {
  const ctx = preparar(),
    outro = new DatabaseSync(ctx.arquivo);
  try {
    const job = reservarRelatorio(ctx.db);
    assert.equal(job.id, 'rpt_teste');
    assert.equal(reservarRelatorio(outro), null);
    concluirRelatorio(ctx.db, job, 2, 'Lock ocupado');
    assert.equal(reservarRelatorio(outro), null);
    assert.equal(
      ctx.db.prepare('SELECT status FROM report_jobs').get().status,
      'failed',
    );
    assert.equal(
      ctx.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,
      1,
    );
  } finally {
    outro.close();
    ctx.close();
  }
});
void test('falha de auditoria desfaz a conclusão da execução', () => {
  const ctx = preparar();
  try {
    const job = reservarRelatorio(ctx.db);
    ctx.db.exec(
      "CREATE TRIGGER falha BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'falha'); END;",
    );
    assert.throws(() => concluirRelatorio(ctx.db, job, 0, 'ok'), /falha/);
    assert.equal(
      ctx.db.prepare('SELECT status FROM report_jobs').get().status,
      'running',
    );
  } finally {
    ctx.close();
  }
});
void test('arquivos de outra execução e caminhos fora dos relatórios não são expostos', async () => {
  const ctx = preparar();
  const diretorio = path.join(ctx.pasta, 'alertas', 'relatorios', 'historicos');
  fs.mkdirSync(diretorio, { recursive: true });
  fs.writeFileSync(path.join(diretorio, 'recorte_rptteste.xlsx'), 'planilha');
  fs.writeFileSync(path.join(diretorio, 'recorte_rptoutro.xlsx'), 'outra');
  fs.writeFileSync(path.join(ctx.pasta, 'segredo.txt'), 'segredo');
  const artifacts = listarArquivos('rpt_teste', ctx.pasta);
  assert.equal(artifacts.length, 1);
  const job = { artifacts_json: JSON.stringify(artifacts) };
  assert.equal(arquivoPermitido(job, 'recorte_rptoutro.xlsx', ctx.pasta), null);
  assert.equal(
    arquivoPermitido(
      {
        artifacts_json: JSON.stringify([
          { name: 'segredo.txt', relativePath: 'segredo.txt' },
        ]),
      },
      'segredo.txt',
      ctx.pasta,
    ),
    null,
  );
  ctx.db
    .prepare('UPDATE report_jobs SET artifacts_json=?')
    .run(job.artifacts_json);
  const server = criarServidorArquivos({
    token: 'token-teste',
    raiz: ctx.pasta,
    abrirBanco: () => new DatabaseSync(ctx.arquivo),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(
      (await fetch(`${url}/rpt_teste/recorte_rptteste.xlsx`)).status,
      403,
    );
    const headers = { authorization: 'Bearer token-teste' };
    assert.equal(
      await (
        await fetch(`${url}/rpt_teste/recorte_rptteste.xlsx`, { headers })
      ).text(),
      'planilha',
    );
    assert.equal(
      (await fetch(`${url}/rpt_teste/recorte_rptoutro.xlsx`, { headers }))
        .status,
      404,
    );
    assert.equal(
      (await fetch(`${url}/rpt_teste/segredo.txt`, { headers })).status,
      404,
    );
    assert.equal(
      (await fetch(`${url}/rpt_teste/%2e%2e%5csegredo.txt`, { headers }))
        .status,
      404,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    ctx.close();
  }
});

void test('reinício preserva pedidos para revisão e não repete trabalhos do backup', () => {
  const ctx = preparar();
  try {
    assert.equal(revisarPedidosInterrompidos(ctx.db), 1);
    assert.equal(
      ctx.db.prepare('SELECT status FROM report_jobs').get().status,
      'review',
    );
    assert.equal(reservarRelatorio(ctx.db), null);
    assert.equal(revisarPedidosInterrompidos(ctx.db), 0);
    ctx.db.prepare("UPDATE report_jobs SET status='running'").run();
    revisarPedidosInterrompidos(ctx.db);
    assert.equal(
      ctx.db.prepare('SELECT status FROM report_jobs').get().status,
      'failed',
    );
  } finally {
    ctx.close();
  }
});
void test('permissão revogada antes de iniciar impede executar o pedido antigo', () => {
  const ctx = preparar();
  try {
    ctx.db.exec("UPDATE users SET role='editor'");
    assert.equal(reservarRelatorio(ctx.db), null);
    assert.equal(
      ctx.db.prepare('SELECT status FROM report_jobs').get().status,
      'review',
    );
  } finally {
    ctx.close();
  }
});
