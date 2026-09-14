import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def carregar_email(monkeypatch, tmp_path):
    dest = tmp_path / "destinatarios.txt"
    dest.write_text("[PARA]\nteste@example.com\n", encoding="utf-8")
    fake = types.ModuleType("sv_paths")
    fake.SMTP_SERVIDOR = "smtp.example.com"; fake.SMTP_PORTA = 587
    fake.SMTP_USUARIO = "teste@example.com"; fake.REMETENTE = "teste@example.com"
    fake.SMTP_SENHA = "segredo-teste"; fake.NOME_REMETENTE = "Portal Suprimentos"; fake.DESTINATARIOS = dest; fake.RELATORIOS_DIARIOS = tmp_path / "relatorios"
    monkeypatch.setitem(sys.modules, "sv_paths", fake)
    spec = importlib.util.spec_from_file_location("email_test", ROOT / "processo" / "enviar_email.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def resumo(**mudancas):
    r = {"total_bruto": 1, "total_elegivel": 0, "total_quarentena": 1,
         "contagens": {"CONFORME": 0, "ACIMA DO ACORDO": 0, "ABAIXO DO ACORDO": 0,
                       "SEM ACORDO": 0, "ACORDO AMBÍGUO": 1,
                       "ACORDO SEM PREÇO VÁLIDO": 0},
         "percentuais_elegiveis": {"CONFORME": 0, "ACIMA DO ACORDO": 0,
                                    "ABAIXO DO ACORDO": 0, "SEM ACORDO": 0},
         "percentual_quarentena_bruto": 100.0, "alerta_sem_acordo": False,
         "limite_alerta_sem_acordo": 75.0, "comparavel": False}
    r.update(mudancas)
    return "RESUMO_JSON=" + json.dumps(r, ensure_ascii=False)


def test_anexo_informado_e_ausente_aborta(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    with pytest.raises(mod.RelatorioAusente):
        mod.anexo_da_execucao(tmp_path / "ausente.xlsx", "com_acordo")


def test_corpo_conta_apenas_registros_fora_do_acordo(monkeypatch, tmp_path):
    """O corpo diz quantos registros estao fora do acordo — acima + abaixo."""
    mod = carregar_email(monkeypatch, tmp_path)
    dados = resumo(contagens={"CONFORME": 10, "ACIMA DO ACORDO": 3,
                              "ABAIXO DO ACORDO": 2, "SEM ACORDO": 5,
                              "ACORDO AMBÍGUO": 0, "ACORDO SEM PREÇO VÁLIDO": 0})
    corpo = mod.montar_corpo("parcial", ["01/08/2026"], dados)
    assert "5 registros fora do acordo" in corpo


def test_corpo_no_singular_quando_ha_um_registro(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    dados = resumo(contagens={"CONFORME": 0, "ACIMA DO ACORDO": 1,
                              "ABAIXO DO ACORDO": 0, "SEM ACORDO": 0,
                              "ACORDO AMBÍGUO": 0, "ACORDO SEM PREÇO VÁLIDO": 0})
    corpo = mod.montar_corpo("parcial", ["01/08/2026"], dados)
    assert "1 registro fora do acordo" in corpo
    assert "1 registros" not in corpo


def test_corpo_sem_divergencia_nao_menciona_anexo(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    corpo = mod.montar_corpo("parcial", ["01/08/2026"], resumo())
    assert "Nenhum registro fora do acordo" in corpo
    assert "anexo" not in corpo.lower()


def test_corpo_nao_traz_mais_a_analise(monkeypatch, tmp_path):
    """Regressao: a analise migrou para o recorte historico. O corpo nao pode
    voltar a carregar tabela, percentuais, filtros ou alerta de cobertura."""
    mod = carregar_email(monkeypatch, tmp_path)
    dados = resumo(total_bruto=22, total_elegivel=22, comparavel=True,
                   alerta_sem_acordo=True,
                   contagens={"CONFORME": 0, "ACIMA DO ACORDO": 0,
                              "ABAIXO DO ACORDO": 0, "SEM ACORDO": 22,
                              "ACORDO AMBÍGUO": 0, "ACORDO SEM PREÇO VÁLIDO": 0})
    corpo = mod.montar_corpo("parcial", ["14/09/2026"], dados)
    for proibido in ["RESUMO", "FILTROS APLICADOS", "ALERTA", "Total bruto",
                     "elegíveis", "Pendências", "Olá"]:
        assert proibido not in corpo, f"corpo voltou a conter '{proibido}'"
    assert len(corpo.strip().splitlines()) == 1


def test_avisos_sao_de_uma_linha(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    assunto, corpo = mod.montar_aviso("SEM_DADOS_QLIK", ["01/08/2026"])
    assert "Sem dados no Qlik" in assunto
    assert corpo.strip() == "Não havia dados no Qlik para 01/08/2026."

    assunto, corpo = mod.montar_aviso("SEM_DADOS_FILTRO", ["01/08/2026"])
    assert "Nada dentro dos filtros" in assunto
    assert corpo.strip() == "Não havia nada dentro dos filtros para 01/08/2026."


def test_modo_sem_envio_salva_preview_sem_abrir_smtp(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    monkeypatch.setenv("SUPPLY_VISION_SEM_ENVIO", "1")
    monkeypatch.setenv("SUPPLY_VISION_RUN_ID", "teste-paralelo")
    monkeypatch.setattr(mod.smtplib, "SMTP", lambda *a, **k: (_ for _ in ()).throw(AssertionError("SMTP nao deveria abrir")))
    destino = mod.enviar_email("Teste", "Corpo", [], ["teste@example.com"])
    assert destino.is_file()
    assert b"Subject: Teste" in destino.read_bytes()
