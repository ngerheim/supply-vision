import assert from 'node:assert/strict';
import test from 'node:test';
import { montarEmailRelatorioDiario } from '../lib/email-relatorio-diario.ts';

void test('relatório resume quantidades e atualizações sem expor HTML',()=>{
  const email=montarEmailRelatorioDiario('09/09/2026',{aberto:3,aguardando:5,fechado:1,cancelado:0},[{id:'t1',codigo:'SUP-0012',fornecedor:'Oficina <Teste>',situacao:'aberto',atualizacoes:[{horario:'14:30',autor:'Ana',descricao:'Nova <mensagem>'}]}],'http://127.0.0.1:3000');
  assert.match(email.texto,/3 aberto\(s\), 5 aguardando, 1 fechado\(s\)/);
  assert.match(email.texto,/SUP-0012/);
  assert.doesNotMatch(email.html,/Oficina <Teste>/);
  assert.match(email.html,/Oficina &lt;Teste&gt;/);
});

void test('relatório informa quando não houve atualização',()=>{
  const email=montarEmailRelatorioDiario('09/09/2026',{aberto:0,aguardando:0,fechado:0,cancelado:0},[],'http://portal');
  assert.match(email.texto,/Nenhum chamado foi atualizado hoje/);
});
