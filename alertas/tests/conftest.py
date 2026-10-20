import importlib.util
import os
import socket
import sys
import types
from datetime import date
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
RAIZ = ROOT.parent
sys.path.insert(0, str(ROOT / "processo"))


def pytest_configure(config):
    """Configura exemplos isolados antes da coleta, sem rede nem TEMP do perfil."""
    import shutil
    import tempfile

    # A suite usa apenas exemplos; nunca le configuracao empresarial do host.
    raiz = ROOT / "work" / "testes-temp"
    raiz.mkdir(parents=True, exist_ok=True)
    pasta = Path(tempfile.mkdtemp(prefix="sv-pytest-", dir=raiz))
    config._sv_pasta = pasta
    protecao = config._sv_protecao = pytest.MonkeyPatch()
    protecao.setenv("SUPPLY_VISION_PRIVADO", str(pasta / "privado"))
    protecao.delenv("SUPPLY_VISION_PARAMETROS_DIR", raising=False)
    protecao.setenv("MODO_ENSAIO", "1")
    for chave in ("SUPPLY_VISION_RUN_ID", "SUPPLY_VISION_SEM_ENVIO",
                  "SV_ALERTA_SLOT", "SV_ALERTA_DATA"):
        protecao.delenv(chave, raising=False)
    # Ativo tambem durante a coleta. Os doubles substituem os clientes, nunca
    # esta barreira; uma fixture incompleta falha antes de DNS/TCP/UDP reais.
    def sem_rede(*args, **kwargs):
        raise AssertionError("Rede bloqueada na suite de Alertas; use um double")
    for nome in ("connect", "connect_ex", "sendto"):
        protecao.setattr(socket.socket, nome, sem_rede)
    protecao.setattr(socket, "create_connection", sem_rede)
    protecao.setattr(socket, "getaddrinfo", sem_rede)
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
    import shutil
    if hasattr(config, "_sv_protecao"):
        config._sv_protecao.undo()
    if hasattr(config, "_sv_pasta"):
        shutil.rmtree(config._sv_pasta, ignore_errors=True)


@pytest.fixture(autouse=True)
def isolar_execucao(monkeypatch):
    """Restaura inclusive alteracoes diretas feitas por pipeline/imports."""
    ambiente = os.environ.copy()
    nomes = {p.stem for pasta in (ROOT / "processo", ROOT / "panorama")
             for p in pasta.glob("*.py")} | {"parametros", "parametros._dados"}
    modulos = {nome: sys.modules[nome] for nome in nomes if nome in sys.modules}
    monkeypatch.setattr(sys, "path", sys.path.copy())
    monkeypatch.setattr(sys, "dont_write_bytecode", sys.dont_write_bytecode)
    monkeypatch.setattr(sys, "argv", ["pytest"])
    try:
        yield
    finally:
        for nome in nomes:
            if nome in modulos:
                sys.modules[nome] = modulos[nome]
            else:
                sys.modules.pop(nome, None)
        os.environ.clear()
        os.environ.update(ambiente)


@pytest.fixture
def abrir_planilha(request):
    from openpyxl import load_workbook
    def abrir(*args, **kwargs):
        wb = load_workbook(*args, **kwargs)
        request.addfinalizer(wb.close)
        return wb
    return abrir


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

    for nome in ("contrato_comparacao", "leitura_dados", "vigencia_acordos",
                 "qualidade_acordos", "regras_comparacao", "resumo_comparacao",
                 "planilhas_comparacao"):
        monkeypatch.delitem(sys.modules, nome, raising=False)

    spec = importlib.util.spec_from_file_location(
        "rodar_test", ROOT / "processo" / "rodar.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
