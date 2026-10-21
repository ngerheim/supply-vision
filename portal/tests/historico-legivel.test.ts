import assert from 'node:assert/strict';
import test from 'node:test';
import { detalhesHistorico, referenciasHistorico } from '../lib/historico-legivel.ts';
void test('alteração de preço mostra nomes e valores brasileiros sem IDs ou campos inalterados', () => {
  const texto = JSON.stringify({ antes: { id: 'itm_123', version_id: 'ver_123', catalog_item_id: 'ite_123', vehicle_model_id: 'mod_123', price: 2028, brands_text: 'TRW', revision: 0 }, depois: { catalog_item_id: 'ite_123', vehicle_model_id: 'mod_123', price: 2000, brands_text: 'TRW' } });
  const resultado = detalhesHistorico(texto, { 'catalog_item_id:ite_123': 'Amortecedor', 'vehicle_model_id:mod_123': 'Hilux' });
  assert.match(resultado, /Item: Amortecedor/); assert.match(resultado, /Modelo: Hilux/);
  assert.match(resultado, /Preço: R\$\s2\.028,00 → R\$\s2\.000,00/);
  assert.doesNotMatch(resultado, /itm_|ite_|mod_|ver_|revision|Marcas/);
  assert.deepEqual(referenciasHistorico([texto]).catalog_item_id, ['ite_123']);
});
void test('exclusões, cadastros removidos e textos antigos continuam legíveis', () => {
  const resultado = detalhesHistorico(JSON.stringify({ antes: { catalog_item_id: 'ite_removido', price: 10, notes: 'Teste' }, depois: null }));
  assert.match(resultado, /Condição excluída/); assert.match(resultado, /Cadastro não disponível/);
  assert.doesNotMatch(resultado, /ite_removido/);
  assert.equal(detalhesHistorico('Acordo criado'), 'Acordo criado');
  assert.equal(detalhesHistorico('{corrompido'), 'Detalhes técnicos não disponíveis para exibição.');
  assert.doesNotMatch(detalhesHistorico('{"password_hash":"secreto","id":"usr_123"}'), /secreto|usr_123/);
});

void test('exclusao conserva numero do acordo mesmo depois de acordo removido ou renomeado', () => {
  const detalhes = JSON.stringify({ antes: { agreementId: 'agr_a', agreementNumber: 'ACORDO-42', version_id: 'ver_a', price: 10 }, depois: null });
  const cenarios: Record<string, string>[] = [{}, { 'agreementId:agr_a': 'NUMERO-NOVO' }];
  for (const nomes of cenarios) {
    const texto = detalhesHistorico(detalhes, nomes);
    assert.match(texto, /Acordo: ACORDO-42/);
    assert.doesNotMatch(texto, /agr_a|ver_a|NUMERO-NOVO/);
    assert.equal(texto.match(/Acordo:/g)?.length, 1);
  }
});
void test('exclusao antiga recupera acordo pela versao sem alterar registro bruto', () => {
  const detalhes = JSON.stringify({ antes: { version_id: 'ver_antiga', price: 10 }, depois: null });
  assert.deepEqual(referenciasHistorico([detalhes]).version_id, ['ver_antiga']);
  assert.match(detalhesHistorico(detalhes, { 'version_id:ver_antiga': 'ACORDO-ANTIGO' }), /Acordo: ACORDO-ANTIGO/);
  assert.doesNotMatch(detalhesHistorico(detalhes), /ver_antiga|undefined/);
});
