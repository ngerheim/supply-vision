import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { mount } from './apoio/telas.mjs';
import { ApiError } from '../lib/api.ts';
import * as baixas from '../lib/baixas.ts';
import * as permissoes from '../lib/permissoes.ts';
import * as cliente from '../lib/solicitacoes-cliente.ts';
import { gerarChaveRelatorio } from '../lib/relatorios.ts';

const modules = {
  '@/lib/baixas': baixas,
  '@/lib/permissoes': permissoes,
  '@/lib/solicitacoes-cliente': cliente,
  '@/lib/relatorios': {
    gerarChaveRelatorio: () =>
      gerarChaveRelatorio({
        getRandomValues: crypto.getRandomValues.bind(crypto),
      }),
  },
};
const estoque = { id: 'e', nome: 'Estoque fictício', ativo: 1, revision: 2 };
const baixa = {
  id: 'b',
  codigo: 'BX-8',
  numero_os: '77',
  placa: 'FIC1234',
  estoque: 'Estoque fictício',
  estoque_id: 'e',
  status: 'aberta',
  solicitante: 'Pessoa fictícia',
  revision: 3,
  atualizado_em: '2026-10-25T12:00:00Z',
};
const flush = async (h) => {
  await setImmediate();
  h.render();
};
const textoVisivel = (children) => {
  if (Array.isArray(children)) return children.map(textoVisivel).join('');
  if (typeof children === 'string' || typeof children === 'number')
    return String(children);
  return children && typeof children === 'object'
    ? textoVisivel(children.props?.children ?? '')
    : '';
};
const button = (h, nome) =>
  h.one('Button', (p) => textoVisivel(p.children).trim() === nome);
const change = (h, nome, value, tipo = 'Input') => {
  h.one(tipo, (p) => p.name === nome).onChange({ target: { value } });
  h.render();
};
const alerts = (h) =>
  h
    .find((n) => n.props?.role === 'alert')
    .map((n) => n.props.children)
    .join(' ');
const submit = (h) => h.one('form').onSubmit({ preventDefault() {} });
const body = (r) => JSON.parse(r.options.body);
const abrir = async (t, nome, props) => {
  const h = await mount('portal-baixas', nome, props, modules, { crypto });
  t.after(() => h.unmount());
  return h;
};

for (const role of ['viewer', 'editor', 'admin'])
  void test(`lista de baixas ${role}: colunas, filtros, pagina e links`, async (t) => {
    const opened = [],
      h = await abrir(t, 'ListaBaixas', {
        user: { role },
        onNew() {},
        onOpen: (id) => opened.push(id),
      });
    h.requests
      .find((r) => r.path === '/api/estoques')
      .resolve({ estoques: [estoque] });
    h.requests
      .find((r) => r.path.startsWith('/api/baixas?'))
      .resolve({ baixas: [baixa], page: 1, pageCount: 2 });
    await flush(h);
    const colunas = h
      .find((n) => n.type === 'TableHead')
      .map((n) => n.props.children);
    assert.equal(colunas.includes('Solicitante'), role !== 'viewer');
    assert.ok(colunas.includes('Nº da OS'));
    assert.equal(h.find((n) => n.type === 'h2').length, 0);
    button(h, 'Nova baixa');
    assert.ok(
      h
        .find((n) => n.type === 'TableCell')
        .some((n) => n.props.children === 'FIC-1234'),
    );
    const link = h.one('a');
    assert.equal(link.href, '/?aba=chamados&baixa=b');
    link.onClick({ button: 0, preventDefault() {} });
    assert.deepEqual(opened, ['b']);
    change(h, 'status', 'recusada', 'select');
    change(h, 'estoque', 'e', 'select');
    change(h, 'de', '2026-10-25');
    change(h, 'ate', '2026-10-26');
    const params = new URL(h.requests.at(-1).path, 'http://fixture')
      .searchParams;
    assert.equal(params.get('status'), 'recusada');
    assert.equal(params.get('estoque'), 'e');
    assert.equal(params.get('de'), '2026-10-25');
    assert.equal(params.get('ate'), '2026-10-26');
  });
