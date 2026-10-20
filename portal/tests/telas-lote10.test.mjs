import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { rolldown } from 'rolldown';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError, errorText } from '../lib/api.ts';
import * as domain from '../lib/domain.ts';
import * as busca from '../lib/busca.ts';
import * as filtros from '../lib/filtros-busca.ts';
import * as situacao from '../lib/situacao-acordos.ts';

// Executa os handlers reais dos componentes sem DOM. Só hooks, HTTP e os
// componentes visuais filhos são substituídos; o compilador é o do build.
const compiled = new Map();
async function mount(file, name, props, overrides = {}) {
  if (!compiled.has(file)) {
    const bundle = await rolldown({
      input: fileURLToPath(
        new URL(`../components/${file}.tsx`, import.meta.url),
      ),
      external: (_id, importer) => Boolean(importer),
      onLog(level, warning, defaultHandler) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE')
          defaultHandler(level, warning);
      },
    });
    try {
      const { output } = await bundle.generate({ format: 'cjs' });
      compiled.set(file, output[0].code);
    } finally {
      await bundle.close();
    }
  }
  const slots = [],
    effects = [],
    requests = [];
  let cursor = 0,
    tree,
    currentProps = props;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
    useRef(value) {
      const index = cursor++;
      return (slots[index] ||= { current: value });
    },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn, deps) {
      return hooks.useMemo(() => fn, deps);
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps))
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: fn() };
        });
    },
  };
  const visual = new Proxy({}, { get: (_target, key) => String(key) });
  const http = {
    ApiError,
    errorText,
    api(path, options) {
      const request = { path, options };
      request.promise = new Promise((resolve, reject) =>
        Object.assign(request, { resolve, reject }),
      );
      requests.push(request);
      return request.promise;
    },
  };
  const modules = {
    react: hooks,
    'react/jsx-runtime': jsx,
    '@/lib/api': http,
    '@/lib/domain': domain,
    '@/lib/busca': busca,
    '@/lib/filtros-busca': filtros,
    '@/lib/situacao-acordos': situacao,
    './portal-table': {
      ...visual,
      useOrdenacao: () => ({
        ordem: null,
        ordenar: (rows) => rows,
        alternar() {},
      }),
      CabecalhoOrdenavel: 'CabecalhoOrdenavel',
    },
    './portal-presentation': {
      ...visual,
      money: (value) =>
        Number(value).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }),
      date: String,
      cnpj: String,
      Field: 'Field',
      Info: 'Info',
      Loading: 'Loading',
      Empty: 'Empty',
      PaginacaoDeLista: 'PaginacaoDeLista',
      FalhaDeCarregamento: 'FalhaDeCarregamento',
    },
    ...overrides,
  };
  const compiledModule = { exports: {} };
  runInNewContext(compiled.get(file), {
    require: (id) => modules[id] || visual,
    module: compiledModule,
    exports: compiledModule.exports,
    AbortController,
    FormData,
    File,
    URLSearchParams,
    queueMicrotask,
    setTimeout: globalThis.setTimeout,
    clearTimeout,
  });
  const component = compiledModule.exports[name];
  const harness = {
    requests,
    render(next = currentProps) {
      currentProps = next;
      cursor = 0;
      tree = component(currentProps);
      for (const effect of effects.splice(0)) effect();
      return tree;
    },
    find(predicate) {
      const found = [];
      const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== 'object') return;
        if (predicate(node)) found.push(node);
        visit(node.props?.children);
      };
      visit(tree);
      return found;
    },
    one(type, predicate = () => true) {
      const nodes = harness.find(
        (node) => node.type === type && predicate(node.props),
      );
      assert.equal(
        nodes.length,
        1,
        `Esperado um ${type}, encontrados ${nodes.length}`,
      );
      return nodes[0].props;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
  harness.render();
  return harness;
}
const catalogs = {
  suppliers: [],
  locations: [],
  items: [],
  models: [],
  units: [],
};
const detail = (id, items = [], totalItems = items.length) => ({
  agreement: {
    id,
    number: id,
    status: 'active',
    supplier: 'Fornecedor fictício',
  },
  items,
  totalItems,
  locations: [],
  version: 'v1',
});

