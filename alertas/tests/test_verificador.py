import importlib.util
import sys
import types
from datetime import date, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def carregar_verificador(monkeypatch, tmp_path):
    fake = types.ModuleType("sv_paths")
    fake.LOG_DIR = tmp_path
    fake.SMTP_SERVIDOR = "smtp.example.com"
    fake.SMTP_PORTA = 587
    fake.SMTP_USUARIO = "teste@example.com"
    fake.SMTP_SENHA = "segredo-teste"
    fake.NOME_REMETENTE = "Portal Suprimentos"
    fake.REMETENTE = "teste@example.com"
    fake.DESTINATARIO_ALERTA = "alerta@example.com"
    fake.QLIK_TENANT = "tenant.example.com"
    fake.CHAVE_QLIK_EXPIRA = date(2027, 6, 23)
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


def test_execucao_recuperada_fora_da_janela_e_encontrada_pelo_run_id(monkeypatch, tmp_path):
    mod = carregar_verificador(monkeypatch, tmp_path)
    hoje = datetime.now().strftime("%Y%m%d")
    run_id = f"{hoje}_082822_abcdef"
    recuperado = tmp_path / f"pipeline_{run_id}.log"
    recuperado.write_text("PIPELINE CONCLUÍDO COM SUCESSO", encoding="utf-8")
    assert mod.encontrar_log("0800") is None
    assert mod.encontrar_log("0800", run_id) == recuperado


def test_run_id_exato_nao_aceita_outro_log(monkeypatch, tmp_path):
    mod = carregar_verificador(monkeypatch, tmp_path)
    hoje = datetime.now().strftime("%Y%m%d")
    (tmp_path / f"pipeline_{hoje}_080000_outro1.log").write_text("ok", encoding="utf-8")
    assert mod.encontrar_log("0800", f"{hoje}_082822_abcdef") is None
