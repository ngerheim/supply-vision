import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { mount } from './apoio/telas.mjs';
import { ApiError } from '../lib/api.ts';
import * as cliente from '../lib/solicitacoes-cliente.ts';
import * as permissoes from '../lib/permissoes.ts';
import { cnpjFicticio } from '../lib/consultas-fornecedor-ensaio.ts';

const modules = {
  '@/lib/solicitacoes-cliente': cliente,
  '@/lib/permissoes': permissoes,
};
const user = (role) => ({ id: 'pessoa', role });
const categorias = [
  { id: 'oficina', nome: 'Oficina', ativo: 1, revision: 3 },
  { id: 'antiga', nome: 'Antiga', ativo: 0, revision: 1 },
];
const receita = {
  cnpj: cnpjFicticio(600),
  razao_social: 'Fornecedor fictício',
  nome_fantasia: 'Fantasia',
  situacao_cadastral: 'ATIVA',
  cnae_codigo: '4520001',
  cnae_descricao: 'Atividade fictícia',
  cep: '00000000',
  cidade: 'Cidade fictícia',
  uf: 'SP',
  consultaId: 'consulta-ficticia',
};
const flush = async (h) => {
  await setImmediate();
  h.render();
};
const button = (h, label) =>
  h.one(
    'Button',
    (p) =>
      (Array.isArray(p.children) ? p.children.join('') : p.children) === label,
  );
const input = (h, name) => h.one('Input', (p) => p.name === name);
const change = (h, name, value) => {
  input(h, name).onChange({ target: { value } });
  h.render();
};
const submit = (h) => h.one('form').onSubmit({ preventDefault() {} });
const body = (r) => JSON.parse(r.options.body);
const textos = (h) =>
  h
    .find((n) => n.props?.role === 'alert')
    .map((n) => n.props.children)
    .flat()
    .join(' ');
async function abrirForm(t, props = {}) {
  const saved = [],
    opened = [];
  const h = await mount(
    'portal-solicitacao-formulario',
    'FormularioSolicitacao',
    {
      onCancel() {},
      onSaved: (id) => saved.push(id),
      onOpen: (id) => opened.push(id),
      ...props,
    },
    modules,
  );
  t.after(() => h.unmount());
  h.requests[0].resolve({ categorias });
  await flush(h);
  return { h, saved, opened };
}
async function consultar(h, resposta = receita) {
  change(h, 'cnpj', resposta.cnpj);
  button(h, 'Consultar').onClick();
  h.render();
  const req = h.requests.at(-1);
  assert.equal(req.path, `/api/solicitacoes/cnpj/${resposta.cnpj}`);
  req.resolve(resposta);
  await flush(h);
}

for (const role of ['viewer', 'editor', 'admin'])
  void test(`lista ${role}: colunas, solicitante e filtros reais`, async (t) => {
    const abertas = [];
    const h = await mount(
      'portal-solicitacoes',
      'ListaSolicitacoes',
      { user: user(role), onNew() {}, onOpen: (id) => abertas.push(id) },
      modules,
    );
    t.after(() => h.unmount());
    h.requests[0].resolve({
      solicitacoes: [
        {
          ...receita,
          id: 'sol',
          codigo: 'SOL-8',
          categorias: [categorias[0]],
          status: 'aberta',
          urgencia: 'urgente',
          nao_verificado: 1,
          solicitante: 'Pessoa fictícia',
          atualizado_em: '2026-10-22T12:00:00Z',
        },
      ],
      page: 1,
      pageCount: 2,
    });
    await flush(h);
    assert.equal(h.find((n) => n.type === 'h2').length, 0);
    assert.equal(h.one('PageHeader').title, undefined);
    assert.equal(
      h.find(
        (n) => n.type === 'TableHead' && n.props.children === 'Solicitante',
      ).length,
      role === 'viewer' ? 0 : 1,
    );
    assert.equal(h.one('Plaquinha').children, 'SOL-8');
    h.one('a').onClick({ button: 0, preventDefault() {} });
    assert.deepEqual(abertas, ['sol']);
    assert.equal(h.one('SituacaoSolicitacao').value, 'aberta');
    const selects = h.find((n) => n.type === 'select');
    selects[0].props.onChange({ target: { value: 'devolvida' } });
    h.render();
    assert.match(h.requests.at(-1).path, /status=devolvida/);
    h.one('select', (p) => p.value === '').onChange({
      target: { value: 'urgente' },
    });
    h.render();
    const dates = h.find((n) => n.type === 'Input' && n.props.type === 'date');
    dates[0].props.onChange({ target: { value: '2026-10-01' } });
    h.render();
    h.one('Input', (p) => p.type === 'date' && p.min).onChange({
      target: { value: '2026-10-23' },
    });
    h.render();
    h.one('input', (p) => p.type === 'checkbox').onChange({
      target: { checked: true },
    });
    h.render();
    const query = new URLSearchParams(h.requests.at(-1).path.split('?')[1]);
    assert.equal(query.get('urgencia'), 'urgente');
    assert.equal(query.get('de'), '2026-10-01');
    assert.equal(query.get('ate'), '2026-10-23');
    assert.equal(query.get('nao_verificado'), '1');
    assert.equal(h.requests[0].options.signal.aborted, true);
  });

