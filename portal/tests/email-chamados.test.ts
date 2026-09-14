import assert from 'node:assert/strict';
import test from 'node:test';
import { montarEmailChamado, proximaTentativa, type DadosEmailChamado } from '../lib/email-chamados.ts';

const dados: DadosEmailChamado = { ticketId: 'tck_123', codigo: 'SUP-0007', fornecedor: 'OFICINA & FILHOS', prioridade: 'alta', situacao: 'fechado', solicitante: 'Ana', responsavel: 'Bruno', autor: 'Carla', resumo: 'A negociação foi finalizada.', alteracoes: ['Situação: Aberto → Concluído'], mensagem: '<acordo aprovado>' };

void test('monta assunto, texto e link do chamado', () => {
  const email = montarEmailChamado('conclusao', dados, 'http://127.0.0.1:3000/');
  assert.equal(email.assunto, '[Portal Suprimentos] SUP-0007 concluído');
  assert.match(email.texto, /A negociação foi finalizada/);
  assert.equal(email.url, 'http://127.0.0.1:3000/?chamado=tck_123');
});
void test('escapa conteudo inserido no HTML', () => {
  const email = montarEmailChamado('conclusao', dados, 'http://127.0.0.1:3000');
  assert.doesNotMatch(email.html, /<acordo aprovado>/);
  assert.match(email.html, /&lt;acordo aprovado&gt;/);
  assert.match(email.html, /OFICINA &amp; FILHOS/);
});
void test('usa intervalos crescentes e limita a ultima faixa', () => {
  const agora = new Date('2026-09-09T12:00:00.000Z');
  assert.equal(proximaTentativa(1, agora), '2026-09-09T12:01:00.000Z');
  assert.equal(proximaTentativa(4, agora), '2026-09-09T13:00:00.000Z');
  assert.equal(proximaTentativa(9, agora), '2026-09-09T16:00:00.000Z');
});
