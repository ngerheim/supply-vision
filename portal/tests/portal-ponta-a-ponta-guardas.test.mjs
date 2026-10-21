import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

void test('Portal ponta a ponta conserva processo e Handle, usa temporario unico e recusa porta sem sucessora', () => {
  // Nao executa o Portal ponta a ponta: o fluxo integrado pertence ao CI Windows.
  const fonte = fs.readFileSync(new URL('../scripts/teste-portal-ponta-a-ponta.ps1', import.meta.url), 'utf8');
  assert.match(fonte, /ValidateRange\(1024,65534\)/);
  assert.doesNotMatch(fonte, /['"]consulta-teste\.cjs['"]/);
  assert.match(fonte, /\$script:processoServidor\s*=\s*Start-Process[^\r\n]+-PassThru\r?\n\s*\[void\]\$script:processoServidor.Handle/);
  assert.match(fonte, /!\$script:processoServidor.HasExited/);
});
