import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hashArquivo } from '../scripts/backup.mjs';
void test('checksum por blocos inclui ultimo bloco parcial e arquivo vazio',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-checksum-'));
  try {
    const arquivo=path.join(dir,'fixture.sqlite');
    for(const tamanho of [0,1024*1024,3*1024*1024+17]) {
      const bytes=Buffer.alloc(tamanho,123);if(tamanho)bytes[tamanho-1]=77;
      fs.writeFileSync(arquivo,bytes);
      assert.equal(hashArquivo(arquivo),createHash('sha256').update(bytes).digest('hex'));
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