void test('nova baixa valida placa enquanto digita, restringe OS, usa ativos e mostra duplicada', async (t) => {
  const opened = [],
    h = await abrir(t, 'FormularioBaixa', {
      onCancel() {},
      onOpen: (id) => opened.push(id),
    });
  h.requests[0].resolve({
    estoques: [estoque, { id: 'inativo', nome: 'Inativo', ativo: 0 }],
  });
  h.requests.find(r=>r.path.startsWith('/api/catalogs/items?')).resolve({itens:[{id:'item-filtro',descricao:'Filtro fictício',unidade:'un',ativo:1}]});
  await flush(h);
  assert.equal(
    h.find((n) => n.type === 'option' && n.props.value === 'inativo').length,
    0,
  );
  change(h, 'numero_os', 'OS-123abc');
  assert.equal(h.one('Input', (p) => p.name === 'numero_os').value, '123');
  change(h, 'placa', 'fic1');
  assert.equal(h.one('Input', (p) => p.name === 'placa')['aria-invalid'], true);
  assert.match(alerts(h), /placa válida/);
  change(h, 'placa', 'fic-1234');
  assert.equal(
    h.one('Input', (p) => p.name === 'placa')['aria-invalid'],
    false,
  );
  change(h, 'estoque_id', 'e', 'select');
  h.one('select',p=>p['aria-label']==='Item do catálogo').onChange({target:{value:'item-filtro'}});h.render();
  button(h,'Adicionar item').onClick();h.render();
  h.one('Input',p=>p['aria-label']==='Quantidade Filtro fictício').onChange({target:{value:'2'}});h.render();
  submit(h);
  const tentativa = h.requests.at(-1);
  submit(h);
  assert.equal(h.requests.at(-1), tentativa);
  assert.deepEqual(body(tentativa), {
    numero_os: '123',
    placa: 'FIC1234',
    estoque_id: 'e',
    itens:[{itemId:'item-filtro',quantidade:2}],
  });
  assert.ok(tentativa.options.headers['idempotency-key']);
  tentativa.reject(
    new ApiError({
      status: 409,
      error: 'Já existe BX-4',
      existente: { id: 'existente', codigo: 'BX-4', status: 'aberta' },
    }),
  );
  await flush(h);
  assert.match(alerts(h), /BX-4/);
  const link = h.one('a');
  assert.equal(link.href, '/?aba=chamados&baixa=existente');
  link.onClick({ button: 0, preventDefault() {} });
  assert.deepEqual(opened, ['existente']);
  submit(h);
  const repetida = h.requests.at(-1);
  assert.equal(
    repetida.options.headers['idempotency-key'],
    tentativa.options.headers['idempotency-key'],
  );
  repetida.resolve({ id: 'criada' });
  await flush(h);
  assert.deepEqual(opened, ['existente', 'criada']);
});
for (const role of ['viewer', 'editor', 'admin'])
  for (const status of ['aberta', 'baixada', 'recusada'])
    void test(`detalhe ${role}/${status}: acoes conforme pode e situacao`, async (t) => {
      const h = await abrir(t, 'DetalheBaixa', {
        id: 'b',
        user: { role },
        onBack() {},
      });
      h.requests[0].resolve({
        baixa: {
          ...baixa,
          status,
          motivo_recusa: status === 'recusada' ? 'Motivo fictício' : null,
        },
        itens:[{id:'bi-1',item_id:'cat-1',descricao:'Filtro fictício',unidade:'un',quantidade:1,status:'pendente'}],
        andamentos: [
          {
            id: 'a',
            para_status: status,
            usuario: 'Pessoa',
            criado_em: baixa.atualizado_em,
          },
        ],
      });
      await flush(h);
      assert.equal(h.find(n=>n.type==='Button'&&n.props.children==='Baixar selecionados').length,role!=='viewer'&&status==='aberta'?1:0);
      assert.ok(
        h.find((n) => n.type === 'Info' && n.props.label === 'Placa').length,
      );
    });
