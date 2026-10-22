import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'rolldown/utils';

// Executa os componentes reais com JSX, aliases e o mesmo React instalado no Portal.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    let target;
    if (specifier.startsWith('@/')) target = new URL(`../${specifier.slice(2)}`, import.meta.url);
    else if (specifier.startsWith('.') && context.parentURL?.endsWith('.tsx')) target = new URL(specifier, context.parentURL);
    if (target && !/\.[cm]?[jt]sx?$/.test(target.pathname)) {
      for (const extension of ['.tsx', '.ts']) {
        const candidate = new URL(target.href + extension);
        if (fs.existsSync(candidate)) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    const result = transformSync(fileURLToPath(url), fs.readFileSync(new URL(url), 'utf8'), { jsx: { runtime: 'automatic' } });
    assert.deepEqual(result.errors, []);
    return { format: 'module', source: result.code, shortCircuit: true };
  },
});
after(() => hooks.deregister());

const { Sidebar } = await import('../components/portal-sidebar.tsx');
const { CabecalhoOrdenavel } = await import('../components/portal-table.tsx');
const { Field, Info, Loading, SelectField, money, date } = await import('../components/portal-presentation.tsx');
const { Dialog, DialogFooter } = await import('../components/ui/dialog.tsx');
const { Input } = await import('../components/ui/input.tsx');

for (const [role, allowed, forbidden] of [
  ['viewer', ['Buscar', 'Manutenção'], ['Chamados', 'Acordos', 'Relatórios', 'Usuários']],
  ['editor', ['Buscar', 'Manutenção', 'Chamados', 'Acordos', 'Cadastros'], ['Relatórios', 'Histórico', 'E-mails', 'Usuários']],
  ['admin', ['Buscar', 'Manutenção', 'Chamados', 'Acordos', 'Cadastros', 'Administração'], ['Relatórios', 'Histórico', 'E-mails', 'Usuários']],
]) {
  void test(`menu ${String(role)} expoe apenas as acoes do perfil, inclusive recolhido`, () => {
    for (const collapsed of [false, true]) {
      const html = renderToStaticMarkup(h(Sidebar, { user: { role }, nav: 'search', collapsed, busy: true }));
      for (const label of allowed) assert.ok(html.includes(`aria-label="${label}"`), label);
      for (const label of forbidden) assert.ok(!html.includes(`aria-label="${String(label)}"`), label);
      assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Sair"/);
      assert.match(html, /aria-current="page"/);
    }
  });
}

void test('versao do pacote aparece no rodape e apenas no title quando recolhido', () => {
  const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const collapsed of [false, true]) {
    const html = renderToStaticMarkup(h(Sidebar, { user: { role: 'viewer' }, nav: 'search', collapsed }));
    assert.ok(html.includes(`title="v${version}"`));
    assert.equal(html.includes(`>v${version}</p>`), !collapsed);
  }
});

void test('cabecalho anuncia a coluna e o sentido e escapa o titulo', () => {
  for (const [direcao, expected] of [[1, 'ascending'], [-1, 'descending']]) {
    const html = renderToStaticMarkup(h('table', null, h('thead', null, h(CabecalhoOrdenavel, {
      titulos: ['Fornecedor <teste>', 'Código'], ordem: { coluna: 0, direcao }, acoes: false,
    }))));
    assert.equal((html.match(/aria-sort=/g) || []).length, 1);
    assert.ok(html.includes(`aria-sort="${expected}"`));
    assert.ok(html.includes('Fornecedor &lt;teste&gt;'));
    assert.ok(!html.includes('<teste>'));
  }
});

void test('campos conservam rotulo, bloqueio de envio e texto sem HTML executavel', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const html = renderToStaticMarkup(h(Field, { label: 'Nome' }, h(Input, { value: payload, readOnly: true })));
  assert.match(html, /<label[^>]*>.*Nome.*<input/);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  const info = renderToStaticMarkup(h(Info, { label: 'Observação', value: payload }));
  assert.ok(!info.includes('<img'));
  const select = renderToStaticMarkup(h(SelectField, { label: 'UF', value: 'SP', rows: [{ id: 'SP', name: 'SP' }], disabled: true }));
  assert.match(select, /<select[^>]*disabled=""/);
  assert.match(renderToStaticMarkup(h(Loading, { label: 'Carregando usuários…' })), /<output[^>]*>Carregando usuários…<\/output>/);
});

void test('formatacao brasileira e fechamento em portugues permanecem disponiveis', () => {
  assert.equal(money(1234.5), 'R$\u00a01.234,50');
  assert.equal(money(0), 'R$\u00a00,00');
  assert.equal(date('2026-10-20'), '20/10/2026');
  assert.equal(date(null), 'Indeterminado');
  const html = renderToStaticMarkup(h(Dialog, { open: true }, h(DialogFooter, { showCloseButton: true })));
  assert.ok(html.includes('Fechar'));
  assert.ok(!html.includes('>Close<'));
});
