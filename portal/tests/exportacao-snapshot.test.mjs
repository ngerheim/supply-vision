import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exportarTabelas } from '../lib/exportacao-snapshot.ts';
import { SCHEMA_RELATORIOS } from '../lib/relatorios.ts';
import { SCHEMA_SOLICITACOES } from '../lib/solicitacoes-schema.ts';
import { SCHEMA_BAIXAS } from '../lib/baixas-schema.ts';
import { MIGRAR_FILA_SOLICITACOES } from '../lib/fila-email-schema.ts';

void test('exportacao mantem referencias quando exclusao ocorre durante leituras',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-export-snapshot-')),arquivo=path.join(dir,'db.sqlite');
  const reader=new DatabaseSync(arquivo),writer=new DatabaseSync(arquivo);
  try {
    reader.exec('PRAGMA journal_mode=WAL');
    for(const [,ddl] of fs.readFileSync(new URL('../lib/database.ts',import.meta.url),'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g))reader.exec(ddl);
    for(const ddl of SCHEMA_RELATORIOS)reader.exec(ddl);
    for(const ddl of SCHEMA_SOLICITACOES)if(ddl.startsWith('CREATE TABLE'))reader.exec(ddl);
    for(const ddl of SCHEMA_BAIXAS)if(ddl.startsWith('CREATE TABLE'))reader.exec(ddl);
    for(const ddl of MIGRAR_FILA_SOLICITACOES)reader.exec(ddl);
    reader.exec(`ALTER TABLE users ADD COLUMN daily_report_enabled INTEGER DEFAULT 0; ALTER TABLE users ADD COLUMN daily_report_time TEXT;
      INSERT INTO users(id,name,email,password_salt,password_hash,created_at) VALUES('u','Pessoa Ficticia','pessoa@example.com','sal-ficticio','hash-ficticio','2026-01-01');
      INSERT INTO suppliers(id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES('s','Fornecedor Ficticio','Fornecedor Ficticio','97463218000114','x','x');
      INSERT INTO agreements(id,number,supplier_id,start_date,current_version_id,created_at,updated_at) VALUES('a','1','s','2026-10-01','v','x','x');
      INSERT INTO agreement_versions(id,agreement_id,version_number,created_at) VALUES('v','a',1,'x'); INSERT INTO agreement_versions(id,agreement_id,version_number,status,created_at) VALUES('preparacao','a',2,'processing','x')`);
    reader.prepare("INSERT INTO categorias_fornecedor(id,nome,nome_chave) VALUES('cat','Categoria ficticia','CATEGORIA FICTICIA')").run();
    reader.prepare("INSERT INTO solicitacoes(id,cnpj,razao_social,nao_verificado,urgencia,solicitante_id,criado_em,atualizado_em,request_key,request_hash) VALUES('sol','12345678000199','Empresa ficticia',1,'normal','u','x','x','chave-ficticia','hash-ficticio')").run();
    reader.prepare("INSERT INTO solicitacao_categorias VALUES('sol','cat')").run();
    reader.prepare("INSERT INTO solicitacao_andamentos(id,solicitacao_id,user_id,para_status,criado_em,request_key,request_hash) VALUES('san','sol','u','aberta','x','chave-ficticia','hash-ficticio')").run();
    reader.prepare("INSERT INTO estoques(id,nome,nome_chave) VALUES('est','Estoque ficticio','ESTOQUE FICTICIO')").run();
    reader.prepare("INSERT INTO baixas_estoque(id,numero_os,estoque_id,placa,solicitante_id,criado_em,atualizado_em,request_key,request_hash) VALUES('bx','123','est','ABC1234','u','x','x','chave-ficticia','hash-ficticio')").run();
    reader.prepare("INSERT INTO itens_catalogo(id,descricao,descricao_chave,unidade) VALUES('itm','Filtro ficticio','FILTRO FICTICIO','un')").run();
    reader.prepare("INSERT INTO baixa_itens(id,baixa_id,item_id,quantidade_centesimos,criado_em,atualizado_em) VALUES('bi','bx','itm',200,'x','x')").run();
    reader.prepare("INSERT INTO baixa_andamentos(id,baixa_id,user_id,para_status,criado_em,request_key,request_hash) VALUES('ban','bx','u','aberta','x','chave-ficticia','hash-ficticio')").run();
    reader.prepare("INSERT INTO email_notifications(id,solicitacao_id,event_id,type,recipient_name,recipient_email,payload_json,next_attempt_at,dedupe_key,created_at,updated_at) VALUES('mail','sol','san','solicitacao_abertura','Pessoa ficticia','pessoa@example.com','{}','2026-01-01T00:00:00.000Z','dedupe-ficticio','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')").run();
    let lotes=0;
    const db={prepare:sql=>sql,batch:async queries=>{
      lotes++;reader.exec('BEGIN');
      try {
        const results=queries.map(sql=>{
          const rows=reader.prepare(sql).all();
          if(sql.startsWith('SELECT * FROM agreements '))writer.exec("BEGIN; DELETE FROM agreement_versions; DELETE FROM agreements; COMMIT");
          return {results:rows};
        });reader.exec('COMMIT');return results;
      }catch(e){reader.exec('ROLLBACK');throw e;}
    }};
    const tables=await exportarTabelas(db);
    assert.equal(lotes,1);assert.equal(tables.agreements.length,1);assert.equal(tables.agreementVersions.length,1);
    assert.equal(tables.agreements[0].current_version_id,tables.agreementVersions[0].id);
    assert.equal(writer.prepare('SELECT COUNT(*) n FROM agreements').get().n,0);
    assert.equal(tables.users.length,1);
    assert.equal(tables.users[0].email,'pessoa@example.com');
    assert.equal(tables.solicitacoes[0].id,'sol');
    assert.equal(tables.solicitacaoCategorias[0].categoria_id,tables.categoriasFornecedor[0].id);
    assert.equal(tables.solicitacaoCategorias[0].solicitacao_id,tables.solicitacoes[0].id);
    assert.equal(tables.solicitacaoAndamentos[0].solicitacao_id,tables.solicitacoes[0].id);
    assert.equal(tables.emailNotifications[0].solicitacao_id,tables.solicitacoes[0].id);
    assert.equal(tables.baixasEstoque[0].estoque_id,tables.estoques[0].id);
    assert.equal(tables.baixaAndamentos[0].baixa_id,tables.baixasEstoque[0].id);
    assert.equal(tables.itensCatalogo[0].id,'itm');
    assert.equal(tables.baixaItens[0].baixa_id,tables.baixasEstoque[0].id);
    assert.equal(tables.baixaItens[0].item_id,tables.itensCatalogo[0].id);
    for(const tabela of [tables.solicitacoes,tables.solicitacaoAndamentos,tables.baixasEstoque,tables.baixaAndamentos])
      assert.equal(tabela.some(row=>'request_key' in row||'request_hash' in row),false);
    assert.equal(tables.users.some(u=>'password_hash' in u),false);
    assert.equal(tables.users.some(u=>'password_salt' in u),false);
  } finally { reader.close();writer.close();fs.rmSync(dir,{recursive:true,force:true}); }
});

void test('exportacao excessiva e recusada sem apagar ou truncar historico',async()=>{
  const db={prepare:sql=>sql,batch:async queries=>queries.map((sql,i)=>({results:i===0?[{bytes:9*1024*1024}]:[]}))};
  await assert.rejects(()=>exportarTabelas(db),/limite de logs/);
  db.batch=async queries=>queries.map((sql,i)=>({results:i===0?[{bytes:0}]:i===1?Array.from({length:10001},()=>({id:'x'})):[]}));
  await assert.rejects(()=>exportarTabelas(db),/10000 registros/);
});
