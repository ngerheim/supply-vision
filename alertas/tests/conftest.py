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
    import os
    import shutil
    import tempfile

    # A suite usa apenas exemplos; nunca le configuracao empresarial do host.
    raiz = ROOT / "work" / "testes-temp"
    raiz.mkdir(parents=True, exist_ok=True)
    pasta = Path(tempfile.mkdtemp(prefix="sv-pytest-", dir=raiz))
    config._sv_pasta = pasta
    config._sv_ambiente = {k: os.environ.get(k) for k in
                          ("SUPPLY_VISION_PRIVADO", "SUPPLY_VISION_PARAMETROS_DIR")}
    os.environ["SUPPLY_VISION_PRIVADO"] = str(pasta / "privado")
    os.environ.pop("SUPPLY_VISION_PARAMETROS_DIR", None)
    privado = pasta / "privado"
    for origem, destino in [
        (RAIZ / "compartilhado/smtp.env.example", privado / "comum/smtp.env"),
        *[(ROOT / "config" / f"{nome}.exemplo.txt", privado / "alertas/config" / f"{nome}.txt")
          for nome in ("cfg_ambiente", "cfg_qlik", "destinatarios")],
        *[(origem, privado / "alertas/parametros" / origem.parent.name /
           origem.name.replace(".exemplo", "")) for origem in (ROOT / "parametros").rglob("*.exemplo.*")],
    ]:
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(origem, destino)
    if config.option.basetemp is None:
        config.option.basetemp = str(pasta / "casos")


def pytest_unconfigure(config):
    import os
    import shutil
    for chave, valor in getattr(config, "_sv_ambiente", {}).items():
        if valor is None:
            os.environ.pop(chave, None)
        else:
            os.environ[chave] = valor
    if hasattr(config, "_sv_pasta"):
        shutil.rmtree(config._sv_pasta, ignore_errors=True)


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
