import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import test from 'node:test';
import { criarTemporarioTeste, motivoPularIntegracaoWindows } from './apoio/ambiente.mjs';

void test('limpa Node orfao desta instalacao e preserva outro Node', { skip: motivoPularIntegracaoWindows(), timeout: 30_000 }, async () => {
  const dir = criarTemporarioTeste('sv-orfaos-'), processos = [];
  const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    for (const nome of ['instalacao', 'instalacao-extra']) {
      const root = path.join(dir, nome), script = path.join(root, 'portal/scripts/processar-relatorios.mjs');
      fs.mkdirSync(path.dirname(script), { recursive: true });
      // Porta efemera: reproduz um servidor orfao segurando sua porta, sem disputar a producao.
      fs.writeFileSync(script, "import http from 'node:http';import fs from 'node:fs';http.createServer((q,r)=>r.end('fixture')).listen(0,'127.0.0.1',function(){fs.writeFileSync(process.argv[2],String(this.address().port))});");
      processos.push(spawn(process.execPath, [script, path.join(root, 'porta.txt')], { stdio: 'ignore' }));
      for (let n = 0; n < 100 && !fs.existsSync(path.join(root, 'porta.txt')); n++) await esperar(50);
      assert.ok(fs.existsSync(path.join(root, 'porta.txt')), 'Node ficticio iniciou');
    }
    const op = path.resolve(import.meta.dirname, '../../scripts/operacao-logica.ps1');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'psmodulepath'));
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '. $env:SV_LOGICA; Encerrar-OrfaosInstalacao $env:SV_RAIZ'], { env: { ...env, SV_LOGICA: op, SV_RAIZ: path.join(dir, 'instalacao') }, timeout: 15_000 });
    for (let n = 0; n < 100 && processos[0].exitCode === null; n++) await esperar(50);
    assert.notEqual(processos[0].exitCode, null, 'orfao foi encerrado antes da nova partida');
    assert.equal(processos[1].exitCode, null, 'outro Node permanece ativo');
  } finally {
    for (const p of processos) if (p.exitCode === null) { const fim = new Promise(resolve => p.once('exit', resolve)); p.kill(); await fim; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
