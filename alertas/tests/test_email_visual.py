"""Testes da casca visual dos e-mails.

O que importa aqui e compatibilidade com cliente de e-mail, nao estetica:
Outlook renderiza com o motor do Word e descarta o que nao for HTML de tabela
com estilo inline.
"""
import importlib
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
