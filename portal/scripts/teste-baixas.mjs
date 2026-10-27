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
};
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
  2,
);
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
console.log(
  '[OK] Baixas HTTP: perfis, placa, idempotencia, duplicidade, revision, transicoes, Central e estoques.',
);
