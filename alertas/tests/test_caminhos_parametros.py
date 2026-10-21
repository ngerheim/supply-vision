import runpy
from pathlib import Path


def test_parametros_seguem_raiz_privada(monkeypatch, tmp_path):
    monkeypatch.setenv('SUPPLY_VISION_PRIVADO', str(tmp_path))
    monkeypatch.delenv('SUPPLY_VISION_PARAMETROS_DIR', raising=False)
    dados = runpy.run_path(str(Path(__file__).parents[1] / 'parametros' / '_dados.py'))
    assert dados['BASE'] == tmp_path / 'alertas' / 'parametros'


def test_override_especifico_tem_precedencia(monkeypatch, tmp_path):
    monkeypatch.setenv('SUPPLY_VISION_PRIVADO', str(tmp_path / 'privado'))
    monkeypatch.setenv('SUPPLY_VISION_PARAMETROS_DIR', str(tmp_path / 'parametros'))
    dados = runpy.run_path(str(Path(__file__).parents[1] / 'parametros' / '_dados.py'))
    assert dados['BASE'] == tmp_path / 'parametros'


def test_padrao_permanece_compativel(monkeypatch):
    monkeypatch.delenv('SUPPLY_VISION_PRIVADO', raising=False)
    monkeypatch.delenv('SUPPLY_VISION_PARAMETROS_DIR', raising=False)
    arquivo = Path(__file__).parents[1] / 'parametros' / '_dados.py'
    dados = runpy.run_path(str(arquivo))
    assert dados['BASE'] == arquivo.parents[2] / 'privado' / 'alertas' / 'parametros'
