import assert from 'node:assert/strict';
import test from 'node:test';

import { planejarNotificacoesChamado, type DestinatarioChamado, type EstadoNotificacaoChamado } from '../lib/notificacoes-chamados.ts';

const pessoa = (id: string, email = `${id}@example.com`): DestinatarioChamado => ({ id, email, nome: id });
const estado = (status: EstadoNotificacaoChamado['status'] = 'aberto', solicitante: DestinatarioChamado | null = pessoa('solicitante'), responsavel: DestinatarioChamado | null = pessoa('responsavel')): EstadoNotificacaoChamado => ({ status, solicitante, responsavel });
const resumo = (resultado: ReturnType<typeof planejarNotificacoesChamado>) => resultado.map((item) => `${item.tipo}:${item.destinatario.id}`).sort();

void test('criacao atribuida avisa somente o responsavel', () => {
  assert.deepEqual(resumo(planejarNotificacoesChamado(null, estado())), ['atribuicao:responsavel']);
});
void test('criacao sem responsavel nao dispara mensagem', () => {
  assert.deepEqual(planejarNotificacoesChamado(null, estado('aberto', pessoa('solicitante'), null)), []);
});
void test('reatribuicao isolada avisa somente o novo responsavel', () => {
  assert.deepEqual(resumo(planejarNotificacoesChamado(estado('aberto', pessoa('solicitante'), pessoa('anterior')), estado('aberto', pessoa('solicitante'), pessoa('novo')))), ['atribuicao:novo']);
});
void test('remover o responsavel nao gera atribuicao', () => {
  assert.deepEqual(planejarNotificacoesChamado(estado(), estado('aberto', pessoa('solicitante'), null)), []);
});
void test('andamento avisa solicitante e responsavel', () => {
  assert.deepEqual(resumo(planejarNotificacoesChamado(estado(), estado(), { andamentoAdicionado: true })), ['atualizacao:responsavel', 'atualizacao:solicitante']);
});
void test('alteracao relevante avisa solicitante e responsavel', () => {
  assert.deepEqual(resumo(planejarNotificacoesChamado(estado(), estado(), { camposAlterados: ['prioridade', 'escopo'] })), ['atualizacao:responsavel', 'atualizacao:solicitante']);
});
void test('mudanca intermediaria de situacao e uma atualizacao', () => {
  assert.deepEqual(resumo(planejarNotificacoesChamado(estado('aberto'), estado('aguardando_fornecedor'))), ['atualizacao:responsavel', 'atualizacao:solicitante']);
});
void test('conclusao prevalece e avisa solicitante e responsavel uma vez', () => {
  assert.deepEqual(resumo(planejarNotificacoesChamado(estado('aberto'), estado('fechado'), { camposAlterados: ['escopo'] })), ['conclusao:responsavel', 'conclusao:solicitante']);
});
void test('cancelamento avisa solicitante e responsavel', () => {
  assert.deepEqual(resumo(planejarNotificacoesChamado(estado('aberto'), estado('cancelado'))), ['cancelamento:responsavel', 'cancelamento:solicitante']);
});
void test('solicitante e responsavel com o mesmo email recebem uma mensagem', () => {
  const solicitante = pessoa('solicitante', 'mesma.pessoa@example.com');
  const responsavel = pessoa('responsavel', 'MESMA.PESSOA@example.com');
  assert.equal(planejarNotificacoesChamado(estado('aberto', solicitante, responsavel), estado('fechado', solicitante, responsavel)).length, 1);
});
void test('reatribuicao com outra alteracao consolida por destinatario', () => {
  assert.deepEqual(resumo(planejarNotificacoesChamado(estado('aberto', pessoa('solicitante'), pessoa('anterior')), estado('aberto', pessoa('solicitante'), pessoa('novo')), { camposAlterados: ['prioridade'] })), ['atribuicao:novo', 'atualizacao:solicitante']);
});
void test('salvamento sem mudanca relevante nao gera mensagem', () => {
  assert.deepEqual(planejarNotificacoesChamado(estado(), estado()), []);
});
