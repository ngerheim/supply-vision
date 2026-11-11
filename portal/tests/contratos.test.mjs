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
// Texto corrido da folha impressa: um paragrafo por linha.
const textoFolha = contrato => contrato.paragrafos.map(p => p.trechos.map(t => t.texto).join('')).join('\n');
// Template com cabecalho (logo) e rodape ligados pelo sectPr, formatacao e lista.
function templateCompleto() {
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const corpo = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t>CONTRATO</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr><w:r><w:t>CLÁUSULA PRIMEIRA</w:t></w:r></w:p>'
    + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>1.1</w:t></w:r><w:r><w:t xml:space="preserve"> Texto de </w:t></w:r><w:r><w:t>{{FORNECEDOR_RAZAO_SOCIAL}}</w:t></w:r><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>.</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item</w:t></w:r></w:p>'
    + '<w:sectPr><w:headerReference w:type="default" r:id="rId9"/><w:footerReference w:type="default" r:id="rId10"/></w:sectPr>';
  const zip = XLSX.CFB.utils.cfb_new();
  const add = (nome, texto) => XLSX.CFB.utils.cfb_add(zip, nome, Buffer.from(texto));
  add('word/document.xml', `<?xml version="1.0"?><w:document ${w}><w:body>${corpo}</w:body></w:document>`);
  const tipo = t => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}`;
  add('word/_rels/document.xml.rels', `<Relationships><Relationship Id="rId9" Type="${tipo('header')}" Target="header1.xml"/><Relationship Id="rId10" Type="${tipo('footer')}" Target="footer1.xml"/></Relationships>`);
  add('word/header1.xml', `<w:hdr ${w} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p></w:hdr>`);
  add('word/_rels/header1.xml.rels', '<Relationships><Relationship Id="rId1" Target="media/image1.png"/></Relationships>');
  XLSX.CFB.utils.cfb_add(zip, 'word/media/image1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  add('word/footer1.xml', `<w:ftr ${w}><w:p><w:r><w:t>Rodapé fictício</w:t></w:r></w:p><w:p/></w:ftr>`);
  return new Uint8Array(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }));
}

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
  assert.throws(() => contratos.dataPorExtenso('2026-02-31'), RangeError);
  assert.throws(() => contratos.dataPorExtenso('2026-11-00'), RangeError);
  assert.equal(contratos.dataPorExtenso('2028-02-29'), '29 de fevereiro de 2028');
  assert.equal(contratos.formatarCnpj('12345678000199'), '12.345.678/0001-99');
});

void test('contrato: preenche campos sem perder caracteres, sem anexo, e recusa campo desconhecido', () => {
  const campos = Object.fromEntries(CAMPOS.map(c => [c, `Valor ${c}`]));
  campos.FORNECEDOR_RAZAO_SOCIAL = 'Oficina <Teste> & Filhos';
  const texto = textoFolha(contratos.lerContrato(templateFicticio(), campos));
  assert.doesNotMatch(texto, /\{\{/);
  assert.match(texto, /FORNECEDOR_RAZAO_SOCIAL: Oficina <Teste> & Filhos/);
  assert.doesNotMatch(texto, /ANEXO I/);
  assert.throws(() => contratos.lerContrato(templateFicticio('<w:p><w:r><w:t>{{CAMPO_NOVO}}</w:t></w:r></w:p>'), campos), /CAMPO_NOVO/);
  assert.throws(() => contratos.lerContrato(new Uint8Array([1, 2, 3]), campos), contratos.TemplateInvalido);
  assert.deepEqual(contratos.camposDoTemplate(templateFicticio()).sort(), [...CAMPOS].sort());
});

void test('contrato: folha impressa segue a formatacao do template, sem cabecalho nem rodape', () => {
  const campos = Object.fromEntries(CAMPOS.map(c => [c, 'Fornecedor Fictício']));
  const folha = contratos.lerContrato(templateCompleto(), campos);
  assert.deepEqual(folha.paragrafos.map(p => p.tipo), ['texto', 'clausula', 'texto', 'item']);
  assert.deepEqual(folha.paragrafos[0], { tipo: 'texto', centro: true, trechos: [{ texto: 'CONTRATO', negrito: true, tamanhoPt: 13 }] });
  assert.deepEqual(folha.paragrafos[2].trechos, [{ texto: '1.1', negrito: true }, { texto: ' Texto de Fornecedor Fictício.' }]);
  // Cabecalho e rodape do Word nao entram na folha do Portal.
  assert.deepEqual(Object.keys(folha), ['paragrafos']);
  assert.doesNotMatch(textoFolha(folha), /Rodapé fictício/);
});

void test('contrato: template com campos fixos antigos da contratante e avisado', async () => {
  const antigo = templateFicticio('<w:p><w:r><w:t>{{TESTEMUNHA_1}} {{CONTRATANTE_REPRESENTANTE}} {{FORNECEDOR_REPRESENTANTE}}</w:t></w:r></w:p>');
  assert.deepEqual(contratos.camposDoTemplate(antigo).filter(c => contratos.CAMPOS_FIXOS_ANTIGOS.includes(c)).sort(), ['CONTRATANTE_REPRESENTANTE', 'FORNECEDOR_REPRESENTANTE', 'TESTEMUNHA_1']);
  assert.equal(contratos.montarEndereco({ logradouro: 'Av. Brasil', numero: '10', complemento: 'Sala 2', bairro: 'Funcionários', cidade: 'Belo Horizonte', uf: 'mg', cep: '30.140-000' }),
    'Av. Brasil, 10, Sala 2, Funcionários, Belo Horizonte/MG, CEP 30140-000');
});

void test('contrato: rota gera a folha com permissao, valida campos, consulta o CNPJ e audita', async t => {
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
  const campos = Object.fromEntries(['FORNECEDOR_RAZAO_SOCIAL', 'FORNECEDOR_CNPJ'].map(c => [c, `Valor ${c}`]));
  const endereco = { logradouro: 'Rua Ficticia', numero: '100', complemento: '', bairro: 'Centro', cidade: 'Cidade A', uf: 'mg', cep: '30100000' };
  const corpo = { campos, endereco, prazoDias: 60, data: '2026-10-30' };

  assert.equal((await pedir('GET', 'contratos', 'viewer')).status, 403);
  assert.equal((await pedir('POST', 'contratos', 'viewer', corpo)).status, 403);
  // Sem template: a tela avisa e a geracao recusa.
  const semTemplate = await pedir('GET', 'contratos', admin);
  assert.equal(semTemplate.data.template, false);
  assert.equal(semTemplate.data.acordo, undefined);
  assert.equal((await pedir('POST', 'contratos', admin, corpo)).status, 409);

  fs.mkdirSync(path.dirname(caminhoTemplateContrato()), { recursive: true });
  fs.writeFileSync(caminhoTemplateContrato(), templateFicticio());
  assert.equal((await pedir('GET', 'contratos', admin)).data.template, true);
  assert.equal((await pedir('POST', 'contratos', admin, { ...corpo, prazoDias: 0 })).status, 400);
  assert.equal((await pedir('POST', 'contratos', admin, { ...corpo, data: '2026-02-30x' })).status, 400);
  assert.equal((await pedir('POST', 'contratos', admin, { ...corpo, campos: { ...campos, FORNECEDOR_RAZAO_SOCIAL: ' ' } })).status, 400);
  assert.equal((await pedir('POST', 'contratos', admin, { ...corpo, endereco: { ...endereco, bairro: '' } })).status, 400);
  assert.equal((await pedir('POST', 'contratos', admin, { ...corpo, endereco: { ...endereco, cep: '123' } })).status, 400);

  const gerado = await pedir('POST', 'contratos', admin, corpo);
  assert.equal(gerado.status, 200);
  assert.equal(gerado.data.arquivo, 'Contrato_Valor_FORNECEDOR_RAZAO_SOCIAL');
  const xml = textoFolha(gerado.data);
  assert.match(xml, /PRAZO_PAGAMENTO_DIAS: 60/);
  assert.match(xml, /PRAZO_PAGAMENTO_EXTENSO: sessenta/);
  assert.match(xml, /DATA_ASSINATURA: 30 de outubro de 2026/);
  assert.match(xml, /FORNECEDOR_ENDERECO: Rua Ficticia, 100, Centro, Cidade A\/MG, CEP 30100-000/);
  assert.doesNotMatch(xml, /ANEXO I/);
  assert.match(sql.prepare("SELECT details FROM audit_logs WHERE entity='contrato' ORDER BY created_at DESC").get().details, /Contrato de fornecimento gerado: Valor FORNECEDOR_RAZAO_SOCIAL \(prazo 60 dias/);
  // CNPJ: preenche razao social e endereco (provedor ficticio do modo ensaio); sem permissao, recusa.
  const ensaio = process.env.MODO_ENSAIO; process.env.MODO_ENSAIO = '1'; t.after(() => { if (ensaio === undefined) delete process.env.MODO_ENSAIO; else process.env.MODO_ENSAIO = ensaio; });
  const { CNPJS_ENSAIO } = await import('../lib/consultas-fornecedor-ensaio.ts');
  assert.equal((await pedir('GET', `contratos/cnpj/${CNPJS_ENSAIO.ativa}`, 'viewer')).status, 403);
  const consulta = await pedir('GET', `contratos/cnpj/${CNPJS_ENSAIO.ativa}`, admin);
  assert.equal(consulta.status, 200);
  assert.equal(consulta.data.razaoSocial, 'FORNECEDOR FICTÍCIO');
  assert.equal(consulta.data.situacao, 'ATIVA');
  assert.deepEqual(consulta.data.endereco, { logradouro: 'Rua Fictícia', numero: '10', complemento: '', bairro: 'Bairro Fictício', cidade: 'Cidade Fictícia', uf: 'SP', cep: '00000000' });
  assert.equal((await pedir('GET', `contratos/cnpj/${CNPJS_ENSAIO.inexistente}`, admin)).status, 404);
  assert.equal((await pedir('GET', 'contratos/cnpj/123', admin)).status, 400);
});
