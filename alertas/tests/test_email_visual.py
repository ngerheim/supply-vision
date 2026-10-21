"""Testes da casca visual dos e-mails.

O que importa aqui e compatibilidade com cliente de e-mail, nao estetica:
Outlook renderiza com o motor do Word e descarta o que nao for HTML de tabela
com estilo inline.
"""
import importlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "processo"))

visual = importlib.import_module("email_visual")


def test_html_traz_identidade_do_produto():
    html = visual.montar_html("Conformidade de Preços", ["Uma linha."])
    assert "Ambiente corporativo" in html
    assert "Supply Vision" in html
    assert "Conformidade de Preços" in html
    assert "Uma linha." in html


def test_paleta_e_a_mesma_do_portal():
    html = visual.montar_html("Título", ["Corpo."])
    for cor in ("#0a1420", "#81e6d9", "#f3f6f8"):
        assert cor in html, f"cor {cor} ausente"


def test_sem_recurso_que_o_outlook_descarta():
    """Regressao: JavaScript, CSS externo, flexbox, grid e SVG nao sobrevivem
    ao motor do Word. Se alguem colar um componente de biblioteca web aqui,
    este teste precisa falhar."""
    html = visual.montar_html("Título", ["Corpo."])
    for proibido in ("<script", "<link", "display:flex", "display:grid",
                     "<svg", "@media", "position:absolute", "rem;"):
        assert proibido not in html, f"recurso incompativel encontrado: {proibido}"


def test_estrutura_de_tabela_com_estilo_inline():
    html = visual.montar_html("Título", ["Corpo."])
    assert '<table role="presentation"' in html
    assert "style=" in html


def test_conteudo_e_escapado():
    html = visual.montar_html('Título', ['5 < 10 & "aspas"'])
    assert "&lt;" in html and "&amp;" in html and "&quot;" in html
    assert "5 < 10" not in html


def test_linhas_vazias_sao_ignoradas():
    html = visual.montar_html("Título", ["Primeira.", "", None, "Segunda."])
    assert html.count("<p style=") == 2


@pytest.fixture(scope='module')
def espelho_portal():
    node = shutil.which('node')
    if node is None:
        pytest.skip('Paridade com TypeScript requer Node com suporte a --experimental-strip-types')
    casos = [
        {'titulo': 'Titulo', 'linhas': ['Primeira.', '', None, 'Segunda.'],
         'rodape': 'Mensagem automática do Supply Vision.'},
        {'titulo': '<img src=x> & "aspas"', 'linhas': ["<script>'&\"</script>"],
         'rodape': '<footer> & teste'},
    ]
    script = '''
import { readFileSync } from 'node:fs';
import { paleta, escapar, montarCasca } from './portal/lib/email-visual.ts';
const casos = JSON.parse(readFileSync(0, 'utf8'));
const html = casos.map(c => montarCasca(c.titulo, '', c.linhas.filter(Boolean)
  .map(l => `<p style="margin:0 0 14px;line-height:1.55;font-size:15px">${escapar(l)}</p>`)
  .join(''), undefined, c.rodape));
console.log(JSON.stringify({paleta, html, escapes: [null, 0, '&<>\\'"'].map(escapar)}));
'''
    resultado = subprocess.run([node, '--experimental-strip-types', '--input-type=module', '-e', script],
                               input=json.dumps(casos), text=True, encoding='utf-8',
                               capture_output=True, timeout=20, cwd=RAIZ.parent)
    assert resultado.returncode == 0, resultado.stderr
    return casos, json.loads(resultado.stdout)


def test_paleta_completa_e_escape_executados_no_portal(espelho_portal):
    _, portal = espelho_portal
    nomes = {'FUNDO': 'fundo', 'CARTAO': 'cartao', 'BORDA': 'borda',
             'CABECALHO': 'cabecalho', 'DESTAQUE': 'destaque', 'TEXTO': 'texto',
             'SECUNDARIO': 'secundario', 'RODAPE_FUNDO': 'rodapeFundo', 'RODAPE_TEXTO': 'rodapeTexto'}
    assert {nome: getattr(visual, nome) for nome in nomes} == {
        nome: portal['paleta'][chave] for nome, chave in nomes.items()}
    esperado = ['', '0', '&amp;&lt;&gt;&#39;&quot;']
    assert portal['escapes'] == esperado
    assert [visual.escapar(v) for v in (None, 0, '&<>\'"')] == esperado


def test_estrutura_e_conteudo_iguais_exceto_estilo_conhecido_do_h1(espelho_portal):
    casos, portal = espelho_portal
    for caso, html_portal in zip(casos, portal['html'], strict=True):
        html_python = visual.montar_html(caso['titulo'], caso['linhas'], caso['rodape'])
        # Excecao intencional restrita ao style do H1; o teste abaixo acompanha
        # a diferenca conhecida. Todo o restante e comparado byte a byte.
        normalizar = lambda html: re.sub(r'<h1 style="[^"]*">', '<h1>', html)
        assert normalizar(html_python) == normalizar(html_portal)


def test_estilo_h1_tambem_tem_paridade(espelho_portal):
    casos, portal = espelho_portal
    caso = casos[0]
    html_python = visual.montar_html(caso['titulo'], caso['linhas'], caso['rodape'])
    h1 = lambda html: re.search(r'<h1 style="[^"]*">', html).group()
    assert h1(html_python) == h1(portal['html'][0])
