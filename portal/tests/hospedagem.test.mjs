import assert from 'node:assert/strict';
import test from 'node:test';
import { configuracaoBinding } from '../scripts/configuracao-hospedagem.mjs';

test('sem destino remoto explicito preserva a identidade do banco local', () => {
  const config = configuracaoBinding({ CLOUDFLARE_D1_DATABASE_ID: '11111111-1111-4111-8111-111111111111' });
  assert.deepEqual(config.d1_databases, [{ binding: 'DB', database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000' }]);
  assert.equal(config.name, undefined);
});

test('homologacao exige uma base remota e nao incorpora segredos', () => {
  const config = configuracaoBinding({ SUPPLY_VISION_TARGET: 'cloudflare-staging', CLOUDFLARE_D1_DATABASE_ID: '11111111-1111-4111-8111-111111111111', INITIAL_ADMIN_PASSWORD: 'nao-compilar', PORTAL_API_TOKEN: 'nao-compilar' });
  assert.equal(config.name, 'supply-vision-portal-staging');
  assert.equal(config.d1_databases[0].binding, 'DB');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.ok(!JSON.stringify(config).includes('nao-compilar'));
});

test('destino ou base incorretos falham antes da compilacao', () => {
  assert.throws(() => configuracaoBinding({ SUPPLY_VISION_TARGET: 'producao' }), /SUPPLY_VISION_TARGET/);
  for (const databaseId of ['', 'invalido', '00000000-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000']) {
    assert.throws(() => configuracaoBinding({ SUPPLY_VISION_TARGET: 'cloudflare-staging', CLOUDFLARE_D1_DATABASE_ID: databaseId }), /homologacao/);
  }
});
