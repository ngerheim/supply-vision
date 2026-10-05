import assert from 'node:assert/strict';
import test from 'node:test';
import { validarPedidoRelatorio } from '../lib/relatorios.ts';
import {
  GRUPOS_NAVEGACAO,
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
void test('perfis herdam exatamente os três conjuntos solicitados', () => {
  for (const grupo of GRUPOS_NAVEGACAO)
    for (const aba of grupo.abas) {
      assert.equal(
        podeAcessarAba('viewer', aba),
        grupo.perfil === 'viewer',
        aba,
      );
      assert.equal(
        podeAcessarAba('editor', aba),
        grupo.perfil !== 'admin',
        aba,
      );
      assert.equal(podeAcessarAba('admin', aba), true, aba);
    }
  assert.equal(NOMES_PERFIL.editor, 'Suprimentos');
  assert.equal(new Set(GRUPOS_NAVEGACAO.flatMap((g) => [...g.abas])).size, 12);
});
void test('recorte aceita datas inclusivas e um destinatário isolado', () => {
  assert.deepEqual(validarPedidoRelatorio(base, '2026-02-01'), {
    ...base,
    dryRun: false,
  });
  assert.equal(
    validarPedidoRelatorio(
      { ...base, to: base.from, recipient: '  outro@example.com  ' },
      '2026-02-01',
    ).recipient,
    'outro@example.com',
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
void test('recorte rejeita múltiplos destinatários e injeção de cabeçalhos', () => {
  for (const recipient of [
    '',
    'a@example.com;b@example.com',
    'a@example.com,b@example.com',
    'Nome <a@example.com>',
    'a@example.com\r\nBcc:b@example.com',
    'a'.repeat(250) + '@x.com',
  ])
    assert.throws(() => validarPedidoRelatorio({ ...base, recipient }));
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
