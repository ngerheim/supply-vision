import importlib.util
import subprocess
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def carregar_pipeline(monkeypatch, tmp_path):
    fake = types.ModuleType("sv_paths")
    fake.LOG_DIR = tmp_path
    fake.PIPELINE_TIMEOUT_S = 1
    fake.SCRIPT_BAIXAR = tmp_path / "baixar.py"
    fake.SCRIPT_RODAR = tmp_path / "rodar.py"
    fake.SCRIPT_EMAIL = tmp_path / "email.py"
    monkeypatch.setitem(sys.modules, "sv_paths", fake)
    spec = importlib.util.spec_from_file_location("pipeline_test", ROOT / "processo" / "pipeline.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def test_extrai_apenas_relatorio_de_divergencias(monkeypatch, tmp_path):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    output = "RELATORIO_COM_ACORDO=a.xlsx\nRELATORIO_SEM_ACORDO=b.xlsx"
    assert mod.extrair_relatorio(output) == "a.xlsx"


def test_marcadores_antigos_sao_ignorados(monkeypatch, tmp_path):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    output = "RELATORIO_COM_ACORDO=a.xlsx\nRELATORIO_SEM_ACORDO=b.xlsx\nRELATORIO_PENDENCIAS=c.xlsx"
    assert mod.extrair_relatorio(output) == "a.xlsx"


def test_timeout_vira_falha_controlada(monkeypatch, tmp_path):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    def expira(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], timeout=1, output="parcial")
    monkeypatch.setattr(subprocess, "run", expira)
    ok, output = mod.rodar_script("preso.py", "preso")
    assert ok is False
    assert output == "parcial"


def test_qualidade_so_e_anexada_quando_ha_pendencias(monkeypatch, tmp_path):
    """O rodar.py so emite RELATORIO_QUALIDADE_ACORDOS quando ha algo a
    corrigir. Sem o marcador, o pipeline nao deve inventar um anexo."""
    mod = carregar_pipeline(monkeypatch, tmp_path)
    sem_pendencia = "RELATORIO_COM_ACORDO=a.xlsx"
    assert mod.extrair_qualidade(sem_pendencia) == ""

    com_pendencia = "RELATORIO_COM_ACORDO=a.xlsx\nRELATORIO_QUALIDADE_ACORDOS=q.csv"
    assert mod.extrair_qualidade(com_pendencia) == "q.csv"


def test_qualidade_nao_interfere_no_anexo_de_divergencias(monkeypatch, tmp_path):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    saida = "RELATORIO_QUALIDADE_ACORDOS=q.csv\nRELATORIO_COM_ACORDO=a.xlsx"
    assert mod.extrair_relatorio(saida) == "a.xlsx"
    assert mod.extrair_qualidade(saida) == "q.csv"