void test('acordo descarta resposta de outro id e pagina antiga apos mudar ordenacao', async (t) => {
  const props = { id: 'a', revision: 1, canWrite: false };
  const h = await mount('portal-agreements', 'AgreementDetail', props);
  t.after(() => h.unmount());
  await setImmediate();
  const old = h.requests[0];
  h.render({ ...props, id: 'b' });
  await setImmediate();
  assert.equal(old.options.signal.aborted, true);
  h.requests[1].resolve(detail('b', [{ id: 'b1', item: 'Atual' }], 2));
  await setImmediate();
  h.render();
  old.resolve(detail('a'));
  await setImmediate();
  h.render();
  assert.equal(h.one('h2').children, 'b');
  const more = h.one('Button', (p) =>
    Array.isArray(p.children)
      ? p.children.includes('Carregar mais condições')
      : p.children === 'Carregar mais condições',
  );
  more.onClick();
  assert.equal(h.requests.length, 3);
  h.one('CabecalhoOrdenavel').onAlternar(5);
  h.render();
  await setImmediate();
  assert.equal(h.requests[2].options.signal.aborted, true);
  h.requests[3].resolve(detail('b', [{ id: 'b2', item: 'Ordenado' }]));
  await setImmediate();
  h.render();
  h.requests[2].resolve(
    detail('b', [{ id: 'antiga', item: 'Página antiga' }], 2),
  );
  await setImmediate();
  h.render();
  assert.equal(h.find((n) => n.props?.children === 'Página antiga').length, 0);
  assert.equal(h.find((n) => n.props?.children === 'Ordenado').length, 1);
});

void test('limpar filtros cancela pesquisa e erro antigo nao reaparece', async (t) => {
  const props = { catalogs, filters: filtros.filtrosVazios(), setFilters() {} };
  const h = await mount('portal-search', 'SearchPage', props);
  t.after(() => h.unmount());
  const search = h.one('Button', (p) => p.size === 'lg').onClick();
  const request = h.requests[0];
  h.one('Button', (p) => p.variant === 'ghost').onClick();
  h.render();
  assert.equal(request.options.signal.aborted, true);
  request.reject(new Error('Falha antiga'));
  await search;
  h.render();
  assert.equal(h.find((n) => n.props?.children === 'Falha antiga').length, 0);
  assert.equal(h.one('Empty').title, 'Monte sua pesquisa');
});

void test('pesquisa nova prevalece mesmo se a anterior ignorar cancelamento', async (t) => {
  const h = await mount('portal-search', 'SearchPage', {
    catalogs,
    filters: filtros.filtrosVazios(),
  });
  t.after(() => h.unmount());
  const search = h.one('Button', (p) => p.size === 'lg').onClick;
  const first = search(),
    second = search();
  h.requests[1].resolve({
    rows: [{ id: 'novo', item: 'Resultado novo' }],
    total: 1,
  });
  await second;
  h.requests[0].resolve({
    rows: [{ id: 'velho', item: 'Resultado antigo' }],
    total: 1,
  });
  await first;
  h.render();
  assert.equal(h.find((n) => n.props?.children === 'Resultado novo').length, 1);
  assert.equal(
    h.find((n) => n.props?.children === 'Resultado antigo').length,
    0,
  );
});

void test('historico de importacao fecha durante leitura, trata falha e permite tentar novamente', async (t) => {
  const h = await mount('import-history', 'ImportHistory', {
    rows: [{ id: 'i', filename: 'ficticio.xlsx' }],
  });
  t.after(() => h.unmount());
  h.one('button').onClick();
  h.render();
  h.one('Dialog').onOpenChange(false);
  h.render();
  h.requests[0].resolve({ filename: 'Não deve reabrir' });
  await setImmediate();
  h.render();
  assert.equal(h.one('Dialog').open, false);
  h.one('button').onClick();
  h.requests[1].reject(new Error('Falha fictícia'));
  await setImmediate();
  h.render();
  assert.equal(h.one('Dialog').open, true);
  assert.equal(h.find((n) => n.props?.children === 'Falha fictícia').length, 1);
  h.one('Button', (p) => p.children === 'Tentar novamente').onClick();
  h.requests[2].resolve({ filename: 'ficticio.xlsx', totalRows: 1 });
  await setImmediate();
  h.render();
  assert.equal(h.one('DialogTitle').children, 'ficticio.xlsx');
});

void test('cadastro bloqueia envio e fechamento; conflito preserva rascunho e revisao', async () => {
  const saved = [];
  let closed = 0;
  const props = {
    open: true,
    value: { id: 'i', type: 'items', name: 'Original', expectedRevision: 7 },
    busy: false,
    onSave: (form) => saved.push(form),
    onClose: () => closed++,
  };
  const h = await mount('portal-catalogs', 'CatalogDialog', props);
  h.one('Input').onChange({ target: { value: 'Rascunho fictício' } });
  h.render();
  h.one('Button', (p) => p.children?.includes('Salvar')).onClick();
  h.render({
    ...props,
    busy: true,
    value: { ...props.value, expectedRevision: 8 },
  });
  assert.equal(h.one('fieldset').disabled, true);
  h.one('Dialog').onOpenChange(false);
  h.one('Button', (p) => p.children?.includes('Salvar')).onClick();
  assert.equal(saved.length, 1);
  assert.equal(closed, 0);
  h.render({ ...props, busy: false });
  assert.equal(h.one('Input').value, 'Rascunho fictício');
  h.one('Button', (p) => p.children?.includes('Salvar')).onClick();
  assert.equal(saved[1].expectedRevision, 7);
});

