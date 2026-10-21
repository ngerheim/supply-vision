import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { correspondeBusca } from '../lib/busca.ts';
import { dadosBuscaChamado, filtroChamados, migrarBuscaChamados, ordemChamados, COLUNAS_ORDENACAO_CHAMADOS } from '../lib/operacao-dados.ts';

function banco() {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tickets(id TEXT PRIMARY KEY,code TEXT,supplier_name TEXT,city TEXT,state TEXT,
    search_text TEXT,supplier_sort TEXT,status TEXT DEFAULT 'aberto',priority TEXT DEFAULT 'media',
    created_at TEXT DEFAULT '2026-01-01T00:00:00.000Z',closed_at TEXT,updated_at TEXT,requested_by TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT)`);
  return db;
}
function inserir(db,id,fornecedor='ÁGUA e Peças',cidade='São   Paulo',normalizado=true) {
  const campos={code:`SUP-${String(id).padStart(4,'0')}`,supplier_name:fornecedor,city:cidade,state:'SP'};
  const dados=dadosBuscaChamado(campos);
  db.prepare('INSERT INTO tickets(id,code,supplier_name,city,state,search_text,supplier_sort,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(String(id),campos.code,fornecedor,cidade,'SP',normalizado?dados.searchText:null,normalizado?dados.supplierSort:null,new Date(Date.UTC(2026,0,1)+Number(id)*1000).toISOString());
  return campos;
}
function adaptador(db,antesBatch=()=>{}) {
  return {
    prepare(sql) {
      let valores=[];
      return { bind(...args){valores=args;return this;},async all(){return {results:db.prepare(sql).all(...valores)};},executar(){return db.prepare(sql).run(...valores);} };
    },
    async batch(comandos){antesBatch();db.exec('BEGIN');try{for(const comando of comandos)comando.executar();db.exec('COMMIT');}catch(erro){db.exec('ROLLBACK');throw erro;}}
  };
}
function listar(db,parametros,offset=0) {
  const params=new URLSearchParams(parametros),filtro=filtroChamados(params),ordem=ordemChamados(params,new Date('2026-10-13T12:00:00Z'));
  return db.prepare(`SELECT t.id,t.supplier_name FROM tickets t LEFT JOIN users r ON r.id=t.requested_by ${filtro.where} ORDER BY ${ordem.sql} LIMIT 50 OFFSET ?`).all(...filtro.values,...ordem.values,offset);
}
void test('busca SQL conserva acentos, caixa pt-BR e espacos da busca anterior',()=>{
  const db=banco();
  try{
    const campos=inserir(db,1,'ÁGUA  e   Peças','São\tPaulo');
    for(const q of ['sao paulo','São Paulo','  SA\u0303O  PAULO ','ÁGUA','água','agua','PEÇAS','sup-0001','   ','inexistente',"' OR 1=1 --"]){
      assert.equal(listar(db,{q}).length,correspondeBusca(`${campos.code} ${campos.supplier_name} ${campos.city} ${campos.state}`,q)?1:0,q);
    }
  }finally{db.close();}
});
void test('migra legado em lotes e retoma apos interrupcao sem alterar dados originais',async()=>{
  const db=banco();
  try{
    for(let i=1;i<=251;i++)inserir(db,i,'ÓLEO e AÇÃO','Ribeirão Preto',false);
    let lotes=0;
    await assert.rejects(migrarBuscaChamados(adaptador(db,()=>{if(++lotes===2)throw new Error('interrupcao ficticia');})),/interrupcao/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tickets WHERE search_text IS NOT NULL').get().n,100);
    await migrarBuscaChamados(adaptador(db));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tickets WHERE search_text IS NULL OR supplier_sort IS NULL').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tickets WHERE supplier_name=? AND city=?').get('ÓLEO e AÇÃO','Ribeirão Preto').n,251);
    assert.equal(listar(db,{q:'OLEO E ACAO'}).length,50);
    await migrarBuscaChamados(adaptador(db,()=>assert.fail('legado pronto nao deve ser regravado')));
  }finally{db.close();}
});
void test('migracao nao grava chave calculada com uma localidade antiga',async()=>{
  const db=banco();
  try{
    inserir(db,1,'ÁGUA','São Paulo',false);
    let primeiro=true;
    await migrarBuscaChamados(adaptador(db,()=>{if(primeiro){primeiro=false;db.prepare('UPDATE tickets SET city=? WHERE id=?').run('ÁREA NOVA','1');}}));
    assert.equal(listar(db,{q:'sao paulo'}).length,0);
    assert.equal(listar(db,{q:'AREA NOVA'}).length,1);
  }finally{db.close();}
});
void test('fornecedor ordena todos os chamados antes das paginas, nos dois sentidos',()=>{
  const db=banco();
  try{
    for(let i=1;i<=120;i++)inserir(db,i,i===1?'ÁGUA':i===120?'Zulu':`Fornecedor ${121-i}`);
    assert.ok(!listar(db,{}).some(r=>r.id==='1'),'fornecedor inicial esta fora da primeira pagina sem ordenar');
    const asc=listar(db,{sort:'supplier',direction:'asc'}),segunda=listar(db,{sort:'supplier',direction:'asc'},50),terceira=listar(db,{sort:'supplier',direction:'asc'},100);
    assert.equal(asc[0].id,'1');assert.equal(terceira.at(-1).id,'120');
    assert.equal(new Set([...asc,...segunda,...terceira].map(r=>r.id)).size,120);
    assert.equal(listar(db,{sort:'supplier',direction:'desc'})[0].id,'120');
    assert.equal(asc[1].supplier_name,'Fornecedor 2');assert.equal(asc[2].supplier_name,'Fornecedor 3');
  }finally{db.close();}
});
void test('somente as seis colunas e direcoes fixas chegam ao SQL',()=>{
  const db=banco();
  try{
    inserir(db,1);inserir(db,2);db.prepare('UPDATE tickets SET priority=?,status=?,closed_at=? WHERE id=?').run('alta','fechado','2026-01-02T00:00:00Z','2');
    for(const sort of COLUNAS_ORDENACAO_CHAMADOS)for(const direction of ['asc','desc'])assert.equal(listar(db,{sort,direction}).length,2);
    assert.deepEqual(listar(db,{sort:'supplier; DROP TABLE tickets',direction:'desc'}),listar(db,{}));
    assert.deepEqual(listar(db,{sort:'supplier',direction:'desc; DROP TABLE tickets'}),listar(db,{sort:'supplier',direction:'asc'}));
    assert.equal(listar(db,{sort:'priority'})[0].id,'2');assert.equal(listar(db,{sort:'elapsed'})[0].id,'2');
    assert.deepEqual(listar(db,{sort:'code'}).map(r=>r.id),['1','2']);
  }finally{db.close();}
});

void test('grupos desconhecidos nao consultam propriedades herdadas e preservam a busca',()=>{
  const db=banco();
  try {
    inserir(db,1,'FORNECEDOR FICTICIO ALFA');
    inserir(db,2,'FORNECEDOR FICTICIO BETA');
    for(const group of ['constructor','__proto__','toString','desconhecido']) {
      assert.deepEqual(listar(db,{group}),listar(db,{}));
      assert.deepEqual(listar(db,{group,q:'ALFA'}).map(r=>r.id),['1']);
    }
  } finally { db.close(); }
});
