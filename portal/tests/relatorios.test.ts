import assert from 'node:assert/strict';
import test from 'node:test';
import { gerarChaveRelatorio, validarPedidoRelatorio } from '../lib/relatorios.ts';
import {
  ABAS_NAVEGACAO,
  NOMES_PERFIL,
  podeAcessarAba,
} from '../lib/navegacao.ts';

const base = {
  action: 'recorte',
  from: '2026-01-01',
  to: '2026-01-31',
  recipient: 'destino@example.com',
  requestKey: '12345678-1234-1234-1234-123456789012',
};
void test('solicitações funcionam em HTTP quando Crypto não oferece randomUUID', () => {
  const fonte = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  assert.equal('randomUUID' in fonte, false);
  const requestKey = gerarChaveRelatorio(fonte);
  assert.match(requestKey, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  for (const action of ['relatorio', 'recorte', 'limpeza']) {
    assert.equal(validarPedidoRelatorio({ ...base, action, requestKey }).requestKey, requestKey);
  }
  assert.notEqual(gerarChaveRelatorio(fonte), requestKey);
});
void test('perfis herdam exatamente os três conjuntos solicitados', () => {
  const consulta = new Set(['search','maintenance','solicitacoes','baixas','estoque-saldo','estoque-entradas']);
  const administracao = new Set(['reports','history','emails','admin','categorias','estoques']);
  for (const grupo of ABAS_NAVEGACAO)
    for (const {chave:aba} of grupo.subabas) {
      assert.equal(
        podeAcessarAba({ role: 'viewer' }, aba),
        consulta.has(aba),
        aba,
      );
      assert.equal(
        podeAcessarAba({ role: 'editor' }, aba),
        !administracao.has(aba),
        aba,
      );
      assert.equal(podeAcessarAba({ role: 'admin' }, aba), true, aba);
    }
  assert.equal(NOMES_PERFIL.editor, 'Suprimentos');
  assert.equal(new Set(ABAS_NAVEGACAO.flatMap(g => g.subabas.map(sub => sub.chave))).size, 18);
});
void test('recorte aceita datas inclusivas e nunca mantém destinatário', () => {
  assert.deepEqual(validarPedidoRelatorio(base, '2026-02-01'), {
    ...base,
    recipient: null,
    dryRun: false,
  });
  assert.equal(
    validarPedidoRelatorio(
      { ...base, to: base.from, recipient: '  outro@example.com  ' },
      '2026-02-01',
    ).recipient,
    null,
  );
});
void test('recorte recusa datas inválidas, invertidas, futuras ou ausentes', () => {
  for (const patch of [
    { from: '2026-02-30' },
    { from: '01/01/2026' },
    { from: '2026-02-01' },
    { to: '2026-02-02' },
    { from: undefined },
    { to: undefined },
  ])
    assert.throws(() =>
      validarPedidoRelatorio({ ...base, ...patch }, '2026-02-01'),
    );
});
void test('destinatários antigos são ignorados, inclusive texto malformado', () => {
  for (const recipient of [
    '',
    'a@example.com;b@example.com',
    'a@example.com,b@example.com',
    'Nome <a@example.com>',
    'a@example.com\r\nBcc:b@example.com',
    'a'.repeat(250) + '@x.com',
  ])
    assert.equal(validarPedidoRelatorio({ ...base, recipient }).recipient, null);
});
void test('operação é uma lista fechada e identidade é obrigatória', () => {
  for (const patch of [
    { action: '../../arquivo' },
    { action: 'powershell' },
    { requestKey: undefined },
    { requestKey: '1' },
    { dryRun: 'false' },
  ])
    assert.throws(() => validarPedidoRelatorio({ ...base, ...patch }));
});
void test('diário não aceita destinatário de recorte e simulação só vale para limpeza', () => {
  assert.deepEqual(
    validarPedidoRelatorio({ ...base, action: 'relatorio', dryRun: true }),
    {
      action: 'relatorio',
      requestKey: base.requestKey,
      from: null,
      to: null,
      recipient: null,
      dryRun: false,
    },
  );
  assert.equal(
    validarPedidoRelatorio({ ...base, action: 'limpeza', dryRun: true }).dryRun,
    true,
  );
});