void test('dialogos de acordo e condicao bloqueiam seletores e preservam rascunho em conflito', async () => {
  for (const { name, value, input } of [
    {
      name: 'AgreementDialog',
      value: {
        number: 'Acordo fictício',
        supplierId: 'f',
        startDate: '2026-10-20',
        locationIds: ['l'],
      },
      input: (p) => p.maxLength === 80,
    },
    {
      name: 'ItemDialog',
      value: {
        id: 'i',
        catalogItemId: 'p',
        locationId: 'l',
        unitId: 'u',
        modelId: 'm',
        price: '10.50',
        locationIds: ['l'],
      },
      input: (p) => p.type === 'number',
    },
  ]) {
    const saved = [];
    let closed = 0;
    const props = {
      open: true,
      value: { ...value, expectedRevision: 3 },
      catalogs,
      busy: false,
      onSave: (body) => saved.push(body),
      onClose: () => closed++,
    };
    const h = await mount('agreement-dialogs', name, props);
    const draft = name === 'ItemDialog' ? '12.34' : 'Acordo rascunho fictício';
    h.one('Input', input).onChange({ target: { value: draft } });
    h.render();
    h.one('form').onSubmit({ preventDefault() {} });
    h.render({
      ...props,
      busy: true,
      value: { ...props.value, expectedRevision: 4 },
    });
    assert.equal(h.one('fieldset').disabled, true);
    assert.ok(
      h
        .find((n) => n.type === 'SearchSelect')
        .every((n) => n.props.disabled === true),
    );
    h.one('Dialog').onOpenChange(false);
    h.one('form').onSubmit({ preventDefault() {} });
    assert.equal(saved.length, 1);
    assert.equal(closed, 0);
    h.render(props);
    assert.equal(h.one('Input', input).value, draft);
    h.one('form').onSubmit({ preventDefault() {} });
    assert.equal(saved[1].expectedRevision, 3);
  }
});

void test('De/Para nao reenvia durante salvamento e preserva revisao apos conflito', async (t) => {
  const errors = [];
  const run = async (fn) => {
    try {
      await fn();
    } catch (error) {
      errors.push(error);
    }
  };
  const h = await mount('portal-mappings', 'Mappings', { catalogs, run });
  t.after(() => h.unmount());
  await setImmediate();
  h.requests[0].resolve({
    items: [
      {
        id: 'i',
        source: 'Original fictício',
        sourceKey: 'ORIGINAL FICTICIO',
        targetId: 'alvo',
        target: 'Item fictício',
        active: 1,
        revision: 4,
      },
    ],
  });
  await setImmediate();
  h.render();
  h.one(
    'Button',
    (p) => p['aria-label'] === 'Editar correspondência',
  ).onClick();
  h.render();
  const dialog = h.find(
    (n) => typeof n.type === 'function' && n.type.name === 'MappingDialog',
  )[0].props;
  const body = { ...dialog.value, source: 'Rascunho fictício' };
  const first = dialog.onSave(body),
    second = dialog.onSave(body);
  h.render();
  assert.equal(h.requests.length, 2);
  assert.equal(
    h.find(
      (n) => typeof n.type === 'function' && n.type.name === 'MappingDialog',
    )[0].props.busy,
    true,
  );
  assert.equal(JSON.parse(h.requests[1].options.body).expectedRevision, 4);
  h.requests[1].reject(new ApiError({ error: 'Conflito fictício' }));
  await Promise.all([first, second]);
  h.render();
  const preserved = h.find(
    (n) => typeof n.type === 'function' && n.type.name === 'MappingDialog',
  )[0].props;
  assert.equal(preserved.value.expectedRevision, 4);
  assert.equal(preserved.busy, false);
  assert.equal(errors.length, 1);
});

