import importlib.util
import sys
import types
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def rodar(monkeypatch, tmp_path):
    fake_paths = types.ModuleType("sv_paths")
    fake_paths.BASE_PATH = tmp_path / "base.xlsx"
    fake_paths.ACORDO_PATH = tmp_path / "acordos.xlsx"
    fake_paths.REPORTS = tmp_path / "reports"
    fake_paths.PARAMETROS_SRC = ROOT
    monkeypatch.setitem(sys.modules, "sv_paths", fake_paths)

    fake_contrato = types.ModuleType("contrato_base")
    fake_contrato.COLUNAS = []
    monkeypatch.setitem(sys.modules, "contrato_base", fake_contrato)

    dados_spec = importlib.util.spec_from_file_location(
        "parametros_dados_test", ROOT / "parametros" / "_dados.py"
    )
    dados_module = importlib.util.module_from_spec(dados_spec)
    dados_spec.loader.exec_module(dados_module)
    normalizar = dados_module.normalizar
    fake_parametros = types.ModuleType("parametros")
    fake_parametros.FORNECEDORES_EXCLUIR = set()
    fake_parametros.GRUPOS_EXCLUIR = set()
    fake_parametros.ITENS_EXCLUIR = set()
    fake_parametros.MODELOS = {}
    fake_parametros.MODELOS_EXCLUIR = set()
    fake_parametros.SINONIMOS = {}
    fake_parametros.normalizar = normalizar
    monkeypatch.setitem(sys.modules, "parametros", fake_parametros)

    spec = importlib.util.spec_from_file_location("rodar_test", ROOT / "processo" / "rodar.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
