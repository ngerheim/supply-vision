import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { configurarValidacao, validacaoAtiva } from '../scripts/operacao-validacao.mjs';
import { processarNotificacoes, processarRelatoriosDiarios } from '../scripts/processar-emails.mjs';
import { reservarRelatorio } from '../scripts/processar-relatorios.mjs';
import { VALIDACAO_ATIVA_SQL } from '../lib/operacao-validacao.ts';

void test('validacao bloqueia efeitos externos e libera sem reiniciar processos', async()=>{
  const db=new DatabaseSync(':memory:');let envios=0;
  try {
    assert.equal(validacaoAtiva(db),false);
    configurarValidacao(db,true);
    assert.equal(validacaoAtiva(db),true);
    assert.equal(db.prepare(VALIDACAO_ATIVA_SQL).get().ativa,1);
    const smtp={sendMail:async()=>{envios++;}};
    // Nao existem filas: durante a validacao elas nem devem ser consultadas.
    await processarNotificacoes(db,{},smtp);
    await processarRelatoriosDiarios(db,{},smtp);
    assert.equal(reservarRelatorio(db),null);
    assert.equal(envios,0);
    configurarValidacao(db,false);
    assert.equal(validacaoAtiva(db),false);
    assert.equal(db.prepare(VALIDACAO_ATIVA_SQL).get(),undefined);
  } finally { db.close(); }
});
