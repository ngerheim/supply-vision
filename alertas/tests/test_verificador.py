import importlib.util
import sys
import types
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
AGORA = datetime(2026, 10, 20, 12, 0)


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
    fake.CFG_QLIK = tmp_path / "alertas/config/cfg_qlik.txt"
    fake.CHAVE_QLIK_EXPIRA = date(2027, 6, 23)
    monkeypatch.setitem(sys.modules, "sv_paths", fake)
    spec = importlib.util.spec_from_file_location(
        "verificador_test", ROOT / "processo" / "verificar_saude.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    class Relogio(datetime):
        @classmethod
        def now(cls):
            return AGORA
    class Dia(date):
        @classmethod
        def today(cls):
            return AGORA.date()
    monkeypatch.setattr(mod, 'datetime', Relogio)
    monkeypatch.setattr(mod, 'date', Dia)
    return mod


def test_encontra_log_legado_e_log_com_run_id(monkeypatch, tmp_path):
    mod = carregar_verificador(monkeypatch, tmp_path)
    hoje = AGORA.strftime("%Y%m%d")
    legado = tmp_path / f"pipeline_{hoje}_0800.log"
    novo = tmp_path / f"pipeline_{hoje}_120000_abcdef.log"
    legado.write_text("ok", encoding="utf-8")
    novo.write_text("ok", encoding="utf-8")
    assert mod.encontrar_log("0800") == legado
    assert mod.encontrar_log("1200") == novo


def test_execucao_manual_fora_da_janela_nao_mascara_falha(monkeypatch, tmp_path):
    mod = carregar_verificador(monkeypatch, tmp_path)
    hoje = AGORA.strftime("%Y%m%d")
    (tmp_path / f"pipeline_{hoje}_120500_abcdef.log").write_text("ok", encoding="utf-8")
    assert mod.encontrar_log("1200") is None


def test_execucao_recuperada_fora_da_janela_e_encontrada_pelo_run_id(monkeypatch, tmp_path):
    mod = carregar_verificador(monkeypatch, tmp_path)
    hoje = AGORA.strftime("%Y%m%d")
    run_id = f"{hoje}_082822_abcdef"
    recuperado = tmp_path / f"pipeline_{run_id}.log"
    recuperado.write_text("PIPELINE CONCLUÍDO COM SUCESSO", encoding="utf-8")
    assert mod.encontrar_log("0800") is None
    assert mod.encontrar_log("0800", run_id) == recuperado


def test_run_id_exato_nao_aceita_outro_log(monkeypatch, tmp_path):
    mod = carregar_verificador(monkeypatch, tmp_path)
    hoje = AGORA.strftime("%Y%m%d")
    (tmp_path / f"pipeline_{hoje}_080000_outro1.log").write_text("ok", encoding="utf-8")
    assert mod.encontrar_log("0800", f"{hoje}_082822_abcdef") is None


@pytest.mark.parametrize('dias', [0, 1])
def test_aviso_da_chave_indica_arquivo_privado_configurado(monkeypatch, tmp_path, dias):
    mod = carregar_verificador(monkeypatch, tmp_path)
    monkeypatch.setattr(mod, 'CHAVE_QLIK_EXPIRA', AGORA.date() + timedelta(days=dias))
    mensagens = []
    monkeypatch.setattr(mod, '_enviar_email', lambda assunto, corpo: mensagens.append(corpo))
    mod.checar_expiracao_chave('0800')
    assert len(mensagens) == 1
    assert str(mod.sv_paths.CFG_QLIK) in mensagens[0]
    assert 'README' not in mensagens[0]
