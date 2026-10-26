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
const button = (h, nome) =>
  h.one(
    'Button',
    (p) =>
      (Array.isArray(p.children) ? p.children.join('') : p.children) === nome,
  );
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
  submit(h);
  const tentativa = h.requests.at(-1);
  submit(h);
  assert.equal(h.requests.at(-1), tentativa);
  assert.deepEqual(body(tentativa), {
    numero_os: '123',
    placa: 'FIC1234',
    estoque_id: 'e',
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
      assert.equal(
        h.find(
          (n) =>
            n.type === 'Button' && n.props.children === 'Marcar como baixada',
        ).length,
        role !== 'viewer' && status === 'aberta' ? 1 : 0,
      );
      assert.ok(
        h.find((n) => n.type === 'Info' && n.props.label === 'Placa').length,
      );
    });
void test('atendimento envia revision, recusa exige motivo, conflito bloqueia ate recarregar', async (t) => {
  const h = await abrir(t, 'DetalheBaixa', {
    id: 'b',
    user: { role: 'editor' },
    onBack() {},
  });
  h.requests[0].resolve({ baixa, andamentos: [] });
  await flush(h);
  button(h, 'Recusar').onClick();
  h.render();
  submit(h);
  h.render();
  assert.match(alerts(h), /motivo/);
  assert.equal(h.requests.length, 1);
  change(h, 'motivo_recusa', 'Motivo fictício', 'Textarea');
  submit(h);
  const r = h.requests.at(-1);
  assert.deepEqual(body(r), {
    para: 'recusada',
    texto: 'Motivo fictício',
    expectedRevision: 3,
  });
  r.reject(new ApiError({ status: 409, error: 'Alterada' }));
  await flush(h);
  assert.match(alerts(h), /recarregue/);
  assert.equal(h.one('fieldset').disabled, true);
  button(h, 'Recarregar').onClick();
  await flush(h);
  h.requests
    .at(-1)
    .resolve({ baixa: { ...baixa, revision: 4 }, andamentos: [] });
  await flush(h);
  button(h, 'Marcar como baixada').onClick();
  const nova = h.requests.at(-1);
  assert.deepEqual(body(nova), {
    para: 'baixada',
    texto: '',
    expectedRevision: 4,
  });
  nova.resolve({});
  await flush(h);
  assert.ok(h.requests.at(-1).path.endsWith('/b'));
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
