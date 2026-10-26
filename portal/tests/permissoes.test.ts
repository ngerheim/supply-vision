import assert from 'node:assert/strict';
import test from 'node:test';
import { ACOES, pode, type Acao } from '../lib/permissoes.ts';
import { ABAS_NAVEGACAO, podeAcessarAba } from '../lib/navegacao.ts';
import { canWrite } from '../lib/api-compartilhada.ts';

// Inventario manual do contrato anterior: [viewer, editor, admin, inativo].
// Nao derivar expectativas dos conjuntos de producao.
const equivalencia: Record<Acao, readonly boolean[]> = {
  'aba:solicitacoes': [true, true, true, false],
  'aba:categorias': [false, false, true, false],
  'aba:search': [true, true, true, false],
  'aba:maintenance': [true, true, true, false],
  'aba:tickets': [false, true, true, false],
  'aba:agreements': [false, true, true, false],
  'aba:suppliers': [false, true, true, false],
  'aba:imports': [false, true, true, false],
  'aba:catalogs': [false, true, true, false],
  'aba:mappings': [false, true, true, false],
  'aba:reports': [false, false, true, false],
  'aba:history': [false, false, true, false],
  'aba:emails': [false, false, true, false],
  'aba:admin': [false, false, true, false],
  'portal:consultar-gestao': [false, true, true, false],
  'portal:escrever': [false, true, true, false],
  'acordo:consultar-completo': [false, true, true, false],
  'acordo:editar': [false, true, true, false],
  'acordo:excluir': [false, false, true, false],
  'acordo:exportar': [false, true, true, false],
  'importacao:executar': [false, true, true, false],
  'mapeamento:consultar': [false, true, true, false],
  'chamado:consultar': [false, true, true, false],
  'chamado:editar': [false, true, true, false],
  'catalogo:gerenciar': [false, true, true, false],
  'importacao:consultar': [false, true, true, false],
  'mapeamento:gerenciar': [false, true, true, false],
  'chamado:assumir': [false, true, true, false],
  'usuario:consultar': [false, true, true, false],
  'usuario:gerenciar': [false, false, true, false],
  'relatorio:consultar': [false, false, true, false],
  'relatorio:executar': [false, false, true, false],
  'relatorio:cancelar': [false, false, true, false],
  'auditoria:consultar': [false, false, true, false],
  'email:consultar': [false, false, true, false],
  'email:reenviar': [false, false, true, false],
  'base:exportar': [false, false, true, false],
  'central:marcar': [true, true, true, false],
  'solicitacao:abrir': [true, true, true, false],
  'solicitacao:ver_todas': [false, true, true, false],
  'solicitacao:atender': [false, true, true, false],
  'categoria:gerenciar': [false, false, true, false],
};

void test('cada perfil e cada acao preservam o contrato inventariado', () => {
  assert.deepEqual([...ACOES].sort((a, b) => a.localeCompare(b)), Object.keys(equivalencia).sort((a, b) => a.localeCompare(b)));
  for (const acao of ACOES) {
    for (const [indice, role] of ['viewer', 'editor', 'admin'].entries()) {
      assert.equal(pode({ role, active: 1 }, acao), equivalencia[acao][indice], `${role}/${acao}`);
      // A sessao atual omite active, pois o banco ja o verifica.
      assert.equal(pode({ role }, acao), equivalencia[acao][indice], `sessao/${role}/${acao}`);
      for (const active of [0, false, null, '1']) {
        assert.equal(pode({ role, active }, acao), equivalencia[acao][3], `inativo/${role}/${acao}`);
      }
    }
    for (const usuario of [null, undefined, {}, { role: 'outro' }, { role: 'toString' }]) {
      assert.equal(pode(usuario, acao), false, `ausente/invalido/${acao}`);
    }
  }
});

void test('abas e adaptador de escrita respeitam usuario inativo', () => {
  for (const aba of ABAS_NAVEGACAO) for (const sub of aba.subabas) {
    assert.equal(podeAcessarAba({ role: 'admin', active: 0 }, sub.chave), false);
  }
  assert.equal(canWrite({ id: 'u', name: 'Fixture', email: 'u@example.com', role: 'viewer' }), false);
  assert.equal(canWrite({ id: 'u', name: 'Fixture', email: 'u@example.com', role: 'editor' }), true);
});
