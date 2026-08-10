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
    fake.CFG_SMTP = tmp_path / "smtp.txt"; fake.DESTINATARIOS = dest
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
        mod.anexo_da_execucao(tmp_path / "ausente.xlsx", "pendencias")


def test_email_so_com_quarentena_explica_que_nada_foi_comparavel(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    corpo = mod.montar_corpo("parcial", ["01/08/2026"], resumo(), pendencias="p.xlsx")
    assert "nenhuma linha ficou comparável" in corpo.lower()
    assert "nenhum item do período casou" not in corpo.lower()
