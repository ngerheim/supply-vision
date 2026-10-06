import importlib.util
import sys
import types
from datetime import date, datetime
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


def fixar_relogio(monkeypatch, mod, agora):
    class Relogio(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(agora.year, agora.month, agora.day, agora.hour, agora.minute)

    monkeypatch.setattr(mod, "datetime", Relogio)


def test_segunda_de_manha_inclui_domingo(monkeypatch):
    mod = carregar_baixar_base(monkeypatch)
    fixar_relogio(monkeypatch, mod, datetime(2026, 10, 5, 8, 0))  # segunda
    datas, contexto = mod.datas_alvo()
    assert contexto == "segunda_manha"
    assert datas == [date(2026, 10, 2), date(2026, 10, 3), date(2026, 10, 4)]


def test_nova_tentativa_as_10h05_do_slot_das_8h_busca_dia_anterior(monkeypatch):
    mod = carregar_baixar_base(monkeypatch)
    fixar_relogio(monkeypatch, mod, datetime(2026, 10, 7, 10, 5))  # quarta
    datas, contexto = mod.datas_alvo(slot=(8, 0))
    assert (datas, contexto) == ([date(2026, 10, 6)], "manha")


def test_sem_slot_mantem_comportamento_pelo_relogio(monkeypatch):
    mod = carregar_baixar_base(monkeypatch)
    fixar_relogio(monkeypatch, mod, datetime(2026, 10, 7, 10, 5))
    assert mod.datas_alvo() == ([date(2026, 10, 7)], "parcial")
    assert mod.datas_alvo(slot=None) == ([date(2026, 10, 7)], "parcial")


@pytest.mark.parametrize(("argv", "env", "esperado"), [
    (["--slot", "08:00"], {}, (8, 0)),
    (["--slot=17:00"], {}, (17, 0)),
    ([], {"SV_ALERTA_SLOT": "11:00"}, (11, 0)),
    ([], {}, None),
    (["--slot", "25:00"], {}, None),
])
def test_ler_slot(monkeypatch, argv, env, esperado):
    mod = carregar_baixar_base(monkeypatch)
    assert mod.ler_slot(argv, env) == esperado
