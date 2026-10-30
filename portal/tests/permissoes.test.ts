import assert from 'node:assert/strict';
import test from 'node:test';
import { ACOES, ACOES_SO_ADMIN, AREAS_IDS, EXIGENCIAS, ajustesDiferentesDoPadrao, nivelPadrao, pode, type Acao, type Permissoes } from '../lib/permissoes.ts';
import { ABAS_NAVEGACAO, podeAcessarAba } from '../lib/navegacao.ts';
import { canWrite } from '../lib/api-compartilhada.ts';

// Inventario manual do contrato anterior: [viewer, editor, admin, inativo].
// Nao derivar expectativas dos conjuntos de producao.
const equivalencia: Record<Acao, readonly boolean[]> = {
  'baixa:abrir': [true, true, true, false],
  'baixa:ver_todas': [false, true, true, false],
  'baixa:atender': [false, true, true, false],
  'estoque:gerenciar': [false, false, true, false],
  'aba:baixas': [true, true, true, false],
  'aba:estoques': [false, false, true, false],
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
  // Acoes separadas de Solicitacoes e Baixa: mesmo contrato das que substituem.
  'aba:pagamentos': [true, true, true, false],
  'pagamento:abrir': [true, true, true, false],
  'pagamento:ver_todas': [false, true, true, false],
  'pagamento:atender': [false, true, true, false],
  'aba:estoque': [true, true, true, false],
  'estoque:consultar': [true, true, true, false],
  'estoque:lancar': [false, true, true, false],
  'aba:permissoes': [false, false, true, false],
  'permissao:gerenciar': [false, false, true, false],
  'aba:analise': [false, true, true, false],
  'analise:consultar': [false, true, true, false],
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

const PERFIS = ['viewer', 'editor', 'admin'] as const;
const matrizPadrao = (role: (typeof PERFIS)[number]) =>
  Object.fromEntries(AREAS_IDS.map(area => [area, nivelPadrao(role, area)])) as Permissoes;

void test('painel: a matriz padrao de cada perfil reproduz exatamente o acesso do perfil', () => {
  for (const role of PERFIS) {
    const permissoes = matrizPadrao(role);
    for (const acao of ACOES) {
      assert.equal(pode({ role, permissoes }, acao), pode({ role }, acao), `${role}/${acao}`);
    }
    assert.deepEqual(ajustesDiferentesDoPadrao(role, permissoes), {}, `${role}: padrao nao gera ajuste`);
  }
});

void test('painel: sem acesso bloqueia a sub-aba e as acoes dela', () => {
  const usuario = { role: 'editor', permissoes: { pagamentos: 'sem' } as Permissoes };
  assert.equal(pode(usuario, 'aba:pagamentos'), false);
  assert.equal(pode(usuario, 'pagamento:abrir'), false);
  assert.equal(pode(usuario, 'pagamento:atender'), false);
  assert.equal(podeAcessarAba(usuario, 'pagamentos'), false);
  // As outras sub-abas de Chamados continuam como no perfil.
  assert.equal(pode(usuario, 'solicitacao:atender'), true);
  assert.equal(podeAcessarAba(usuario, 'solicitacoes'), true);
});

void test('painel: somente leitura libera consulta e bloqueia edicao', () => {
  const usuario = { role: 'editor', permissoes: { acordos: 'leitura', parcerias: 'leitura' } as Permissoes };
  assert.equal(pode(usuario, 'aba:agreements'), true);
  assert.equal(pode(usuario, 'acordo:consultar-completo'), true);
  assert.equal(pode(usuario, 'acordo:editar'), false);
  assert.equal(pode(usuario, 'chamado:consultar'), true);
  assert.equal(pode(usuario, 'chamado:editar'), false);
  // Nas sub-abas de pedidos, leitura = abrir e ver so os proprios.
  const consulta = { role: 'editor', permissoes: { solicitacoes: 'leitura' } as Permissoes };
  assert.equal(pode(consulta, 'solicitacao:abrir'), true);
  assert.equal(pode(consulta, 'solicitacao:ver_todas'), false);
  assert.equal(pode(consulta, 'solicitacao:atender'), false);
});

void test('painel: ler e editar amplia o acesso alem do perfil', () => {
  const usuario = { role: 'editor', permissoes: { relatorios: 'edicao', categorias: 'edicao' } as Permissoes };
  assert.equal(pode(usuario, 'aba:reports'), true);
  assert.equal(pode(usuario, 'relatorio:executar'), true);
  assert.equal(pode(usuario, 'categoria:gerenciar'), true);
  const consulta = { role: 'viewer', permissoes: { acordos: 'edicao' } as Permissoes };
  assert.equal(pode(consulta, 'acordo:editar'), true);
  assert.equal(pode(consulta, 'portal:consultar-gestao'), true);
});

void test('painel: acoes exclusivas do admin nao saem do perfil admin', () => {
  const todas = Object.fromEntries(AREAS_IDS.map(area => [area, 'edicao'])) as Permissoes;
  for (const acao of ACOES_SO_ADMIN) {
    assert.equal(pode({ role: 'editor', permissoes: todas }, acao), false, acao);
    assert.equal(pode({ role: 'admin', permissoes: { buscar: 'sem' } }, acao), true, acao);
  }
  // Admin nao e rebaixado por ajuste.
  assert.equal(pode({ role: 'admin', permissoes: { acordos: 'sem' } }, 'acordo:editar'), true);
  assert.deepEqual(ajustesDiferentesDoPadrao('admin', { acordos: 'sem' }), {});
});

void test('painel: toda acao com area tem area valida', () => {
  for (const [acao, exigencia] of Object.entries(EXIGENCIAS)) {
    assert.ok(ACOES.includes(acao as Acao), acao);
    for (const [area] of exigencia!) assert.ok(AREAS_IDS.includes(area), `${acao}/${area}`);
  }
  // Toda acao ou pertence a uma area, ou e exclusiva do admin, ou e geral.
  for (const acao of ACOES) {
    assert.ok(EXIGENCIAS[acao] || ACOES_SO_ADMIN.includes(acao) || acao === 'central:marcar', acao);
  }
});
