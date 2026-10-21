import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

void test('instalacao nova conserva processo e Handle, usa temporario unico e recusa porta sem sucessora', () => {
  // Nao executa a instalacao nova: o fluxo privilegiado pertence ao CI Windows.
  const fonte = fs.readFileSync(new URL('../scripts/teste-instalacao-nova.ps1', import.meta.url), 'utf8');
  assert.match(fonte, /ValidateRange\(1024,65534\)/);
  assert.doesNotMatch(fonte, /['"]consulta-teste\.cjs['"]/);
  assert.match(fonte, /\$script:processoServidor\s*=\s*Start-Process[^\r\n]+-PassThru\r?\n\s*\[void\]\$script:processoServidor.Handle/);
  assert.match(fonte, /!\$script:processoServidor.HasExited/);
});
