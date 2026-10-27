import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { mount } from './apoio/telas.mjs';

const catalog = await import('../lib/email-types.ts');
const tick = async (h) => {
  await setImmediate();
  h.render();
};

void test('notificações exibem e filtram tipos de solicitação', async (t) => {
  const h = await mount(
    'email-notifications',
    'EmailNotifications',
    { users: [], run() {} },
    { '@/lib/email-types': catalog },
  );
  t.after(() => h.unmount());
  const tipos = [
    ['solicitacao_abertura', 'Abertura de solicitação'],
    ['solicitacao_andamento', 'Atualização de solicitação'],
  ];
  const filtro = h.one('NativeSelect', (props) => props['aria-label'] === 'Tipo');
  for (const [codigo, rotulo] of tipos) {
    assert.ok(
      h.find((node) => node.type === 'NativeSelectOption').some((node) =>
        node.props.value === codigo && node.props.children === rotulo),
      `filtro contém ${rotulo}`,
    );
  }
  h.requests[0].resolve({ notifications: [], total: 0, page: 1, pageCount: 1 });
  await tick(h);
  for (const [codigo, rotulo] of tipos) {
    filtro.onChange({ target: { value: codigo } });
    h.render();
    const requisicao = h.requests.at(-1);
    assert.equal(new URL(`http://localhost${requisicao.path}`).searchParams.get('type'), codigo);
    requisicao.resolve({
      notifications: [{
        id: codigo,
        deliveryKind: 'email',
        type: codigo,
        status: 'sent',
        attempts: 1,
        createdAt: '2026-10-27T12:00:00Z',
        ticketCode: codigo,
        supplierName: 'Fornecedor fictício',
        recipientName: 'Pessoa fictícia',
        recipientEmail: 'pessoa@example.com',
      }],
      total: 1,
      page: 1,
      pageCount: 1,
    });
    await tick(h);
    assert.ok(
      h.find((node) => node.type === 'TableCell').some((node) => node.props.children === rotulo),
      `tabela exibe ${rotulo}`,
    );
  }
});
