import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { montarPacote } from '../scripts/backup-pacote.mjs';
import { bancoFicticio } from './apoio/backup.mjs';
void test('instalacao nao gera batch na configuracao privada', () => {
  const codigo = fs.readFileSync(new URL('../../scripts/instalar.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(codigo, /WriteAllText\("[^"\r\n]*\.bat"/i);
});
void test('backup unico: falha de snapshot nao copia configuracao', t => {
  const dir = criarTemporarioTeste('sv-semente-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const banco = path.join(dir, 'fixture.sqlite'); bancoFicticio(banco).close();
  fs.writeFileSync(banco, 'nao e SQLite');
  assert.throws(() => montarPacote(path.join(dir, 'conteudo'), { raiz: dir, banco }));
  assert.equal(fs.existsSync(path.join(dir, 'conteudo/comum')), false);
});
