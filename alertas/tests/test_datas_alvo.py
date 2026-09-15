import importlib.util
import sys
import types
from datetime import datetime
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def carregar_baixar_base(monkeypatch):
    monkeypatch.setitem(sys.modules, "contrato_base", types.ModuleType("contrato_base"))
    monkeypatch.setitem(sys.modules, "qlik", types.ModuleType("qlik"))
    paths = types.ModuleType("sv_paths")
    paths.CFG_QLIK = ROOT / "cfg.txt"
    paths.BASE_PATH = ROOT / "base.xlsx"
    paths.QLIK_APP_ID = "app"
    paths.QLIK_OBJ_ID = "obj"
    paths.QLIK_TENANT = "tenant"
    monkeypatch.setitem(sys.modules, "sv_paths", paths)
    spec = importlib.util.spec_from_file_location(
        "baixar_base_test", ROOT / "processo" / "baixar_base.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize(("agora", "contexto"), [
    (datetime(2026, 9, 17, 14, 0), "parcial"),
    (datetime(2026, 9, 17, 17, 0), "compilado"),
    (datetime(2026, 9, 18, 14, 0), "compilado"),
])
def test_ultimo_disparo_do_dia_e_compilado(monkeypatch, agora, contexto):
    mod = carregar_baixar_base(monkeypatch)

    class Relogio:
        @classmethod
        def now(cls):
            return agora

    monkeypatch.setattr(mod, "datetime", Relogio)
    _, obtido = mod.datas_alvo()
    assert obtido == contexto