void test('abertura: mascara, consultaId, Receita somente leitura, categorias ativas, CEP e envio unico', async (t) => {
  const { h, saved } = await abrirForm(t);
  await consultar(h);
  assert.equal(input(h, 'cnpj').value, cliente.mascaraCnpj(receita.cnpj));
  assert.equal(
    h.find((n) => n.type === 'Input' && n.props.name === 'razao_social').length,
    0,
  );
  assert.equal(
    h.one('Info', (p) => p.label === 'Razão social').value,
    'Fornecedor fictício',
  );
  assert.equal(
    h.find((n) => n.type === 'input' && n.props.type === 'checkbox').length,
    1,
  );
  change(h, 'telefone', '000000000');
  change(h, 'email', 'fixture@example.com');
  change(h, 'cep', '00000-001');
  input(h, 'cep').onBlur();
  const cep = h.requests.at(-1);
  assert.equal(cep.path, '/api/solicitacoes/cep/00000001');
  cep.resolve({
    cep: '00000001',
    logradouro: 'Rua fictícia',
    cidade: 'Cidade preenchida',
    uf: 'SP',
  });
  await flush(h);
  assert.equal(input(h, 'cidade').value, 'Cidade preenchida');
  h.one('input', (p) => p.type === 'checkbox').onChange({
    target: { checked: true },
  });
  h.render();
  submit(h);
  submit(h);
  const post = h.requests.at(-1);
  assert.equal(post.options.method, 'POST');
  assert.equal(body(post).consultaId, 'consulta-ficticia');
  assert.deepEqual(body(post).categorias, ['oficina']);
  assert.equal(body(post).cep, '00000001');
  assert.equal(
    h.requests.filter((r) => r.options?.method === 'POST').length,
    1,
  );
  post.resolve({ id: 'nova' });
  await flush(h);
  assert.deepEqual(saved, ['nova']);
});
void test('CNPJ 400 conserva digitacao e permite consultar novamente', async (t) => {
  const { h } = await abrirForm(t);
  change(h, 'cnpj', '12');
  button(h, 'Consultar').onClick();
  h.requests
    .at(-1)
    .reject(new ApiError({ status: 400, error: 'Informe um CNPJ válido.' }));
  await flush(h);
  assert.match(textos(h), /CNPJ válido/);
  assert.equal(input(h, 'cnpj').value, '12');
  assert.equal(
    h.find((n) => n.type === 'Input' && n.props.name === 'razao_social').length,
    0,
  );
});
for (const {situacao, detalhes} of [
  { situacao: 'não ativa', detalhes: {
      status: 409,
      error:
        'CNPJ com situação cadastral BAIXADA. Somente empresas ATIVAS podem ser solicitadas.',
    } },
  { situacao: 'em aberto', detalhes: {
      status: 409,
      error:
        'Já existe a solicitação SOL-7 com status em_analise para este CNPJ.',
      existente: { id: 'existente', codigo: 'SOL-7', status: 'em_analise' },
    } },
])
  void test(`abertura 409 ${situacao}: preserva campos e oferece link quando duplicada`, async (t) => {
    const { h, opened } = await abrirForm(t);
    await consultar(
      h,
      situacao === 'não ativa'
        ? { ...receita, situacao_cadastral: 'BAIXADA' }
        : receita,
    );
    change(h, 'telefone', '123');
    submit(h);
    h.requests.at(-1).reject(new ApiError(detalhes));
    await flush(h);
    assert.ok(textos(h).includes(detalhes.error));
    assert.equal(input(h, 'telefone').value, '(12) 3');
    if (detalhes.existente) {
      const link = h.one('a');
      assert.match(link.href, /solicitacao=existente/);
      link.onClick({ preventDefault() {} });
      assert.deepEqual(opened, ['existente']);
    }
  });
