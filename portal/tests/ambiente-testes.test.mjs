import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { criarTemporarioTeste, motivoPularIntegracaoWindows } from './apoio/ambiente.mjs';

void test('integracao privilegiada exige chave explicita e Windows, mesmo com CI=true', () => {
  for (const valor of [undefined, '', '0', 'true']) {
    assert.match(motivoPularIntegracaoWindows({ CI: 'true', SV_TESTES_INTEGRACAO_WINDOWS: valor }, 'win32'), /somente no CI/);
  }
  assert.match(motivoPularIntegracaoWindows({ SV_TESTES_INTEGRACAO_WINDOWS: '1' }, 'linux'), /exige Windows/);
  assert.equal(motivoPularIntegracaoWindows({ SV_TESTES_INTEGRACAO_WINDOWS: '1' }, 'win32'), false);
});

void test('temporario resolve alias antes de criar diretorio e copiar arvore', () => {
  const raiz = criarTemporarioTeste('sv-temp-alias-');
  try {
    const longo = path.join(raiz, 'automacao.ficticia com espacos');
    const alias = path.join(raiz, 'alias');
    fs.mkdirSync(longo);
    fs.symlinkSync(longo, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const destino = criarTemporarioTeste('copia-', alias);
    assert.equal(path.dirname(destino), fs.realpathSync.native(longo));
    const origem = path.join(raiz, 'origem');
    fs.mkdirSync(origem); fs.writeFileSync(path.join(origem, 'fixture.txt'), 'ficticio');
    fs.cpSync(origem, path.join(destino, 'scripts'), { recursive: true });
    assert.equal(fs.readFileSync(path.join(destino, 'scripts/fixture.txt'), 'utf8'), 'ficticio');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
