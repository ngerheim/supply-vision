import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { travarRestauracao } from '../scripts/trava-restauracao.mjs';

void test('consumidores compartilham trava e excluem restauração entre processos', (t) => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'trava-restauracao-'));
  t.after(()=>fs.rmSync(pasta,{recursive:true,force:true}));
  const primeiro=travarRestauracao(false,pasta), segundo=travarRestauracao(false,pasta);
  const tentar=()=>spawnSync(process.execPath,['--input-type=module','-e',
    "import {travarRestauracao} from './scripts/trava-restauracao.mjs'; travarRestauracao(true,process.argv[1])();",pasta],
  {cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8'});
  try { assert.equal(tentar().status,1); }
  finally { primeiro();segundo(); }
  assert.equal(tentar().status,0);
  const exclusiva=travarRestauracao(true,pasta);
  try { assert.throws(()=>travarRestauracao(false,pasta),/não podem/); }
  finally { exclusiva(); }
  travarRestauracao(false,pasta)();
});
