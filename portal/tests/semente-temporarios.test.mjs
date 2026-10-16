import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { montarPacote } from '../scripts/backup-pacote.mjs';
import { bancoFicticio } from './apoio/backup.mjs';
void test('semente reduzida usa backup unico; falha de snapshot nao copia configuracao', t => {
  const dir = criarTemporarioTeste('sv-semente-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const banco = path.join(dir, 'fixture.sqlite'); bancoFicticio(banco).close();
  const preparar = fs.readFileSync(new URL('../../scripts/preparar-semente.ps1', import.meta.url), 'utf8');
  const restaurar = fs.readFileSync(new URL('../../scripts/restaurar-semente.ps1', import.meta.url), 'utf8');
  assert.match(preparar, /Executar-NativoOperacao/); assert.doesNotMatch(preparar, /Compress-Archive|\.zip/);
  assert.match(restaurar, /--configuracao/); assert.doesNotMatch(restaurar, /Expand-Archive/);
  fs.writeFileSync(banco, 'nao e SQLite');
  assert.throws(() => montarPacote(path.join(dir, 'conteudo'), { raiz: dir, banco }));
  assert.equal(fs.existsSync(path.join(dir, 'conteudo/comum')), false);
});