void test('consulta 503 habilita manual sem consultaId, preserva contato apos erro no envio', async (t) => {
  const { h, saved } = await abrirForm(t);
  change(h, 'cnpj', receita.cnpj);
  button(h, 'Consultar').onClick();
  h.requests
    .at(-1)
    .reject(new ApiError({ status: 503, error: 'Consulta indisponível.' }));
  await flush(h);
  assert.equal(h.one('output').children, cliente.AVISO_MANUAL);
  assert.ok(input(h, 'razao_social'));
  change(h, 'razao_social', 'Manual fictício');
  change(h, 'email', 'fixture@example.com');
  submit(h);
  assert.equal(Object.hasOwn(body(h.requests.at(-1)), 'consultaId'), false);
  h.requests.at(-1).reject(new ApiError({ error: 'Falha fictícia' }));
  await flush(h);
  assert.equal(input(h, 'razao_social').value, 'Manual fictício');
  assert.equal(input(h, 'email').value, 'fixture@example.com');
  submit(h);
  h.requests.at(-1).resolve({ id: 'manual' });
  await flush(h);
  assert.deepEqual(saved, ['manual']);
});
void test('CEP atrasado nao substitui endereco ja corrigido; falha permite preenchimento manual', async (t) => {
  const { h } = await abrirForm(t);
  await consultar(h);
  input(h, 'cep').onBlur();
  const antiga = h.requests.at(-1);
  change(h, 'cidade', 'Correção manual');
  antiga.resolve({ cidade: 'Resposta antiga' });
  await flush(h);
  assert.equal(input(h, 'cidade').value, 'Correção manual');
  input(h, 'cep').onBlur();
  h.requests
    .at(-1)
    .reject(
      new ApiError({ status: 503, error: 'Consulta de CEP indisponível.' }),
    );
  await flush(h);
  assert.match(textos(h), /CEP indisponível/);
});

const detalhe = (status, extras = {}) => ({
  solicitacao: {
    ...receita,
    id: 'sol',
    codigo: 'SOL-1',
    solicitante_id: 'pessoa',
    status,
    revision: 7,
    nao_verificado: 0,
    urgencia: 'normal',
    ...extras,
  },
  categorias: [categorias[0]],
  andamentos: [
    {
      id: 'a',
      usuario: 'Autora fictícia',
      criado_em: '2026-10-22T12:00:00Z',
      para_status: 'devolvida',
      texto: 'Corrigir endereço',
    },
  ],
});
async function abrirDetalhe(t, role, status, extras = {}) {
  const h = await mount(
    'portal-solicitacao-detalhe',
    'DetalheSolicitacao',
    { id: 'sol', user: user(role), onBack() {} },
    modules,
  );
  t.after(() => h.unmount());
  h.requests[0].resolve(detalhe(status, extras));
  await flush(h);
  return h;
}
for (const role of ['viewer', 'editor', 'admin'])
  for (const status of [
    'aberta',
    'em_analise',
    'devolvida',
    'cadastrado',
    'recusado',
  ])
    void test(`detalhe ${role}/${status}: acoes permitidas e dados`, async (t) => {
      const h = await abrirDetalhe(
        t,
        role,
        status,
        role !== 'viewer' && status === 'devolvida'
          ? { solicitante_id: 'outra' }
          : {},
      );
      for (const [label, permitido] of [
        ['Iniciar análise', role !== 'viewer' && status === 'aberta'],
        [
          'Marcar como cadastrado',
          role !== 'viewer' && status === 'em_analise',
        ],
        ['Devolver', role !== 'viewer' && status === 'em_analise'],
        ['Recusar', role !== 'viewer' && status === 'em_analise'],
        [
          'Reconsultar na Receita',
          role !== 'viewer' && ['aberta', 'em_analise'].includes(status),
        ],
        ['Corrigir e reenviar', role === 'viewer' && status === 'devolvida'],
        ['Recusar devolvida', role !== 'viewer' && status === 'devolvida'],
        ['Cancelar solicitação', role === 'viewer' && status === 'devolvida'],
      ])
        assert.equal(
          h.find((n) => n.type === 'Button' && n.props.children === label)
            .length,
          permitido ? 1 : 0,
          label,
        );
      assert.equal(h.one('time').dateTime, '2026-10-22T12:00:00Z');
      assert.equal(
        h.one('b', (p) => p.children === 'Autora fictícia').children,
        'Autora fictícia',
      );
    });
