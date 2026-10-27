import assert from 'node:assert/strict';
import test from 'node:test';
import { mount } from './apoio/telas.mjs';

void test('overflow lista e permite remover selecoes ausentes das opcoes', async (t) => {
  let selecionados = ['disponivel', 'oculto'];
  const disponivel = { id: 'disponivel', name: 'Fornecedor disponível' };
  const oculto = { id: 'oculto', name: 'Fornecedor anterior' };
  const h = await mount(
    'search-multi-select',
    'SearchMultiSelect',
    {
      label: 'Fornecedores',
      value: selecionados,
      onChange: (value) => { selecionados = value; },
      options: [disponivel],
      selectedOptions: [disponivel, oculto],
    },
    {
      react: {
        useId: () => 'busca-fornecedores',
        useEffect() {},
        useRef: (current) => ({ current }),
        useState: (initial) => [initial, () => {}],
      },
      '@base-ui/react/combobox': { Combobox: new Proxy({}, { get: (_target, key) => String(key) }) },
    },
  );
  t.after(() => h.unmount());

  const overflow = h.one('button', (p) => p['aria-label'] === '2 outras seleções de Fornecedores');
  overflow.onClick();
  h.render();
  assert.equal(h.one('p', (p) => p.children === 'Selecionadas').children, 'Selecionadas');
  assert.equal(h.one('span', (p) => p.children === 'Fornecedor anterior').children, 'Fornecedor anterior');
  assert.equal(h.one('span', (p) => p.children === '(indisponível)').children, '(indisponível)');
  h.one('button', (p) => p['aria-label'] === 'Remover Fornecedor anterior').onClick();
  assert.deepEqual(selecionados, ['disponivel']);
});