void test('historico agrupa digitacao e ignora leitura antiga apos trocar filtro', async (t) => {
  const h = await mount(
    'portal-history',
    'ChangeHistory',
    { users: [] },
    {
      '@/lib/historico-legivel': {
        rotuloAcaoHistorico: String,
        rotuloEntidadeHistorico: String,
      },
    },
  );
  t.after(() => h.unmount());
  for (const value of ['F', 'Fi', 'Fictício']) {
    h.one('Input', (p) => p.placeholder).onChange({ target: { value } });
    h.render();
  }
  assert.equal(h.requests.length, 0);
  await setTimeout(300);
  assert.equal(h.requests.length, 1);
  assert.equal(
    new URL(h.requests[0].path, 'http://portal.test').searchParams.get('q'),
    'Fictício',
  );
  h.one('Input', (p) => p.placeholder).onChange({
    target: { value: 'Novo fictício' },
  });
  h.render();
  assert.equal(h.requests[0].options.signal.aborted, true);
  await setTimeout(300);
  h.requests[1].resolve({
    logs: [{ id: 'n', details: 'Histórico novo' }],
    page: 1,
    pageCount: 1,
  });
  await setImmediate();
  h.requests[0].resolve({
    logs: [{ id: 'a', details: 'Histórico antigo' }],
    page: 1,
    pageCount: 1,
  });
  await setImmediate();
  h.render();
  assert.equal(h.find((n) => n.props?.children === 'Histórico novo').length, 1);
  assert.equal(
    h.find((n) => n.props?.children === 'Histórico antigo').length,
    0,
  );
});

void test('publicacao exige previa valida e clique; clique duplicado nao reenvia', async (t) => {
  const props = {
    data: { catalogs, agreements: [], imports: [] },
    canManageMappings: true,
    onUpdated: async () => {
      throw new Error('Atualização fictícia indisponível');
    },
  };
  const h = await mount('imports', 'Imports', props);
  t.after(() => h.unmount());
  await h.one('ImportPreview').publish();
  assert.equal(h.requests.length, 0);
  h.one('SearchSelect').onChange('acordo-ficticio');
  h.one('input').onChange({
    target: { files: [new File(['fictício'], 'ficticio.xlsx')] },
  });
  h.render();
  h.one('Button', (p) => p.children?.includes('Conferir arquivo')).onClick();
  assert.match(h.requests[0].path, /\?preview=1$/);
  h.requests[0].resolve({ valid: true, preview: true, summary: { items: 1 } });
  await setImmediate();
  h.render();
  assert.equal(h.requests.length, 1);
  const publish = h.one('ImportPreview').publish;
  const first = publish(),
    second = publish();
  assert.equal(h.requests.length, 2);
  assert.doesNotMatch(h.requests[1].path, /preview/);
  h.requests[1].resolve({ summary: { items: 1 } });
  await Promise.all([first, second]);
  h.render();
  assert.equal(
    h.find((n) => n.props?.children === 'Importação publicada').length,
    1,
  );
  assert.equal(
    h.find(
      (n) =>
        typeof n.props?.children === 'string' &&
        n.props.children.startsWith('Importação publicada, mas'),
    ).length,
    1,
  );
  assert.equal(h.one('ImportPreview').result, null);
});

void test('previa fica invalida quando os cadastros mudam e De/Para exige permissao', async (t) => {
  const props = {
    data: { catalogs, agreements: [], imports: [] },
    canManageMappings: false,
  };
  const h = await mount('imports', 'Imports', props);
  t.after(() => h.unmount());
  await h
    .one('ImportPreview')
    .onSave({ tipo: 'items', valor: 'Fictício' }, 'i');
  assert.equal(h.requests.length, 0);
  h.one('SearchSelect').onChange('acordo-ficticio');
  h.one('input').onChange({
    target: { files: [new File(['fictício'], 'ficticio.xlsx')] },
  });
  h.render();
  h.one('Button', (p) => p.children?.includes('Conferir arquivo')).onClick();
  h.requests[0].resolve({ valid: true, summary: { items: 1 } });
  await setImmediate();
  h.render({ ...props, data: { ...props.data, catalogs: { ...catalogs } } });
  assert.equal(h.one('ImportPreview').ready, false);
  await h.one('ImportPreview').publish();
  assert.equal(h.requests.length, 1);
});

void test('textos de planilhas e erros permanecem escapados pelo React', async () => {
  const text = '<img src=x onerror="alert(1)">';
  const h = await mount('import-errors', 'ListaErros', {
    resumo: { outrosErros: [{ linha: 2, erro: text }] },
  });
  const html = renderToStaticMarkup(h.render());
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  for (const file of [
    'portal-agreements',
    'agreement-dialogs',
    'portal-catalogs',
    'portal-history',
    'portal-mappings',
    'portal-search',
    'search-select',
    'search-multi-select',
    'imports',
    'import-preview',
    'import-summary',
    'import-errors',
    'import-history',
    'import-mappings',
  ]) {
    assert.doesNotMatch(
      fs.readFileSync(
        new URL(`../components/${file}.tsx`, import.meta.url),
        'utf8',
      ),
      /dangerouslySetInnerHTML/,
    );
  }
});
