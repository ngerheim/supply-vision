import importlib.util
import sys
import types
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def carregar_verificador(monkeypatch, tmp_path):
    fake = types.ModuleType("sv_paths")
    fake.LOG_DIR = tmp_path
    fake.SMTP_SERVIDOR = "smtp.example.com"
    fake.SMTP_PORTA = 587
    fake.SMTP_USUARIO = "teste@example.com"
    fake.CFG_SMTP = tmp_path / "smtp.txt"
    fake.REMETENTE = "teste@example.com"
    fake.DESTINATARIO_ALERTA = "alerta@example.com"
    fake.QLIK_TENANT = "tenant.example.com"
    fake.TAREFA_RELATORIO = "Supply Vision"
    monkeypatch.setitem(sys.modules, "sv_paths", fake)
    spec = importlib.util.spec_from_file_location(
        "verificador_test", ROOT / "processo" / "verificar_saude.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_encontra_log_legado_e_log_com_run_id(monkeypatch, tmp_path):
    mod = carregar_verificador(monkeypatch, tmp_path)
    hoje = datetime.now().strftime("%Y%m%d")
    legado = tmp_path / f"pipeline_{hoje}_0800.log"
    novo = tmp_path / f"pipeline_{hoje}_120000_abcdef.log"
    legado.write_text("ok", encoding="utf-8")
    novo.write_text("ok", encoding="utf-8")
    assert mod.encontrar_log("0800") == legado
    assert mod.encontrar_log("1200") == novo


def test_execucao_manual_fora_da_janela_nao_mascara_falha(monkeypatch, tmp_path):
    mod = carregar_verificador(monkeypatch, tmp_path)
    hoje = datetime.now().strftime("%Y%m%d")
    (tmp_path / f"pipeline_{hoje}_120500_abcdef.log").write_text("ok", encoding="utf-8")
    assert mod.encontrar_log("1200") is None
