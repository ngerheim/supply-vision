import importlib.util
import json
import subprocess
import sys
import types
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def carregar_pipeline(monkeypatch, tmp_path):
    fake = types.ModuleType("sv_paths")
    fake.OPERACAO = tmp_path
    fake.LOG_DIR = tmp_path
    fake.PIPELINE_TIMEOUT_S = 1
    fake.SCRIPT_BAIXAR = tmp_path / "baixar.py"
    fake.SCRIPT_RODAR = tmp_path / "rodar.py"
    fake.SCRIPT_EMAIL = tmp_path / "email.py"
    monkeypatch.setitem(sys.modules, "sv_paths", fake)
    spec = importlib.util.spec_from_file_location("pipeline_test", ROOT / "processo" / "pipeline.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    monkeypatch.setattr(mod.estado_entrega, "sv_paths", fake)
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


def test_extrai_total_de_linhas_comparaveis(monkeypatch, tmp_path):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    saida = "RESUMO_JSON=" + json.dumps({"total_elegivel": 0})
    assert mod.extrair_resumo(saida)["total_elegivel"] == 0


def test_conclusao_sem_dados_nao_executa_modulo_de_email(monkeypatch, tmp_path):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    chamadas = []

    monkeypatch.setattr(mod, "adquirir_lock", lambda: None)
    monkeypatch.setattr(mod, "configurar_log", lambda: str(tmp_path / "pipeline.log"))
    monkeypatch.setattr(
        mod,
        "rodar_script",
        lambda caminho, nome, args=None: chamadas.append(nome) or
        (True, "CONTEXTO_EMAIL=manha\nDATAS_EMAIL=14/09/2026\nRESULTADO=SEM_DADOS_QLIK"),
    )

    with pytest.raises(SystemExit) as saida:
        mod.main()

    assert saida.value.code == 0
    assert chamadas == ["Download Qlik (filtrado)"]


@pytest.mark.parametrize("saida_relatorios", [
    "RESULTADO=SEM_DADOS_FILTRO",
    "RESUMO_JSON=" + json.dumps({"total_elegivel": 0, "contagens": {}}),
    "RESUMO_JSON=" + json.dumps({
        "total_elegivel": 12,
        "contagens": {
            "CONFORME": 12,
            "ACIMA DO ACORDO": 0,
            "ABAIXO DO ACORDO": 0,
            "SEM ACORDO": 0,
        },
    }),
])
def test_conclusao_sem_linhas_nao_executa_modulo_de_email(
        monkeypatch, tmp_path, saida_relatorios):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    chamadas = []
    respostas = iter([
        (True, "CONTEXTO_EMAIL=parcial\nDATAS_EMAIL=15/09/2026"),
        (True, saida_relatorios),
    ])

    monkeypatch.setattr(mod, "adquirir_lock", lambda: None)
    monkeypatch.setattr(mod, "configurar_log", lambda: str(tmp_path / "pipeline.log"))
    monkeypatch.setattr(
        mod,
        "rodar_script",
        lambda caminho, nome, args=None: chamadas.append(nome) or next(respostas),
    )

    with pytest.raises(SystemExit) as saida:
        mod.main()

    assert saida.value.code == 0
    assert chamadas == ["Download Qlik (filtrado)", "Geração de relatórios"]


def test_pendencias_em_massa_nao_sao_silenciadas_sem_divergencias(monkeypatch, tmp_path):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    chamadas = []
    respostas = iter([(True, "CONTEXTO_EMAIL=parcial\nDATAS_EMAIL=15/09/2026"),
                      (True, "RESUMO_JSON=" + json.dumps({"total_elegivel": 0, "alerta_pendencias": True,
                       "contagens": {"ACIMA DO ACORDO": 0, "ABAIXO DO ACORDO": 0}})), (True, "")])
    monkeypatch.setattr(mod, "adquirir_lock", lambda: None)
    monkeypatch.setattr(mod, "configurar_log", lambda: str(tmp_path / "pipeline.log"))
    monkeypatch.setattr(mod, "rodar_script", lambda caminho, nome, args=None: chamadas.append(nome) or next(respostas))
    mod.main()
    assert chamadas[-1] == "Envio de e-mail"


def test_slot_e_lido_da_linha_de_comando(monkeypatch, tmp_path):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    assert mod.ler_slot_argv(["--slot", "08:00"]) == "08:00"
    assert mod.ler_slot_argv(["--sem-envio", "--slot=14:00"]) == "14:00"
    assert mod.ler_slot_argv([]) == ""


@pytest.mark.parametrize("estado,codigo", [("enviado", 0), ("incerto", 3), ("lock", 2)])
def test_saida_antecipada_tem_log_e_motivo(monkeypatch, tmp_path, caplog, estado, codigo):
    import logging
    mod = carregar_pipeline(monkeypatch, tmp_path)
    monkeypatch.delenv("SUPPLY_VISION_SEM_ENVIO", raising=False)
    monkeypatch.setattr(sys, "argv", ["pipeline.py"])
    eventos = []
    monkeypatch.setattr(mod, "configurar_log", lambda: eventos.append("log") or "teste.log")
    def lock():
        eventos.append("lock")
        if estado == "lock":
            raise RuntimeError("execucao em andamento")
    monkeypatch.setattr(mod, "adquirir_lock", lock)
    monkeypatch.setattr(mod.estado_entrega, "consultar_entrega", lambda: {"estado": estado})
    monkeypatch.setattr(mod, "rodar_script", lambda *a: pytest.fail("nao deve executar"))
    with caplog.at_level(logging.INFO), pytest.raises(SystemExit) as saida:
        mod.main()
    assert saida.value.code == codigo
    assert eventos == ["log", "lock"]
    assert ("CONCLUÍDO COM SUCESSO" in caplog.text) == (estado == "enviado")
    assert "Run ID:" in caplog.text
    assert "ERRO" in caplog.text or "ENTREGA JÁ CONFIRMADA" in caplog.text


@pytest.mark.skipif(sys.platform != "win32", reason="Lock nativo do Windows")
def test_probe_detecta_lock_sobrevivente_sem_executar_pipeline():
    codigo = "import pipeline,sys; pipeline.adquirir_lock(); print('pronto',flush=True); sys.stdin.read()"
    filho = subprocess.Popen([sys.executable, "-c", codigo], cwd=ROOT / "processo", stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert filho.stdout.readline().strip() == "pronto"
        probe = subprocess.run([sys.executable, str(ROOT / "processo/pipeline.py"), "--verificar-lock"], capture_output=True, timeout=15)
        assert probe.returncode == 2
    finally:
        filho.terminate(); filho.communicate(timeout=15)
    probe = subprocess.run([sys.executable, str(ROOT / "processo/pipeline.py"), "--verificar-lock"], capture_output=True, timeout=15)
    assert probe.returncode == 0
