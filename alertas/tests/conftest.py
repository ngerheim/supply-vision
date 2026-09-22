import importlib.util
import sys
import types
from datetime import date
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
RAIZ = ROOT.parent
sys.path.insert(0, str(ROOT / "processo"))


def pytest_configure(config):
    """Evita o TEMP do perfil, que pode ser somente leitura no servidor.

    A pasta era fixa, e o pytest apaga a basetemp inteira ao comecar: bastou
    um diretorio remanescente sem permissao para a suite inteira passar a dar
    erro de setup em todos os testes. Agora cada execucao tem a sua, e se a
    area nao estiver utilizavel o pytest volta ao comportamento padrao.
    """
    if config.option.basetemp is not None:
        return
    import os
    import shutil
    import time

    raiz = RAIZ / "privado" / "testes-temp"
    try:
        raiz.mkdir(parents=True, exist_ok=True)
        pasta = raiz / f"pytest-alertas-{os.getpid()}-{int(time.time())}"
        pasta.mkdir()
    except OSError:
        return  # sem acesso: o pytest usa o TEMP do perfil

    # Restos de execucoes anteriores, sem deixar que uma pasta travada
    # atrapalhe a execucao atual.
    limite = time.time() - 24 * 3600
    for antiga in raiz.glob("pytest-alertas*"):
        try:
            if antiga != pasta and antiga.stat().st_mtime < limite:
                shutil.rmtree(antiga, ignore_errors=True)
        except OSError:
            pass

    config.option.basetemp = str(pasta)


@pytest.fixture
def rodar(monkeypatch, tmp_path):
    fake_paths = types.ModuleType("sv_paths")
    fake_paths.BASE_PATH = tmp_path / "base.xlsx"
    fake_paths.PORTAL_URL = "http://127.0.0.1:3000"
    fake_paths.PORTAL_API_TOKEN = "token-teste"
    fake_paths.RELATORIOS_DIARIOS = tmp_path / "reports"
    fake_paths.PARAMETROS_SRC = ROOT
    fake_paths.CORTE_VIGENCIA_ACORDOS = date(2026, 9, 18)
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

    spec = importlib.util.spec_from_file_location(
        "rodar_test", ROOT / "processo" / "rodar.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
