import assert from 'node:assert/strict';
import test from 'node:test';
import { criarConsultasFornecedor, CONSULTA_INDISPONIVEL, FalhaConsulta, normalizarReceita } from '../lib/consultas-fornecedor.ts';
import { CNPJS_ENSAIO, provedorConsultaEnsaio } from '../lib/consultas-fornecedor-ensaio.ts';

void test('CNPJ invalido e CEP invalido nao chamam provedor', async () => {
  let chamadas = 0;
  const consultas = criarConsultasFornecedor({ provedor: async () => { chamadas++; return {}; } });
  for (const numero of ['11111111111111', CNPJS_ENSAIO.ativa.slice(0, 13) + (CNPJS_ENSAIO.ativa.endsWith('0') ? '1' : '0'), 'abc', '123']) await assert.rejects(consultas.cnpj(numero), /CNPJ válido/);
  for (const cep of ['123', 'abcdefgh', '00000-000']) await assert.rejects(consultas.cep(cep), /8 dígitos/);
  assert.equal(chamadas, 0);
});

void test('fontes normalizadas, reserva, inexistente e ambas fora', async () => {
  const chamadas: string[] = [];
  const consultas = criarConsultasFornecedor({ provedor: async (url, signal) => {
    assert.equal(signal instanceof AbortSignal, true);
    assert.equal(url.protocol, 'https:');
    chamadas.push(url.hostname);
    return provedorConsultaEnsaio(url);
  } });
  const ativa = await consultas.cnpj(CNPJS_ENSAIO.ativa);
  assert.equal(ativa.dados.situacao_cadastral, 'ATIVA');
  assert.equal((await consultas.cnpj(CNPJS_ENSAIO.baixada)).dados.situacao_cadastral, 'BAIXADA');
  const reserva = await consultas.cnpj(CNPJS_ENSAIO.principalFora);
  assert.equal(reserva.fonte, 'ReceitaWS');
  assert.deepEqual({ ...reserva.dados, cnpj: ativa.dados.cnpj }, ativa.dados);
  assert.deepEqual(chamadas.slice(-2), ['brasilapi.com.br', 'receitaws.com.br']);
  await assert.rejects(consultas.cnpj(CNPJS_ENSAIO.inexistente), (e: unknown) => e instanceof FalhaConsulta && e.status === 404);
  await assert.rejects(consultas.cnpj(CNPJS_ENSAIO.ambasFora), (e: unknown) => e instanceof FalhaConsulta && e.status === 503 && e.message === CONSULTA_INDISPONIVEL);
  assert.throws(() => normalizarReceita({ cnpj: CNPJS_ENSAIO.baixada }, CNPJS_ENSAIO.ativa, 'BrasilAPI'));
});

void test('cache CNPJ/CEP dura 10 minutos, clona respostas e reconsulta renova', async () => {
  let agora = 0, chamadas = 0;
  const consultas = criarConsultasFornecedor({ agora: () => agora, provedor: async url => { chamadas++; return provedorConsultaEnsaio(url); } });
  const primeira = await consultas.cnpj(CNPJS_ENSAIO.ativa);
  primeira.dados.razao_social = 'Mutacao do consumidor';
  assert.equal((await consultas.cnpj(CNPJS_ENSAIO.ativa)).dados.razao_social, 'FORNECEDOR FICTÍCIO');
  assert.equal(chamadas, 1);
  await consultas.cep('00000000'); await consultas.cep('00000000');
  assert.equal(chamadas, 2);
  agora = 599999; await consultas.cnpj(CNPJS_ENSAIO.ativa); assert.equal(chamadas, 2);
  agora = 600000; await consultas.cnpj(CNPJS_ENSAIO.ativa); await consultas.cep('00000000'); assert.equal(chamadas, 4);
  await consultas.cnpj(CNPJS_ENSAIO.ativa, true); assert.equal(chamadas, 5);
});

void test('ensaio, CI e PREPARAR usam somente fixture, sem fetch', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('Nao deve chamar rede'); });
  const nomes = ['MODO_ENSAIO', 'CI', 'SV_PREPARO_RAIZ'] as const;
  const antigos = Object.fromEntries(nomes.map(n => [n, process.env[n]]));
  try {
    for (const modo of nomes) {
      for (const n of nomes) delete process.env[n];
      process.env[modo] = modo === 'CI' ? 'true' : '1';
      const consultas = criarConsultasFornecedor();
      assert.equal((await consultas.cnpj(CNPJS_ENSAIO.ativa)).fonte, 'BrasilAPI');
      assert.equal((await consultas.cnpj(CNPJS_ENSAIO.principalFora)).fonte, 'ReceitaWS');
      await assert.rejects(consultas.cnpj(CNPJS_ENSAIO.ambasFora), /indisponível/);
      assert.equal((await consultas.cep('00000000')).cidade, 'Cidade Fictícia');
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally { for (const n of nomes) if (antigos[n] === undefined) delete process.env[n]; else process.env[n] = antigos[n]; }
});
