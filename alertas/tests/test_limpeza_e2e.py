"""Teste ponta a ponta da limpeza, em pasta temporária.

Monta uma árvore real (logs e relatórios diários/históricos), cria arquivos com
timestamps controlados no NOME e verifica o que sobrevive a cada política.
Nada aqui depende de mtime: a idade vem do nome, como em produção.
"""
import importlib
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "processo"))

limpeza = importlib.import_module("limpeza")
sv_paths = importlib.import_module("sv_paths")

AGORA = datetime.now()


def ts(delta: timedelta, segundos: bool = True) -> str:
    momento = AGORA - delta
    return momento.strftime("%Y%m%d_%H%M%S" if segundos else "%Y%m%d_%H%M")


@pytest.fixture
def arvore(tmp_path, monkeypatch):
    """Redireciona o sv_paths para uma árvore descartável."""
    logs = tmp_path / "logs"
    diarios = tmp_path / "relatorios" / "diarios"
    historicos = tmp_path / "relatorios" / "historicos"
    for p in (logs, diarios / "com_acordo", diarios / "sem_acordo",
              historicos / "legado"):
        p.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(sv_paths, "LOG_DIR", logs)
    monkeypatch.setattr(sv_paths, "RELATORIOS_DIARIOS", diarios)
    monkeypatch.setattr(sv_paths, "RELATORIOS_HISTORICOS", historicos)
    monkeypatch.setattr(sv_paths, "ALERTAS", tmp_path)
    return {"logs": logs, "diarios": diarios, "historicos": historicos}


def criar(pasta: Path, nome: str) -> Path:
    alvo = pasta / nome
    alvo.write_text("conteudo", encoding="utf-8")
    return alvo


def test_planilha_com_23h59_permanece(arvore):
    novo = criar(arvore["diarios"] / "com_acordo",
                 f"com_acordo_{ts(timedelta(hours=23, minutes=59))}_abc123.xlsx")
    limpeza.limpar(dry_run=False)
    assert novo.exists(), "planilha dentro da janela de 24h nao pode ser apagada"


def test_planilha_com_mais_de_24h_e_apagada(arvore):
    velho = criar(arvore["diarios"] / "sem_acordo",
                  f"sem_acordo_{ts(timedelta(hours=24, minutes=30))}_abc123.xlsx")
    limpeza.limpar(dry_run=False)
    assert not velho.exists(), "planilha fora da janela de 24h deveria ter sido apagada"


def test_log_com_menos_de_cinco_dias_permanece(arvore):
    recente = criar(arvore["logs"], f"pipeline_{ts(timedelta(days=4, hours=23), segundos=False)}.log")
    limpeza.limpar(dry_run=False)
    assert recente.exists(), "log com menos de 5 dias nao pode ser apagado"


def test_log_com_mais_de_cinco_dias_e_apagado(arvore):
    velho = criar(arvore["logs"], f"pipeline_{ts(timedelta(days=5, hours=1), segundos=False)}.log")
    limpeza.limpar(dry_run=False)
    assert not velho.exists(), "log fora da janela de 5 dias deveria ter sido apagado"


def test_log_nao_segue_a_regra_de_24h(arvore):
    """Regressao: log de 2 dias sobrevive, planilha de 2 dias nao."""
    log = criar(arvore["logs"], f"limpeza_{ts(timedelta(days=2), segundos=False)}.log")
    planilha = criar(arvore["diarios"] / "com_acordo", f"com_acordo_{ts(timedelta(days=2))}_abc123.xlsx")
    limpeza.limpar(dry_run=False)
    assert log.exists()
    assert not planilha.exists()


@pytest.mark.parametrize("nome", [".gitkeep", "pipeline.lock", "base_periodo.xlsx"])
def test_arquivo_sem_timestamp_nunca_e_apagado(arvore, nome):
    protegido = criar(arvore["diarios"] / "com_acordo", nome)
    limpeza.limpar(dry_run=False)
    assert protegido.exists(), f"{nome} nao tem timestamp e jamais pode ser apagado"


def test_recorte_por_periodo_usa_a_data_de_geracao(arvore):
    """Regressao do incidente: o intervalo no nome (2025) nao pode ser lido
    como data de geracao. O arquivo foi gerado agora e deve sobreviver."""
    recorte = criar(arvore["historicos"],
                    f"sem_acordo_periodo_20250101-20251231_{ts(timedelta(minutes=5))}_742513.xlsx")
    limpeza.limpar(dry_run=False)
    assert recorte.exists(), "recorte recem-gerado foi apagado pela data do intervalo"


def test_recorte_por_periodo_antigo_e_apagado(arvore):
    """O contrario tambem precisa valer: gerado ha 3 dias, sai."""
    recorte = criar(arvore["historicos"] / "legado",
                    f"sem_acordo_periodo_20250101-20251231_{ts(timedelta(days=3))}_742513.xlsx")
    limpeza.limpar(dry_run=False)
    assert not recorte.exists()


def test_dry_run_nao_remove_nada(arvore):
    alvos = [
        criar(arvore["diarios"] / "sem_acordo", f"sem_acordo_{ts(timedelta(days=9))}_abc123.xlsx"),
        criar(arvore["logs"], f"pipeline_{ts(timedelta(days=30), segundos=False)}.log"),
        criar(arvore["historicos"] / "legado",
              f"sem_acordo_periodo_20250101-20251231_{ts(timedelta(days=40))}_742513.xlsx"),
    ]
    limpeza.limpar(dry_run=True)
    for alvo in alvos:
        assert alvo.exists(), f"dry-run apagou {alvo.name}"


def test_execucao_real_apaga_os_mesmos_alvos_do_dry_run(arvore):
    alvo = criar(arvore["logs"], f"pipeline_{ts(timedelta(days=30), segundos=False)}.log")
    limpeza.limpar(dry_run=True)
    assert alvo.exists()
    limpeza.limpar(dry_run=False)
    assert not alvo.exists()
