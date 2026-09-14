import test from 'node:test';
import assert from 'node:assert/strict';
import { montarCasca, escapar, paleta } from '../lib/email-visual.ts';

/**
 * O que importa aqui e compatibilidade com cliente de e-mail, nao estetica.
 * Espelho de alertas/tests/test_email_visual.py — os dois precisam concordar.
 */

void test('casca traz a identidade do produto', () => {
  const html = montarCasca('Titulo', 'Subtitulo', '<p>corpo</p>');
  assert.ok(html.includes('Ambiente corporativo'));
  assert.ok(html.includes('Supply Vision'));
  assert.ok(html.includes('Titulo'));
  assert.ok(html.includes('Subtitulo'));
  assert.ok(html.includes('<p>corpo</p>'));
});

void test('paleta e a mesma usada pelos Alertas', () => {
  assert.equal(paleta.cabecalho, '#0a1420');
  assert.equal(paleta.destaque, '#81e6d9');
  assert.equal(paleta.fundo, '#f3f6f8');
  const html = montarCasca('T', '', '');
  for (const cor of ['#0a1420', '#81e6d9', '#f3f6f8']) {
    assert.ok(html.includes(cor), `cor ${cor} ausente`);
  }
});

void test('nao usa recurso que o Outlook descarta', () => {
  const html = montarCasca('T', 'S', '<p>x</p>', { texto: 'Abrir', url: 'http://x/' });
  for (const proibido of ['<script', '<link', 'display:flex', 'display:grid',
    '<svg', '@media', 'position:absolute']) {
    assert.ok(!html.includes(proibido), `recurso incompativel: ${proibido}`);
  }
});

void test('estrutura e tabela com estilo inline', () => {
  const html = montarCasca('T', 'S', '');
  assert.ok(html.includes('<table role="presentation"'));
  assert.ok(html.includes('style='));
});

void test('titulo, subtitulo e botao sao escapados', () => {
  const html = montarCasca('5 < 10', 'a & b', '', { texto: '"ir"', url: 'http://x/?a=1&b=2' });
  assert.ok(html.includes('&lt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(!html.includes('5 < 10'));
});

void test('botao so aparece quando informado', () => {
  assert.ok(!montarCasca('T', 'S', '').includes('Abrir'));
  assert.ok(montarCasca('T', 'S', '', { texto: 'Abrir', url: 'http://x/' }).includes('Abrir'));
});

void test('escapar cobre os cinco caracteres perigosos', () => {
  assert.equal(escapar(`&<>'"`), '&amp;&lt;&gt;&#39;&quot;');
  assert.equal(escapar(null), '');
});
