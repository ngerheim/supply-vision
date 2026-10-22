import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from '../lib/api.ts';
import * as filtros from '../lib/filtros-busca.ts';

import { mount } from './apoio/telas.mjs';

void test('Central: sino 99+, lista acessivel, marcacao antes da navegacao e clique duplicado bloqueado', async t => {
  const estado = {usuario:'pessoa',naoLidas:103}, navegacoes = [];
  const tela = await mount('central-notificacoes','CentralNotificacoes',{navegar:link => navegacoes.push(link)},{
    '@/lib/central-estado': {
      obterCentral:() => estado, centralInicial:() => estado, assinarCentral:() => () => {},
      atualizarContagemCentral:(_usuario,n) => { estado.naoLidas=n; },
    },
  });
  t.after(() => tela.unmount());
  assert.equal(tela.requests.length,0,'O sino nao cria outro polling');
  const sino = tela.one('button',p => p['aria-controls']==='central-notificacoes');
  assert.equal(sino['aria-label'],'Notificações: 103 não lidas');
  assert.equal(tela.one('span').children,'99+');
  sino.onClick(); tela.render();
  assert.equal(tela.requests[0].path,'/api/central');
  tela.requests[0].resolve({notificacoes:[{id:'n',tipo:'teste',texto:'Texto ficticio',link:'/?chamado=t',criada_em:'2026-10-22T12:00:00Z',lida_em:null}]});
  await setImmediate(); tela.render();
  assert.equal(tela.one('dialog')['aria-label'],'Central de notificações');
  assert.equal(tela.one('time').dateTime,'2026-10-22T12:00:00Z');
  const item = tela.one('a');
  const clique = () => item.onClick({button:0,preventDefault(){}});
  clique(); clique(); tela.render();
  assert.equal(tela.requests.length,2);
  assert.equal(tela.requests[1].path,'/api/central/n/lida');
  assert.equal(tela.requests[1].options.method,'POST');
  assert.deepEqual(navegacoes,[]);
  tela.requests[1].resolve({success:true}); await setImmediate();
  assert.equal(tela.requests[2].path,'/api/central/nao-lidas');
  tela.requests[2].resolve({naoLidas:102}); await setImmediate(); tela.render();
  assert.deepEqual(navegacoes,['/?chamado=t']);
  assert.equal(estado.naoLidas,102);
  assert.equal(tela.find(n => n.type==='dialog').length,0);
});

void test('Central: marcar todas atualiza lista, erro permanece acessivel e Escape fecha painel', async t => {
  const estado = {usuario:'pessoa',naoLidas:2};
  const tela = await mount('central-notificacoes','CentralNotificacoes',{navegar(){}},{
    '@/lib/central-estado': {
      obterCentral:() => estado, centralInicial:() => estado, assinarCentral:() => () => {},
      atualizarContagemCentral:(_usuario,n) => { estado.naoLidas=n; },
    },
  });
  t.after(() => tela.unmount());
  tela.one('button',p => p['aria-controls']).onClick(); tela.render();
  tela.requests[0].resolve({notificacoes:[{id:'n',texto:'Texto',link:'/',criada_em:'2026-10-22T12:00:00Z',lida_em:null}]});
  await setImmediate(); tela.render();
  tela.one('button',p => p.children==='Marcar todas como lidas').onClick(); tela.render();
  assert.equal(tela.requests[1].path,'/api/central/lidas');
  tela.requests[1].reject(new Error('Falha ficticia')); await setImmediate(); tela.render();
  assert.equal(tela.one('p',p => p.role==='alert').children,'Falha ficticia');
  tela.one('button',p => p.children==='Marcar todas como lidas').onClick();
  tela.requests[2].resolve({success:true}); await setImmediate();
  tela.requests[3].resolve({naoLidas:0}); await setImmediate(); tela.render();
  assert.equal(tela.one('button',p => p.children==='Marcar todas como lidas').disabled,true);
  assert.equal(tela.find(n => n.type==='span' && String(n.props.children).includes('Não lida')).length,0);
  tela.one('dialog').onKeyDown({key:'Escape',preventDefault(){}}); tela.render();
  assert.equal(tela.find(n => n.type==='dialog').length,0);
});

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

void test('acordo recarrega ao mudar revisao entre paginas da mesma versao', async t => {
  const h = await mount('portal-agreements', 'AgreementDetail', { id: 'a', revision: 1, canWrite: false });
  t.after(() => h.unmount());
  await setImmediate();
  h.requests[0].resolve({ ...detail('a', [{ id: 'i1', item: 'Antes' }], 2), revision: 1 });
  await setImmediate(); h.render();
  h.one('Button', p => Array.isArray(p.children) ? p.children.includes('Carregar mais condições') : p.children === 'Carregar mais condições').onClick();
  h.requests[1].resolve({ ...detail('a', [{ id: 'i2', item: 'Depois' }], 2), revision: 2 });
  await setImmediate(); h.render();
  assert.equal(h.requests.length, 3, 'Deve descartar paginas e recarregar do inicio');
  assert.doesNotMatch(h.requests[2].path, /offset=/);
  h.requests[2].resolve({ ...detail('a', [{ id: 'i1', item: 'Atual' }], 2), revision: 2 });
  await setImmediate(); h.render();
  assert.equal(h.find(n => n.props?.children === 'Antes').length, 0);
});

for (const origem of ['edicao de item', 'importacao']) {
  void test(`cabecalho usa revisao atualizada pela API apos ${origem}, sem remontar tela`, async t => {
    let formulario;
    const props = {id: 'a', revision: {}, canWrite: true, onEdit: a => { formulario = a; }};
    const h = await mount('portal-agreements', 'AgreementDetail', props);
    t.after(() => h.unmount());
    const resposta = revision => ({...detail('a'), revision, agreement: {...detail('a').agreement, revision}});
    await setImmediate(); h.requests[0].resolve(resposta(2));
    await setImmediate(); h.render();
    h.render({...props, busy: true});
    assert.equal(h.one('Button', p => p.children?.includes?.(' Editar acordo')).disabled, true, 'Escrita e bootstrap em curso bloqueiam abrir o cabecalho');
    h.render({...props, revision: {atualizado: origem}});
    await setImmediate(); h.render();
    assert.equal(h.find(n => n.type === 'Button' && n.props.children?.includes?.(' Editar acordo')).length, 0, 'Nao pode editar cabecalho com o detalhe anterior enquanto a API atualiza');
    h.requests[1].resolve(resposta(5));
    await setImmediate(); h.render();
    h.one('Button', p => p.children?.includes?.(' Editar acordo')).onClick();
    assert.equal(formulario.revision, 5);
  });
}

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
  h.requests[0].resolve({ valid: true, preview: true, agreementRevision: 7, planFingerprint: 'a'.repeat(64), summary: { items: 1 } });
  await setImmediate();
  h.render();
  assert.equal(h.requests.length, 1);
  const publish = h.one('ImportPreview').publish;
  const first = publish(),
    second = publish();
  assert.equal(h.requests.length, 2);
  assert.doesNotMatch(h.requests[1].path, /preview/);
  assert.equal(h.requests[1].options.body.get('expectedRevision'), '7');
  assert.equal(h.requests[1].options.body.get('expectedPlanFingerprint'), 'a'.repeat(64));
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