void test('atendimento envia revision, recusa exige motivo, conflito bloqueia ate recarregar', async (t) => {
  const item={id:'bi-1',item_id:'cat-1',descricao:'Filtro fictício',unidade:'un',quantidade:1,status:'pendente'};
  const h = await abrir(t, 'DetalheBaixa', {
    id: 'b',
    user: { role: 'editor' },
    onBack() {},
  });
  h.requests[0].resolve({ baixa, itens:[item], andamentos: [] });
  h.requests.find(r=>r.path.startsWith('/api/catalogs/items?')).resolve({itens:[]});
  await flush(h);
  h.one('input',p=>p['aria-label']==='Selecionar Filtro fictício').onChange({target:{checked:true}});
  h.render();
  button(h,'Recusar selecionados').onClick();
  h.render();
  assert.match(alerts(h), /motivo/);
  assert.equal(h.requests.filter(r=>r.path==='/api/baixas/b').length, 1);
  h.one('Input',p=>p['aria-label']==='Motivo Filtro fictício').onChange({target:{value:'Motivo fictício'}});h.render();
  button(h,'Recusar selecionados').onClick();
  const r = h.requests.at(-1);
  assert.deepEqual(body(r), {
    expectedRevision: 3,
    itens:[{id:'bi-1',para:'recusado',motivo:'Motivo fictício'}],
  });
  r.reject(new ApiError({ status: 409, codigo: 'revisao', error: 'Alterada' }));
  await flush(h);
  assert.match(alerts(h), /recarregue/);
  assert.equal(button(h,'Baixar selecionados').disabled,true);
  h.one('Button', (p) => p['aria-label'] === 'Recarregar').onClick();
  await flush(h);
  h.requests.findLast(r=>r.path==='/api/baixas/b').resolve({ baixa: { ...baixa, revision: 4 },itens:[item], andamentos: [] });
  await flush(h);
  button(h, 'Baixar selecionados').onClick();
  const nova = h.requests.at(-1);
  assert.deepEqual(body(nova), {
    expectedRevision: 4,
    itens:[{id:'bi-1',para:'baixado',motivo:''}],
  });
  nova.resolve({});
  await flush(h);
  assert.ok(h.requests.findLast(r=>r.path==='/api/baixas/b'));
});
void test('409 que não é revisão mostra mensagem sem travar as ações', async (t) => {
  const h = await abrir(t, 'DetalheBaixa', { id: 'b', user: { role: 'editor' }, onBack() {} });
  h.requests[0].resolve({ baixa, itens:[{id:'bi-1',descricao:'Filtro fictício',unidade:'un',quantidade:1,status:'pendente'}], andamentos: [] });
  h.requests.find(r=>r.path.startsWith('/api/catalogs/items?')).resolve({itens:[]});
  await flush(h);
  h.one('input',p=>p['aria-label']==='Selecionar Filtro fictício').onChange({target:{checked:true}});h.render();
  button(h, 'Baixar selecionados').onClick();
  h.requests.at(-1).reject(new ApiError({ status: 409, codigo: 'duplicado', error: 'Já existe um registro.' }));
  await flush(h);
  assert.equal(alerts(h), 'Já existe um registro.');
  assert.notEqual(button(h, 'Baixar selecionados').disabled, true);
});
void test('detalhe seleciona itens para atendimento em lote e permite editar pendentes',async t=>{
  const item={id:'bi-1',item_id:'cat-1',descricao:'Filtro fictício',unidade:'un',quantidade:2,status:'pendente'},h=await abrir(t,'DetalheBaixa',{id:'b',user:{id:'viewer',role:'viewer'},onBack(){}});
  h.requests.find(r=>r.path==='/api/baixas/b').resolve({baixa:{...baixa,solicitante_id:'viewer'},itens:[item],andamentos:[]});
  h.requests.find(r=>r.path.startsWith('/api/catalogs/items?')).resolve({itens:[{id:'cat-2',descricao:'Óleo fictício',unidade:'L',ativo:1}]});await flush(h);
  h.one('Input',p=>p['aria-label']==='Quantidade Filtro fictício').onChange({target:{value:'3'}});h.render();
  h.one('select',p=>p['aria-label']==='Adicionar item do catálogo').onChange({target:{value:'cat-2'}});h.render();button(h,'Adicionar item').onClick();h.render();
  h.one('Input',p=>p['aria-label']==='Quantidade adicionada Óleo fictício').onChange({target:{value:'2.5'}});h.render();button(h,'Salvar itens pendentes').onClick();
  const edit=h.requests.at(-1);assert.equal(edit.path,'/api/baixas/b/itens');assert.deepEqual(body(edit),{expectedRevision:3,itens:[{itemId:'cat-1',quantidade:3},{itemId:'cat-2',quantidade:2.5}]});edit.resolve({});await flush(h);
  const a=await abrir(t,'DetalheBaixa',{id:'b',user:{role:'editor'},onBack(){}});
  a.requests.find(r=>r.path==='/api/baixas/b').resolve({baixa, itens:[item],andamentos:[]});a.requests.find(r=>r.path.startsWith('/api/catalogs/items?')).resolve({itens:[]});await flush(a);
  a.one('input',p=>p['aria-label']==='Selecionar Filtro fictício').onChange({target:{checked:true}});a.render();button(a,'Baixar selecionados').onClick();
  const atender=a.requests.at(-1);assert.equal(atender.path,'/api/baixas/b/atender-itens');assert.deepEqual(body(atender),{expectedRevision:3,itens:[{id:'bi-1',para:'baixado',motivo:''}]});atender.resolve({});await flush(a);
});
void test('falha de leitura e 404 nao exibem dados nem acoes', async (t) => {
  const h = await abrir(t, 'DetalheBaixa', {
    id: 'b',
    user: { role: 'viewer' },
    onBack() {},
  });
  h.requests[0].reject(
    new ApiError({ status: 404, error: 'Baixa não encontrada.' }),
  );
  await flush(h);
  assert.equal(h.one('FalhaDeCarregamento').erro, 'Baixa não encontrada.');
  assert.equal(h.find((n) => n.type === 'Info').length, 0);
});
void test('estoques inclui, renomeia e alterna ativo com revision e erro 409', async (t) => {
  const h = await mount('portal-estoques', 'Estoques', {}, modules);
  t.after(() => h.unmount());
  h.requests[0].resolve({ estoques: [estoque] });
  await flush(h);
  change(h, 'nome', 'Novo fictício');
  submit(h);
  let r = h.requests.at(-1);
  assert.equal(r.path, '/api/estoques');
  assert.equal(r.options.method, 'POST');
  r.resolve({ id: 'novo' });
  await flush(h);
  h.requests.at(-1).resolve({ estoques: [estoque] });
  await flush(h);
  button(h, `Renomear ${estoque.nome}`).onClick();
  h.render();
  change(h, 'nome', 'Renomeado');
  submit(h);
  r = h.requests.at(-1);
  assert.equal(body(r).expectedRevision, 2);
  r.reject(new ApiError({ status: 409, error: 'Este registro foi alterado.' }));
  await flush(h);
  assert.match(alerts(h), /recarregue/);
  button(h, 'Cancelar').onClick();
  h.render();
  button(h, `Desativar ${estoque.nome}`).onClick();
  r = h.requests.at(-1);
  assert.deepEqual(body(r), { ativo: false, expectedRevision: 2 });
  r.resolve({});
  await flush(h);
  h.requests
    .at(-1)
    .resolve({ estoques: [{ ...estoque, ativo: 0, revision: 3 }] });
  await flush(h);
  button(h, `Ativar ${estoque.nome}`).onClick();
  assert.deepEqual(body(h.requests.at(-1)), {
    ativo: true,
    expectedRevision: 3,
  });
});
void test('entrada e saldo de estoque listam, filtram, validam e registram entradas',async t=>{
  const h=await mount('portal-estoques','EntradaEstoque',{},modules,{crypto});t.after(()=>h.unmount());
  h.requests.find(r=>r.path==='/api/estoques').resolve({estoques:[estoque]});h.requests.find(r=>r.path.startsWith('/api/estoque/entradas?')).resolve({entradas:[{origem_id:'orig',data_movimento:'2026-10-27',estoque:'Estoque fictício',documento:'NF-1',itens:1,usuario:'Pessoa fictícia',observacao:'Nota'}],total:1});await flush(h);
  assert.ok(h.find(n=>n.type==='TableHead').some(n=>n.props.children==='Registrado por'));assert.ok(h.find(n=>n.type==='TableCell').some(n=>n.props.children==='NF-1'));
  h.one('Input',p=>p['aria-label']==='Buscar entradas').onChange({target:{value:'Filtro'}});h.render();assert.match(h.requests.at(-1).path,/q=Filtro/);
  button(h,'Nova entrada').onClick();h.render();
  h.one('Input',p=>p['aria-label']==='Buscar item no catálogo').onChange({target:{value:'Óleo'}});h.render();await new Promise(resolve=>setTimeout(resolve,200));await flush(h);
  const pesquisa=h.requests.at(-1);assert.match(pesquisa.path,/catalogs\/items\?q=/);pesquisa.resolve({itens:[{id:'itm',descricao:'Óleo fictício',unidade:'L',ativo:1}]});await flush(h);
  h.one('button',p=>textoVisivel(p.children).includes('Óleo fictício')).onClick();h.render();
  h.one('form').onSubmit({preventDefault(){}});h.render();assert.match(alerts(h),/quantidades maiores que zero/);h.one('Button',p=>p['aria-label']==='Remover linha 1').onClick();h.render();

  h.one('NativeSelect',p=>p['aria-label']==='Estoque da entrada').onChange({target:{value:'e'}});h.render();h.one('Input',p=>p['aria-label']==='Quantidade da linha 1').onChange({target:{value:'1.25'}});h.render();submit(h);
  const envio=h.requests.at(-1);assert.equal(envio.path,'/api/estoque/entradas');assert.deepEqual(body(envio).itens,[{itemId:'itm',quantidade:1.25}]);assert.ok(envio.options.headers['idempotency-key']);envio.resolve({});await flush(h);assert.equal(h.find(n=>n.type==='dialog').length,0);
  const saldo=await mount('portal-estoques','SaldoEstoque',{user:{role:'admin'}},modules);t.after(()=>saldo.unmount());
  saldo.requests.find(r=>r.path==='/api/estoques').resolve({estoques:[estoque]});saldo.requests.find(r=>r.path.startsWith('/api/estoque/saldos')).resolve({saldos:[{estoque_id:'e',estoque:'Estoque fictício',item_id:'itm',descricao:'Óleo fictício',unidade:'L',saldo:-0.25}]});await flush(saldo);
  assert.ok(saldo.find(n=>n.type==='TableCell').some(n=>n.props.children===-0.25));
  saldo.one('Input',p=>p['aria-label']==='Buscar item').onChange({target:{value:'Óleo'}});saldo.render();saldo.requests.at(-1).resolve({saldos:[{estoque_id:'e',estoque:'Estoque fictício',item_id:'itm',descricao:'Óleo fictício',unidade:'L',saldo:2}]});await flush(saldo);
  saldo.one('TableRow',p=>typeof p.onClick==='function').onClick();saldo.render();
  saldo.requests.at(-1).resolve({movimentos:[{id:'m',tipo:'saida',quantidade:-1,unidade:'L',data_movimento:'2026-10-27',baixa_id:'b',baixa_codigo:'BX-8'}]});await flush(saldo);
  assert.equal(saldo.one('a').href,'/?aba=chamados&baixa=b');assert.equal(saldo.one('a').children,'BX-8');
});
