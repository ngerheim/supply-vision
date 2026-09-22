import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCookies } from '../lib/cookies.ts';

void test('cookie inválido não impede recuperar a sessão válida', () => {
  const request = new Request('http://localhost', { headers: { cookie: 'outro=%; %ZZ=x; acordos_session=abc; incompleto' } });
  assert.deepEqual({ ...parseCookies(request) }, { acordos_session: 'abc' });
});
void test('sessão inválida é ignorada e valores preservam sinal de igual', () => {
  const request = new Request('http://localhost', { headers: { cookie: 'acordos_session=%; token=a=b%3D; vazio=' } });
  assert.deepEqual({ ...parseCookies(request) }, { token: 'a=b=', vazio: '' });
  assert.deepEqual({ ...parseCookies(new Request('http://localhost')) }, {});
});
void test('nome que apenas termina em acordos_session não se passa pela sessão', () => {
  const request = new Request('http://localhost', { headers: { cookie: 'x_acordos_session=velho; acordos_session=novo' } });
  assert.equal(parseCookies(request).acordos_session, 'novo');
});
