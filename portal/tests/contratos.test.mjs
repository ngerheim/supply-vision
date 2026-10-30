import './apoio/logs-email.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';

// A pasta privada e lida na importacao; definida antes de carregar o Portal.
const privado = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-contratos-fixture-'));
process.env.SUPPLY_VISION_PRIVADO = privado;
const { NextRequest } = await import('vinext/shims/server');
const { bancoSqliteLocal } = await import('../lib/sqlite-local.ts');
const { env } = await import('../scripts/configuracao-servidor.mjs');
const { PORTAL_BUILD } = await import('../lib/portal-build.ts');
const contratos = await import('../lib/contratos.ts');
const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts'), rota = await import('../app/api/[...path]/route.ts');
const { caminhoTemplateContrato } = await import('../lib/contratos-api.ts');
hooks.deregister();

const CAMPOS = contratos.CAMPOS_CONTRATO;
// Template ficticio minimo: um paragrafo por campo e o sectPr final.
function templateFicticio(extra = '') {
  const corpo = CAMPOS.map(c => `<w:p><w:r><w:t>${c}: {{${c}}}</w:t></w:r></w:p>`).join('') + extra;
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
  const zip = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(zip, '[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  XLSX.CFB.utils.cfb_add(zip, 'word/document.xml', Buffer.from(documento));
  return new Uint8Array(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }));
}
const lerDocumento = bytes => {
  const zip = XLSX.CFB.read(bytes, { type: 'buffer' });
  return Buffer.from(zip.FileIndex[zip.FullPaths.findIndex(p => p.endsWith('/word/document.xml'))].content).toString('utf8');
};

void test('contrato: extenso, data e CNPJ', () => {
  assert.equal(contratos.numeroPorExtenso(45), 'quarenta e cinco');
  assert.equal(contratos.numeroPorExtenso(30), 'trinta');
  assert.equal(contratos.numeroPorExtenso(100), 'cem');
  assert.equal(contratos.numeroPorExtenso(121), 'cento e vinte e um');
  assert.equal(contratos.numeroPorExtenso(15), 'quinze');
  assert.throws(() => contratos.numeroPorExtenso(0), RangeError);
  assert.equal(contratos.dataPorExtenso('2026-10-30'), '30 de outubro de 2026');
  assert.equal(contratos.dataPorExtenso('2026-01-05'), '5 de janeiro de 2026');
  assert.throws(() => contratos.dataPorExtenso('2026-13-01'), RangeError);
  assert.equal(contratos.formatarCnpj('12345678000199'), '12.345.678/0001-99');
});

