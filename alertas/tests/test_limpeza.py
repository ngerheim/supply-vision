"""Testes da extração de timestamp usada pela limpeza.

O caso central aqui é o recorte por período, cujo nome carrega DUAS datas:
o intervalo consultado e, depois, o instante de geração. Ler a data errada
fez a limpeza apagar, em 11/09/2026, um arquivo gerado no mesmo dia.
"""
import importlib
import sys
from datetime import datetime
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "processo"))

limpeza = importlib.import_module("limpeza")


@pytest.mark.parametrize("nome,esperado", [
    # Recorte por periodo: o timestamp correto e o SEGUNDO do nome.
    ("sem_acordo_periodo_20250101-20251231_20260911_104606_742513.xlsx",
     datetime(2026, 9, 11, 10, 46, 6)),
    ("com_acordo_periodo_20240301-20240331_20260815_093000_abc123.xlsx",
     datetime(2026, 8, 15, 9, 30, 0)),
    # Relatorio diario: timestamp com segundos e sufixo de hash.
    ("com_acordo_20260911_120225_f7402d.xlsx", datetime(2026, 9, 11, 12, 2, 25)),
    ("qualidade_acordos_20260910_170000_611b10.csv", datetime(2026, 9, 10, 17, 0, 0)),
    # Log: timestamp so com minutos, sem sufixo.
    ("limpeza_20260911_1305.log", datetime(2026, 9, 11, 13, 5)),
    ("pipeline_20260911_0800.log", datetime(2026, 9, 11, 8, 0)),
])
def test_extrai_timestamp_de_geracao(nome, esperado):
    assert limpeza.extrair_timestamp(nome) == esperado


@pytest.mark.parametrize("nome", [
    ".gitkeep",
    "pipeline.lock",
    "base_periodo.xlsx",
    "relatorio_sem_data.xlsx",
    "20260911_1200_sem_prefixo_no_fim.xlsx",
])
def test_nome_sem_timestamp_no_fim_nao_e_tocado(nome):
    assert limpeza.extrair_timestamp(nome) is None


def test_intervalo_do_periodo_nunca_e_usado_como_geracao():
    """Regressao do incidente: o fim do intervalo (31/12/2025) nao pode
    virar a data de geracao."""
    nome = "sem_acordo_periodo_20250101-20251231_20260911_104606_742513.xlsx"
    dt = limpeza.extrair_timestamp(nome)
    assert dt.year == 2026
    assert dt != datetime(2025, 12, 31, 20, 26, 9)


def test_arquivo_so_com_data_no_fim_e_reconhecido():
    """Regressao da auditoria: nomes terminados so em _AAAAMMDD ficavam fora
    da limpeza para sempre."""
    dt = limpeza.extrair_timestamp("qualidade_acordos_validacao_template_20260911.csv")
    assert dt == datetime(2026, 9, 11, 0, 0, 0)


def test_data_no_fim_nao_atrapalha_o_padrao_com_hora():
    """O padrao completo continua tendo prioridade sobre o de data pura."""
    assert limpeza.extrair_timestamp("com_acordo_20260911_120225_f7402d.xlsx") == datetime(2026, 9, 11, 12, 2, 25)
    assert limpeza.extrair_timestamp("pipeline_20260911_1305.log") == datetime(2026, 9, 11, 13, 5)


def test_recorte_por_periodo_nao_casa_com_a_data_do_intervalo():
    """O intervalo termina em -20251231, sem underscore antes, e nao pode
    ser confundido com o padrao de data pura."""
    dt = limpeza.extrair_timestamp("sem_acordo_periodo_20250101-20251231_20260911_104606_742513.xlsx")
    assert dt == datetime(2026, 9, 11, 10, 46, 6)
