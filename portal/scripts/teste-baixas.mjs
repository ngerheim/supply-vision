import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const porta = Number(process.env.PORTAL_TESTE_PORTA),
  [raiz, arquivo] = process.argv.slice(2);
if (
  process.env.PORTAL_TESTE_DESCARTAVEL !== 'SIM' ||
  !Number.isInteger(porta) ||
  porta < 1024 ||
  porta > 65534 ||
  [3000, 3001].includes(porta) ||
  !raiz ||
  !arquivo
)
  throw new Error('Exige instalacao descartavel.');
const raizReal = fs.realpathSync.native(raiz),
  relativa = path.relative(raizReal, fs.realpathSync.native(arquivo));
assert.ok(
  raizReal.includes('portal-teste-') &&
    relativa &&
    !relativa.startsWith('..') &&
    !path.isAbsolute(relativa),
  'Banco fora da fixture.',
);
const base = `http://127.0.0.1:${porta}/api/`,
  admin = process.env.PORTAL_TESTE_COOKIE;
const pedir = async (rota, method = 'GET', body, cookie = admin, chave) => {
  const r = await fetch(`${base}${rota}`, {
    method,
    headers: {
      cookie,
      'content-type': 'application/json',
      ...(chave ? { 'idempotency-key': chave } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  return { status: r.status, data: await r.json() };
};
const catalogoAtual=(await pedir('itens')).data.itens;
const obterItem=async(descricao,unidade)=>{
  const existente=catalogoAtual.find(i=>i.descricao===descricao&&i.unidade===unidade);
  if(existente){
    if(!existente.ativo){
      const ativado=await pedir(`itens/${existente.id}`,'PUT',{ativo:true,expectedRevision:existente.revision});
      assert.equal(ativado.status,200,JSON.stringify(ativado.data));
    }
    return existente;
  }
  const criado=await pedir('itens','POST',{descricao,unidade});
  assert.equal(criado.status,201,JSON.stringify(criado.data));
  return{id:criado.data.id,descricao,unidade};
};
const itemUn=await obterItem('Filtro HTTP ficticio','un'),
  itemL=await obterItem('Oleo HTTP ficticio','L'),
  itensPadrao=[{itemId:itemUn.id,quantidade:2},{itemId:itemL.id,quantidade:1.25}];
const cookies = {};
for (const role of ['viewer', 'editor']) {
  const body = {
    name: `Baixa ${role} Ficticia`,
    email: `baixa-${role}@example.com`,
    password: 'senha-ficticia-baixa-123',
    role,
  };
  assert.equal((await pedir('users', 'POST', body)).status, 201);
  const login = await fetch(`${base}login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(login.status, 200);
  cookies[role] = login.headers.get('set-cookie').split(';')[0];
}
const estoques = [];
for (const nome of ['Estoque Teste A', 'Estoque Teste B']) {
  const estoque = await pedir('estoques', 'POST', { nome });
  assert.equal(estoque.status, 201);
  estoques.push(estoque.data);
}
assert.equal(
  (
    await pedir(
      'estoques',
      'POST',
      { nome: 'Proibido ficticio' },
      cookies.editor,
    )
  ).status,
  403,
);
const cadastro = await pedir('estoques', 'POST', {
  nome: 'Estoque HTTP Ficticio',
});
assert.equal(cadastro.status, 201);
assert.equal(
  (await pedir('estoques', 'POST', { nome: 'ESTOQUE HTTP FICTICIO' })).status,
  409,
);
const entrada = {
  numero_os: '987654321',
  estoque_id: estoques[0].id,
  placa: 'fic-1234',
  itens:itensPadrao,
};
const hoje = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const estoqueInicial=await pedir('estoque/entradas','POST',{estoqueId:estoques[0].id,dataMovimento:hoje,documento:'Entrada teste fictícia',observacao:'Semente HTTP fictícia',itens:[{itemId:itemUn.id,quantidade:100},{itemId:itemL.id,quantidade:100}]},cookies.editor,'entrada-http-baixas');
assert.equal(estoqueInicial.status,200,JSON.stringify(estoqueInicial.data));
const criada = await pedir(
  'baixas',
  'POST',
  entrada,
  cookies.viewer,
  'baixa-http-ficticia',
);
assert.equal(criada.status, 201);
assert.match(criada.data.codigo, /^BX-[1-9]\d*$/);
assert.deepEqual(
  await pedir('baixas', 'POST', entrada, cookies.viewer, 'baixa-http-ficticia'),
  criada,
);
const duplicada = await pedir('baixas', 'POST', entrada, cookies.viewer);
assert.equal(duplicada.status, 409);
assert.equal(duplicada.data.existente.id, criada.data.id);
const rota = `baixas/${criada.data.id}`;
assert.equal(
  (await pedir(rota, 'GET', undefined, cookies.viewer)).data.baixa.placa,
  'FIC1234',
);
assert.equal(
  (
    await pedir(
      `${rota}/transicao`,
      'POST',
      { para: 'baixada', expectedRevision: 0 },
      cookies.viewer,
    )
  ).status,
  403,
);
assert.equal(
  (
    await pedir(
      `${rota}/transicao`,
      'POST',
      { para: 'recusada', expectedRevision: 0 },
      cookies.editor,
    )
  ).status,
  400,
);
assert.equal(
  (
    await pedir(
      `${rota}/transicao`,
      'POST',
      { para: 'baixada', expectedRevision: 4 },
      cookies.editor,
    )
  ).status,
  409,
);
assert.equal(
  (
    await pedir(
      `${rota}/transicao`,
      'POST',
      { para: 'baixada', expectedRevision: 0 },
      cookies.editor,
    )
  ).status,
  200,
);
assert.equal(
  (await pedir(rota, 'GET', undefined, cookies.viewer)).data.andamentos.length,
  4,
);
assert.deepEqual((await pedir(rota,'GET',undefined,cookies.viewer)).data.itens.map(i=>i.status),['baixado','baixado']);
const saldoAposBaixa=(await pedir(`estoque/saldos?estoqueId=${estoques[0].id}`, 'GET',undefined,cookies.viewer)).data.saldos;
assert.equal(saldoAposBaixa.find(i=>i.item_id===itemUn.id).saldo,98);
const movimentosEntrada=(await pedir(`estoque/movimentos?estoqueId=${estoques[0].id}&itemId=${itemUn.id}`,'GET',undefined,cookies.viewer)).data.movimentos;
const movimentoEntrada=movimentosEntrada.find(m=>m.origem_tipo==='entrada');
assert.ok(movimentosEntrada.some(m=>m.tipo==='saida'&&m.origem_tipo==='baixa_item'));
const estorno=await pedir(`estoque/movimentos/${movimentoEntrada.id}/estorno`,'POST',{motivo:'Correção HTTP fictícia'},cookies.editor,'estorno-http-baixas');
assert.equal(estorno.status,200,JSON.stringify(estorno.data));
assert.equal((await pedir(`estoque/movimentos/${movimentoEntrada.id}/estorno`,'POST',{motivo:'Correção HTTP fictícia'},cookies.editor)).data.codigo,'duplicado');
const nova = await pedir(
  'baixas',
  'POST',
  { ...entrada, placa: 'fic1a23' },
  cookies.viewer,
);
assert.equal(nova.status, 201);
assert.equal(
  (
    await pedir(
      `baixas/${nova.data.id}/transicao`,
      'POST',
      { para: 'recusada', texto: 'Motivo HTTP ficticio', expectedRevision: 0 },
      cookies.editor,
    )
  ).status,
  200,
);
const recusadaDetalhe=(await pedir(`baixas/${nova.data.id}`,'GET',undefined,cookies.admin)).data;
assert.equal(recusadaDetalhe.baixa.status,'recusada');
assert.deepEqual(recusadaDetalhe.itens.map(i=>i.status),['recusado','recusado']);
const propria = await pedir('baixas', 'POST', {
  ...entrada,
  numero_os: '987654322',
});
assert.equal(propria.status, 201);
assert.equal(
  (await pedir(`baixas/${propria.data.id}`, 'GET', undefined, cookies.viewer))
    .status,
  404,
);
assert.equal(
  (await pedir('baixas', 'GET', undefined, cookies.viewer)).data.baixas.some(
    (b) => b.id === propria.data.id,
  ),
  false,
);
const edicao=await pedir('baixas','POST',{...entrada,numero_os:'987654324'},cookies.viewer);
assert.equal(edicao.status,201);
const edicaoRota=`baixas/${edicao.data.id}`;
const edicaoAtual=(await pedir(edicaoRota,'GET',undefined,cookies.viewer)).data;
assert.equal((await pedir(`${edicaoRota}/itens`,'PUT',{expectedRevision:edicaoAtual.baixa.revision,itens:[{itemId:itemUn.id,quantidade:4}]},cookies.editor)).status,403);
assert.equal((await pedir(`${edicaoRota}/itens`,'PUT',{expectedRevision:edicaoAtual.baixa.revision,itens:[{itemId:itemUn.id,quantidade:4},{itemId:itemL.id,quantidade:2.5}]},cookies.viewer)).status,200);
assert.equal((await pedir(edicaoRota,'GET',undefined,cookies.viewer)).data.itens.find(i=>i.item_id===itemL.id).quantidade,2.5);
const parcial=await pedir('baixas','POST',{...entrada,numero_os:'987654325'},cookies.viewer);
assert.equal(parcial.status,201);
const parcialRota=`baixas/${parcial.data.id}`,
  parcialAntes=(await pedir(parcialRota,'GET',undefined,cookies.viewer)).data;
const atendimento=await pedir(`${parcialRota}/atender-itens`,'POST',{expectedRevision:parcialAntes.baixa.revision,itens:[{id:parcialAntes.itens.find(i=>i.item_id===itemUn.id).id,para:'baixado'},{id:parcialAntes.itens.find(i=>i.item_id===itemL.id).id,para:'recusado',motivo:'Sem saldo HTTP ficticio'}]},cookies.editor);
assert.equal(atendimento.status,200,JSON.stringify(atendimento.data));
const parcialDepois=(await pedir(parcialRota,'GET',undefined,cookies.viewer)).data;
assert.equal(parcialDepois.baixa.status,'baixada');
assert.deepEqual(parcialDepois.itens.map(i=>i.status),['baixado','recusado']);
assert.equal(parcialDepois.itens.find(i=>i.status==='recusado').motivo_recusa,'Sem saldo HTTP ficticio');
const avisoParcial=(await pedir('central','GET',undefined,cookies.viewer)).data.notificacoes.filter(a=>a.link===`/?aba=chamados&baixa=${parcial.data.id}`);
assert.equal(avisoParcial.length,1);
const avisos = (await pedir('central', 'GET', undefined, cookies.viewer)).data
  .notificacoes;
assert.ok(
  avisos.some(
    (a) =>
      a.link === `/?aba=chamados&baixa=${nova.data.id}` &&
      a.texto.includes('Motivo HTTP ficticio'),
  ),
);
assert.equal(
  (
    await pedir(`estoques/${cadastro.data.id}`, 'PUT', {
      ativo: false,
      expectedRevision: 0,
    })
  ).status,
  200,
);
assert.equal(
  (
    await pedir(
      'baixas',
      'POST',
      { ...entrada, numero_os: '987654323', estoque_id: cadastro.data.id },
      cookies.viewer,
    )
  ).status,
  400,
);
console.log('[OK] Baixas HTTP: catálogo, itens, edição, entrada, saída automática, saldo, estorno, atendimento parcial, perfis, idempotência, revision e estoques.');
