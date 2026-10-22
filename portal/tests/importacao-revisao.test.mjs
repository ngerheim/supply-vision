import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';
import { importacoesApi } from '../lib/importacoes-api.ts';

void test('previa informa revisao; publicacao ausente ou obsoleta retorna 409 sem alterar acordo', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const [, ddl] of fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
    db.exec(`ALTER TABLE agreements ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
      INSERT INTO suppliers(id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES('s','Fixture','Fixture','11222333000181','x','x');
      INSERT INTO users(id,name,email,password_salt,password_hash,role,created_at) VALUES('u','Fixture','u@example.com','s','h','admin','x');
      INSERT INTO agreements(id,number,supplier_id,status,start_date,end_date,created_at,updated_at) VALUES('a','A','s','active','2026-01-01','2026-12-31','x','x');
      INSERT INTO locations(id,city,state) VALUES('l','CIDADE','SP');
      INSERT INTO catalog_items(id,name,active) VALUES('i','ITEM',1);
      INSERT INTO vehicle_models(id,name,active) VALUES('m','MODELO',1);
      INSERT INTO units(id,code,name,active) VALUES('un','UN','UN',1);
      INSERT INTO import_item_mappings(id,source_text,source_key,target_id,active,created_at,updated_at) VALUES('mi','ITEM','ITEM','i',1,'x','x');
      INSERT INTO import_model_mappings(id,source_text,source_key,target_id,active,created_at,updated_at) VALUES('mm','MODELO','MODELO','m',1,'x','x');`);
    const prepare = (sql, values = []) => ({ sql, values, bind(...v) { return prepare(sql, v); }, async run() { return { meta: db.prepare(sql).run(...values) }; } });
    const banco = { prepare, async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try { for (const s of statements) db.prepare(s.sql).run(...s.values); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    } };
    let n = 0;
    const contexto = { id: p => `${p}${n++}`, now: () => new Date().toISOString(), rawDb: () => banco,
      TRAVA_IMPORTACAO: 'importacao', adquirirTrava: async () => true, renovarTrava: async () => {}, liberarTrava: async () => {},
      all: async (sql, values = []) => db.prepare(sql).all(...values), first: async (sql, values = []) => db.prepare(sql).get(...values),
      ok: (v, init) => Response.json(v, init), fail: (error, status = 400) => Response.json({ error }, { status }) };
    let alterarNaTrava = false;
    const api = importacoesApi(contexto, { travarAcordo: async () => {
      if (alterarNaTrava) db.exec('UPDATE agreements SET revision=revision+1');
      return 'dono';
    }, soltarAcordo: async () => {} });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ CIDADE: 'CIDADE', UF: 'SP', MODELO: 'MODELO', PECA_SERVICO: 'ITEM', PRECO: 10, MEDIDA: 'UN' }]), 'Fixture');
    const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    const request = (preview, revision, plan = preview ? undefined : fingerprint) => {
      const form = new FormData(); form.set('file', new Blob([bytes]), 'fixture.xlsx');
      if (revision !== undefined) form.set('expectedRevision', String(revision));
      if (plan != null) form.set('expectedPlanFingerprint', plan);
      return new Request(`http://fixture/api/imports/agreement/a${preview ? '?preview=1' : ''}`, { method: 'POST', body: form });
    };
    const user = { id: 'u', role: 'admin' };
    const previa = await (await api.importWorkbook(request(true), user, 'a')).json();
    assert.equal(previa.valid, true, JSON.stringify(previa));
    assert.equal(previa.agreementRevision, 0);
    assert.match(previa.planFingerprint, /^[a-f0-9]{64}$/);
    const fingerprint = previa.planFingerprint;
    const desatualizada = 'A tela está desatualizada. Recarregue a página (Ctrl+F5) e confira a planilha novamente.';
    const conflito = 'O acordo mudou desde a conferência. Confira a planilha novamente antes de publicar.';
    for (const revision of [undefined, -1, 'x', '', '1.5', '9007199254740992', '9'.repeat(400)]) {
      const r = await api.importWorkbook(request(false, revision), user, 'a');
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error, desatualizada);
    }
    for (const plan of [null, '', 'x', 'A'.repeat(64)]) {
      const r = await api.importWorkbook(request(false, 0, plan), user, 'a');
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error, desatualizada);
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM imports').get().n, 0);
    db.exec('UPDATE agreements SET revision=1');
    const obsoleta = await api.importWorkbook(request(false, previa.agreementRevision), user, 'a');
    assert.equal(obsoleta.status, 409);
    assert.equal((await obsoleta.json()).error, conflito);
    alterarNaTrava = true;
    const depoisDaTrava = await api.importWorkbook(request(false, 1), user, 'a');
    assert.equal(depoisDaTrava.status, 409);
    assert.equal((await depoisDaTrava.json()).error, `Não foi possível importar: ${conflito}`);
    assert.equal(db.prepare('SELECT status FROM imports').get().status, 'conflict');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM agreement_versions').get().n, 0);
    alterarNaTrava = false;
    assert.equal((await api.importWorkbook(request(false, 2), user, 'a')).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM agreement_versions').get().n, 1);
  } finally { db.close(); }
});
