import assert from 'node:assert/strict';
import test from 'node:test';
import { redigirLog } from '../scripts/redigir-log.mjs';
void test('logs ocultam segredos configurados e formatos comuns de erro', () => {
  const valores = ['primeira-chave', 'segunda-chave', 'senha configurada'];
  const texto = `${valores.join('\n')}\nAuthorization: Bearer outra-chave\nSMTP_PASSWORD=senha-nova\n{"api_key":"segredo-json"}\nhttps://usuario:senha-url@example.com/teste\nErro HTTP 503`;
  const saida = redigirLog(texto, valores);
  for (const valor of [...valores, 'outra-chave', 'senha-nova', 'segredo-json', 'senha-url']) assert.equal(saida.includes(valor), false);
  assert.ok(saida.includes('Erro HTTP 503'));
});
