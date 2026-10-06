import assert from 'node:assert/strict';
import test from 'node:test';
import { VALIDADE_HISTORICO_MS, arquivoHistoricoExpirado, informarValidadeArquivos } from '../lib/retencao-relatorios.ts';
void test('históricos expiram exatamente em 24 horas e diários não herdam essa regra', () => {
  const geracao = Date.parse('2026-10-06T12:00:00Z');
  const artifact = { name: 'recorte.xlsx', expiresAt: new Date(geracao + VALIDADE_HISTORICO_MS).toISOString() };
  assert.equal(arquivoHistoricoExpirado({ action: 'recorte' }, artifact, geracao + VALIDADE_HISTORICO_MS - 1), false);
  assert.equal(arquivoHistoricoExpirado({ action: 'recorte' }, artifact, geracao + VALIDADE_HISTORICO_MS), true);
  assert.equal(arquivoHistoricoExpirado({ action: 'relatorio' }, artifact, geracao + 2 * VALIDADE_HISTORICO_MS), false);
  const job = { action: 'recorte', completedAt: new Date(geracao).toISOString(), artifactsJson: '[{"name":"antigo.xlsx"}]' };
  assert.equal(JSON.parse(informarValidadeArquivos(job, geracao + VALIDADE_HISTORICO_MS))[0].expired, true);
  assert.equal(informarValidadeArquivos({ artifactsJson: 'corrompido' }), '[]');
});