void test('somente o solicitante pode corrigir; relacionados so quando retornados', async (t) => {
  const h = await abrirDetalhe(t, 'editor', 'devolvida', {
    solicitante_id: 'outra',
  });
  assert.equal(
    h.find(
      (n) => n.type === 'Button' && n.props.children === 'Corrigir e reenviar',
    ).length,
    0,
  );
  assert.equal(
    h.find((n) => n.type === 'h3' && n.props.children === 'Relacionados')
      .length,
    0,
  );
  h.one('Button', (p) => p['aria-label'] === 'Recarregar').onClick();
  h.render();
  h.requests
    .at(-1)
    .resolve({
      ...detalhe('devolvida'),
      relacionados: [
        { codigo: 'CH-1', fornecedor: 'Parceiro fictício', status: 'aberto' },
      ],
    });
  await flush(h);
  assert.equal(
    h.one('h3', (p) => p.children === 'Relacionados').children,
    'Relacionados',
  );
});
for (const para of ['cadastrado', 'devolvida', 'recusado'])
  void test(`acao ${para}: obrigatoriedade, expectedRevision e conflito sem apagar texto`, async (t) => {
    const h = await abrirDetalhe(t, 'editor', 'em_analise');
    button(
      h,
      {
        cadastrado: 'Marcar como cadastrado',
        devolvida: 'Devolver',
        recusado: 'Recusar',
      }[para],
    ).onClick();
    h.render();
    assert.equal(h.one('Textarea').required, para !== 'cadastrado');
    const antes = h.requests.length;
    if (para !== 'cadastrado') {
      submit(h);
      h.render();
      assert.equal(h.requests.length, antes);
      assert.match(textos(h), /Informe/);
    }
    h.one('Textarea').onChange({ target: { value: 'Texto fictício' } });
    h.render();
    submit(h);
    submit(h);
    const r = h.requests.at(-1);
    assert.equal(h.requests.length, antes + 1);
    assert.equal(body(r).expectedRevision, 7);
    assert.equal(body(r).para, para);
    r.reject(
      new ApiError({ status: 409, error: 'Esta solicitação foi alterada.' }),
    );
    await flush(h);
    assert.equal(textos(h), cliente.AVISO_REVISAO_SOLICITACAO);
    assert.equal(h.one('Textarea').value, 'Texto fictício');
  });
for (const acao of ['Iniciar análise', 'Reconsultar na Receita'])
  void test(`${acao}: revisao e recarga depois de salvar`, async (t) => {
    const h = await abrirDetalhe(t, 'admin', 'aberta');
    button(h, acao).onClick();
    h.render();
    const r = h.requests.at(-1);
    assert.equal(body(r).expectedRevision, 7);
    assert.match(
      r.path,
      acao === 'Iniciar análise' ? /transicao$/ : /reconsultar$/,
    );
    r.resolve({ success: true });
    await flush(h);
    assert.match(h.requests.at(-1).path, /solicitacoes\/sol$/);
  });
void test('detalhe sem acesso e inexistente exibem mesmo aviso, sem dados', async (t) => {
  for (const status of [403, 404]) {
    const h = await mount(
      'portal-solicitacao-detalhe',
      'DetalheSolicitacao',
      { id: 'negada', user: user('viewer'), onBack() {} },
      modules,
    );
    t.after(() => h.unmount());
    h.requests[0].reject(
      new ApiError({ status, error: 'Detalhe privado fictício' }),
    );
    await flush(h);
    assert.equal(
      h.one('FalhaDeCarregamento').erro,
      'Solicitação não encontrada.',
    );
    assert.equal(h.find((n) => n.type === 'Info').length, 0);
  }
});
for (const manual of [false, true])
  void test(`corrigir e reenviar ${manual ? 'manual' : 'verificada'} conserva CNPJ e manda PUT com revisao`, async (t) => {
    const value = detalhe('devolvida', {
      nao_verificado: manual ? 1 : 0,
    }).solicitacao;
    const { h, saved } = await abrirForm(t, {
      value,
      categoriasIniciais: categorias,
      devolucao: 'Corrigir endereço',
    });
    assert.equal(input(h, 'cnpj').readOnly, true);
    assert.equal(
      h.find((n) => n.type === 'Input' && n.props.name === 'razao_social')
        .length,
      manual ? 1 : 0,
    );
    assert.equal(
      h.one('div', (p) => p.role === 'note').children[0].props.children,
      'Mensagem da devolução',
    );
    change(h, 'cidade', 'Cidade corrigida');
    submit(h);
    const r = h.requests.at(-1);
    assert.equal(r.options.method, 'PUT');
    assert.equal(body(r).expectedRevision, 7);
    assert.equal(body(r).cnpj, receita.cnpj);
    assert.deepEqual(body(r).categorias, ['oficina']);
    r.reject(new ApiError({ status: 409, error: 'Alterada' }));
    await flush(h);
    assert.equal(textos(h), cliente.AVISO_REVISAO_SOLICITACAO);
    assert.equal(input(h, 'cidade').value, 'Cidade corrigida');
    submit(h);
    h.requests.at(-1).resolve({ success: true });
    await flush(h);
    assert.deepEqual(saved, ['sol']);
  });
