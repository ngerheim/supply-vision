import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

void test('Portal ponta a ponta conserva processo e Handle, usa temporario unico e recusa porta sem sucessora', () => {
  // Nao executa o Portal ponta a ponta: o fluxo integrado pertence ao CI Windows.
  const fonte = fs.readFileSync(new URL('../scripts/teste-portal-ponta-a-ponta.ps1', import.meta.url), 'utf8');
  assert.match(fonte, /ValidateRange\(1024,65534\)/);
  assert.doesNotMatch(fonte, /['"]consulta-teste\.cjs['"]/);
  assert.match(fonte, /Iniciar-PortalEnsaio \$projeto \$ambienteServidor \$logServidor/);
  assert.match(fonte, /Encerrar-PortalEnsaio \$script:registroServidor/);
  const auxiliar = fs.readFileSync(new URL('../scripts/portal-ensaio.ps1', import.meta.url), 'utf8');
  assert.match(auxiliar, /\$processo = Start-Process[^\r\n]+-PassThru\r?\n\s*\[void\]\$processo.Handle/);
  assert.match(auxiliar, /StartTime.ToUniversalTime\(\) -ne \$Registro.Inicio/);
  assert.match(auxiliar, /CommandLine.Contains\(\$Registro.Entrada\)/);
});
