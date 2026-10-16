import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { executarBackup } from '../scripts/backup.mjs';

void test('snapshot local de atualizacao nao consulta senha, rede ou SMTP', async () => {
  let copias = 0;
  assert.equal(await executarBackup({ somenteLocal: true, config: {}, copiar: () => copias++, senha: () => assert.fail(), rede: () => assert.fail(), email: () => assert.fail() }), 0);
  assert.equal(copias, 1);
  await assert.rejects(executarBackup({ somenteLocal: true, config: {}, copiar: () => { throw new Error('falha local'); } }), /falha local/);
});
void test('CONCLUIR nao envia snapshot velho; rollback escolhe exclusivamente pre-atualizacao', () => {
  const codigo = fs.readFileSync(new URL('../../scripts/atualizar-servidor.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(codigo, /--somente-rede|--snapshot-pre-atualizacao|Copy-Item[^\n]*portal-atual/);
  assert.match(codigo, /restaurar-backup\.mjs[^\n]*--pre-atualizacao/);
});
