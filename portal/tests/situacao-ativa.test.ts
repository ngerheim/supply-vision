import assert from 'node:assert/strict';
import test from 'node:test';
import {situacaoAtiva} from '../lib/domain.ts';
void test('situacao omitida ou numerica preserva inatividade',()=>{assert.equal(situacaoAtiva(0,0),0);assert.equal(situacaoAtiva(undefined,0),0);assert.equal(situacaoAtiva(undefined,1),1)});
void test('situacao explicita altera ativacao',()=>{assert.equal(situacaoAtiva(true,0),1);assert.equal(situacaoAtiva(false,1),0);assert.equal(situacaoAtiva(1,0),1)});