void test('contrato: preenche campos com escape, anexa a tabela antes do sectPr e recusa campo desconhecido', () => {
  const campos = Object.fromEntries(CAMPOS.map(c => [c, `Valor ${c}`]));
  campos.FORNECEDOR_RAZAO_SOCIAL = 'Oficina <Teste> & Filhos';
  const itens = [
    { cidade: 'Cidade A', uf: 'MG', modelo: 'Modelo X', item: 'Troca de óleo', unidade: 'UN', preco: 1234.5, cortesia: false, marcas: null },
    { cidade: 'Cidade B', uf: 'PA', modelo: 'Modelo Y', item: 'Alinhamento', unidade: 'UN', preco: 0, cortesia: true, marcas: 'Marca Z' },
  ];
  const xml = lerDocumento(contratos.gerarContrato(templateFicticio(), campos, itens));
  assert.doesNotMatch(xml, /\{\{/);
  assert.match(xml, /Oficina &lt;Teste&gt; &amp; Filhos/);
  assert.match(xml, /ANEXO I – TABELA DE VALORES/);
  assert.match(xml, /R\$\s1\.234,50/);
  assert.match(xml, /Cortesia/);
  assert.ok(xml.indexOf('ANEXO I') < xml.lastIndexOf('<w:sectPr'), 'anexo antes do sectPr final');
  assert.throws(() => contratos.gerarContrato(templateFicticio('<w:p><w:r><w:t>{{CAMPO_NOVO}}</w:t></w:r></w:p>'), campos, []), /CAMPO_NOVO/);
  assert.throws(() => contratos.gerarContrato(new Uint8Array([1, 2, 3]), campos, []), contratos.TemplateInvalido);
  assert.deepEqual(contratos.camposDoTemplate(templateFicticio()).sort(), [...CAMPOS].sort());
});

void test('contrato: rota gera o .docx com permissao, valida campos e audita', async t => {
  const db = bancoSqliteLocal({ pastaPrivada: privado, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-contratos';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(privado, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  sql.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)').run('viewer', 'Pessoa viewer', 'viewer@example.com', 's', 'h', 'viewer', banco.now());
  for (const user of [admin, 'viewer']) {
    await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)').bind(await banco.tokenHash(user), user, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  }
  const ts = banco.now();
  sql.exec(`INSERT INTO suppliers(id,legal_name,trade_name,cnpj,city,state,created_at,updated_at) VALUES('sup1','Fornecedor Ficticio Ltda','Fornecedor Ficticio','12345678000199','Cidade A','MG','${ts}','${ts}');
    INSERT INTO agreements(id,number,supplier_id,status,start_date,created_at,updated_at) VALUES('ag1','LF-900','sup1','active','2026-01-01','${ts}','${ts}');`);
  const pedir = async (method, url, user, body) => {
    const headers = { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD, ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await rota[method](new NextRequest(`http://fixture/api/${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, headers: r.headers, data: r.headers.get('content-type')?.includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer()) };
  };
  const campos = Object.fromEntries(['FORNECEDOR_RAZAO_SOCIAL', 'FORNECEDOR_ENDERECO', 'FORNECEDOR_CNPJ', 'FORNECEDOR_REPRESENTANTE', 'CIDADE_ASSINATURA', 'CONTRATANTE_REPRESENTANTE', 'TESTEMUNHA_1', 'TESTEMUNHA_2', 'TESTEMUNHA_3'].map(c => [c, `Valor ${c}`]));
  const corpo = { acordoId: 'ag1', campos, prazoDias: 60, data: '2026-10-30' };

  assert.equal((await pedir('GET', 'contratos', 'viewer')).status, 403);
  assert.equal((await pedir('POST', 'contratos', 'viewer', corpo)).status, 403);
  // Sem template: a tela avisa e a geracao recusa.
  const semTemplate = await pedir('GET', 'contratos?acordo=ag1', admin);
  assert.equal(semTemplate.data.template, false);
  assert.equal(semTemplate.data.acordo.cnpj, '12.345.678/0001-99');
  assert.equal((await pedir('POST', 'contratos', admin, corpo)).status, 409);

  fs.mkdirSync(path.dirname(caminhoTemplateContrato()), { recursive: true });
  fs.writeFileSync(caminhoTemplateContrato(), templateFicticio());
  assert.equal((await pedir('GET', 'contratos', admin)).data.template, true);
  assert.equal((await pedir('POST', 'contratos', admin, { ...corpo, prazoDias: 0 })).status, 400);
  assert.equal((await pedir('POST', 'contratos', admin, { ...corpo, data: '2026-02-30x' })).status, 400);
  assert.equal((await pedir('POST', 'contratos', admin, { ...corpo, campos: { ...campos, TESTEMUNHA_3: ' ' } })).status, 400);
  assert.equal((await pedir('POST', 'contratos', admin, { ...corpo, acordoId: 'nao-existe' })).status, 404);

  const gerado = await pedir('POST', 'contratos', admin, corpo);
  assert.equal(gerado.status, 200);
  assert.match(gerado.headers.get('content-disposition'), /Contrato_LF-900_Fornecedor_Ficticio\.docx/);
  const xml = lerDocumento(gerado.data);
  assert.match(xml, /PRAZO_PAGAMENTO_DIAS: 60/);
  assert.match(xml, /PRAZO_PAGAMENTO_EXTENSO: sessenta/);
  assert.match(xml, /DATA_ASSINATURA: 30 de outubro de 2026/);
  assert.match(xml, /Acordo sem itens na versão vigente/);
  assert.match(sql.prepare("SELECT details FROM audit_logs WHERE entity_id='ag1' ORDER BY created_at DESC").get().details, /Contrato de fornecimento gerado: LF-900 \(prazo 60 dias/);
});