void test('categorias: incluir, duplicidade, renomear, ativar/desativar e revisoes', async (t) => {
  const h = await mount(
    'portal-categorias-fornecedor',
    'CategoriasFornecedor',
    {},
    modules,
  );
  t.after(() => h.unmount());
  h.requests[0].resolve({ categorias });
  await flush(h);
  change(h, 'nome', 'Nova fictícia');
  submit(h);
  const criar = h.requests.at(-1);
  assert.equal(criar.options.method, 'POST');
  criar.reject(
    new ApiError({
      status: 409,
      error: 'Já existe uma categoria com esse nome.',
    }),
  );
  await flush(h);
  assert.match(textos(h), /Já existe uma categoria/);
  assert.equal(input(h, 'nome').value, 'Nova fictícia');
  button(h, 'Renomear Oficina').onClick();
  h.render();
  change(h, 'nome', 'Nome fictício');
  submit(h);
  const renomear = h.requests.at(-1);
  assert.equal(body(renomear).expectedRevision, 3);
  assert.equal(body(renomear).nome, 'Nome fictício');
  renomear.reject(
    new ApiError({ status: 409, error: 'Esta solicitação foi alterada.' }),
  );
  await flush(h);
  assert.equal(textos(h), cliente.AVISO_REVISAO_SOLICITACAO);
  button(h, 'Cancelar').onClick();
  h.render();
  button(h, 'Desativar Oficina').onClick();
  const desativar = h.requests.at(-1);
  assert.equal(body(desativar).ativo, false);
  assert.equal(body(desativar).expectedRevision, 3);
  desativar.resolve({});
  await flush(h);
  h.requests.at(-1).resolve({ categorias });
  await flush(h);
  button(h, 'Ativar Antiga').onClick();
  const ativar = h.requests.at(-1);
  assert.equal(body(ativar).ativo, true);
  assert.equal(body(ativar).expectedRevision, 1);
  ativar.resolve({});
  await flush(h);
  h.requests.at(-1).resolve({ categorias });
  await flush(h);
  change(h, 'nome', 'Criada');
  submit(h);
  h.requests.at(-1).resolve({ id: 'criada' });
  await flush(h);
  assert.equal(input(h, 'nome').value, '');
});

void test('formulario: mascaras de CEP e telefone, UF em lista e urgencia lado a lado', async (t) => {
  const { h } = await abrirForm(t);
  await consultar(h);
  change(h, 'cep', '00000001');
  assert.equal(input(h, 'cep').value, '00000-001');
  change(h, 'telefone', '31999998888');
  assert.equal(input(h, 'telefone').value, '(31) 99999-8888');
  const uf = (nome) => {
    const nos = h.find((n) => n.props?.nome === nome && n.props?.mudar);
    assert.equal(nos.length, 1, `Esperado um seletor ${nome}`);
    return nos[0].props;
  };
  assert.equal(uf('uf').valor, 'SP');
  uf('atendimento_uf').mudar('atendimento_uf', 'MG');
  h.render();
  button(h, 'Urgente').onClick();
  h.render();
  assert.equal(button(h, 'Urgente').variant, 'default');
  assert.equal(button(h, 'Normal').variant, 'outline');
  submit(h);
  const enviado = body(h.requests.at(-1));
  assert.equal(enviado.atendimento_uf, 'MG');
  assert.equal(enviado.urgencia, 'urgente');
  assert.equal(enviado.telefone, '(31) 99999-8888');
});
