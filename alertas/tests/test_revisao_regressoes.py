import numpy as np
import pandas as pd
import pytest
from test_regras import acordo, base, com_vigencia


def test_sucessao_de_precos_nao_gera_ambiguidade(rodar, tmp_path, capsys):
    acordos = pd.concat([
        com_vigencia(acordo([10]), inicio="2026-09-18", fim="2026-09-30"),
        com_vigencia(acordo([20]), inicio="2026-10-01"),
    ], ignore_index=True)
    compra = base(preco=20)
    compra["Data Abertura"] = "05/10/2026"
    assert rodar.processar(compra, acordos).loc[0, "Status"] == "CONFORME"
    assert "PREÇO DIVERGENTE" not in capsys.readouterr().out
    assert rodar.gerar_qualidade_acordos(acordos, tmp_path / "qualidade.csv") == 0


@pytest.mark.parametrize("fim,esperado", [("2026-09-30", 0), ("2026-10-01", 1), (None, 1)])
def test_qualidade_respeita_fim_inclusivo(rodar, tmp_path, fim, esperado):
    acordos = pd.concat([
        com_vigencia(acordo([10]), inicio="2026-09-18", fim=fim),
        com_vigencia(acordo([20]), inicio="2026-10-01"),
    ], ignore_index=True)
    assert rodar.gerar_qualidade_acordos(acordos, tmp_path / "qualidade.csv") == esperado


def test_suspenso_e_intervalo_ilegivel_nao_geram_conflito(rodar, tmp_path):
    acordos = pd.concat([
        com_vigencia(acordo([10]), inicio="2026-09-18"),
        com_vigencia(acordo([20]), inicio="2026-09-18", status="suspended"),
        com_vigencia(acordo([30]), inicio="2026-09-18", fim="invalido"),
        com_vigencia(acordo([40]), inicio="2026-09-18", fim="2026-09-17"),
    ], ignore_index=True)
    assert rodar.gerar_qualidade_acordos(acordos, tmp_path / "qualidade.csv") == 0


def test_qualidade_legada_mantem_conflitos_e_precos_invalidos(rodar, tmp_path):
    assert rodar.gerar_qualidade_acordos(acordo([10,20]), tmp_path / "a.csv") == 1
    assert rodar.gerar_qualidade_acordos(acordo([np.nan]), tmp_path / "b.csv") == 1
    assert rodar.gerar_qualidade_acordos(acordo([10,10]), tmp_path / "c.csv") == 0


@pytest.mark.parametrize("quantidade", ["invalida", "", None, np.nan, np.inf, -np.inf])
def test_quantidade_nao_finita_vai_para_quarentena(rodar, quantidade, tmp_path):
    compra = base(preco=100)
    compra["OS Quantidade"] = quantidade
    resultado = rodar.processar(compra, acordo([10]))
    assert resultado.loc[0, "Status"] == rodar.STATUS_QUANTIDADE_INVALIDA
    resumo = rodar.resumir_status(resultado)
    assert resumo["total_quarentena"] == 1
    assert resumo["total_elegivel"] == 0
    for coluna in ["Preco Acordo", "Preco Total Acordo", "Diferenca Unit.", "Diferenca Total", "Menor Preco Acordo", "Dif. p/ Menor Acordo"]:
        assert pd.isna(resultado.loc[0, coluna])
    assert rodar.gerar_pendencias_comparacao(resultado, tmp_path / "pendencias.xlsx")


@pytest.mark.parametrize("quantidade", [0, -2, 1.5])
def test_quantidade_finita_preserva_regra_atual_inclusive_devolucoes(rodar, quantidade):
    compra = base(preco=100)
    compra["OS Quantidade"] = quantidade
    resultado = rodar.processar(compra, acordo([10]))
    assert resultado.loc[0, "Status"] == "ACIMA DO ACORDO"
    assert resultado.loc[0, "Diferenca Total"] == 90 * quantidade


def test_data_invalida_remove_todos_os_valores_comparativos(rodar):
    compra = base(preco=100)
    compra["Data Abertura"] = "invalida"
    resultado = rodar.processar(compra, acordo([10]))
    assert resultado.loc[0, "Status"] == rodar.STATUS_DATA_INVALIDA
    assert resultado.loc[0, "Preco OS"] == 100
    assert resultado.loc[0, "Preco Total OS"] == 100
    for coluna in ["Preco Acordo", "Preco Total Acordo", "Diferenca Unit.", "Diferenca Total", "Menor Preco Acordo", "Dif. p/ Menor Acordo"]:
        assert pd.isna(resultado.loc[0, coluna])


@pytest.mark.parametrize("data", ["2026-09-05", "2026-09-05 00:00:00", "2026-09-05T15:20:00", pd.Timestamp("2026-09-05"), "05/09/2026"])
def test_data_iso_e_excel_nao_invertem_mes_dia(rodar, data):
    compra = base(preco=10)
    compra["Data Abertura"] = data
    futuro = com_vigencia(acordo([10]), inicio="2026-12-01", status="active")
    resultado = rodar.processar(compra, futuro)
    assert str(resultado.loc[0, "Data"]) == "2026-09-05"
    assert resultado.loc[0, "Status"] == "CONFORME"  # regra anterior ao corte


def test_formatos_mistos_respeitam_mes_e_corte(rodar):
    compra = base(qtd=5, preco=10)
    compra["Data Abertura"] = ["2026-09-05 00:00:00", "05/09/2026", "2026-10-05", pd.Timestamp("2026-10-05"), "invalida"]
    vigente = com_vigencia(acordo([10]), inicio="2026-10-05", fim="2026-10-05")
    resultado = rodar.processar(compra, vigente)
    assert resultado["Status"].tolist() == ["CONFORME"] * 4 + [rodar.STATUS_DATA_INVALIDA]
    assert resultado["Data"].astype(str).tolist()[:4] == ["2026-09-05"] * 2 + ["2026-10-05"] * 2


def test_uf_ausente_na_base_falha_com_nome_da_coluna(rodar):
    ac = acordo([10]); ac["UF"] = "SP"
    with pytest.raises(ValueError, match="Base do Qlik sem coluna de UF"):
        rodar.processar(base(preco=10), ac)
    compra = base(preco=10); compra["UF"] = "SP"
    assert rodar.processar(compra, ac).loc[0, "Status"] == "CONFORME"
