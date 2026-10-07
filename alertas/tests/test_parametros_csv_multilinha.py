import importlib.util
from pathlib import Path


def carregar(tmp_path, monkeypatch):
    caminho = Path(__file__).parents[1] / 'parametros' / '_dados.py'
    spec = importlib.util.spec_from_file_location('dados_multilinha', caminho)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, 'DE_PARA', tmp_path)
    monkeypatch.setattr(mod, 'CONTAGENS', tmp_path / '.contagens.json')
    return mod


def test_csv_preserva_quebras_comentarios_e_aspas(tmp_path, monkeypatch):
    mod = carregar(tmp_path, monkeypatch)
    (tmp_path / 'itens.csv').write_text(
        '# comentário\nde;para;ativo\n"SERVICO\n\n# INTERNO";"TROCA\nDE \"\"OLEO\"\"";Sim\n',
        encoding='utf-8-sig',
    )
    assert mod.carregar_de_para('itens.csv', 'de', 'para', registrar=False) == {
        'SERVICO # INTERNO': 'TROCA\nDE "OLEO"',
    }
