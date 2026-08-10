import numpy as np
import pandas as pd


KEY = ["_fornec_norm", "_cidade_norm", "_modelo_norm", "_peca_norm"]


def acordo(precos):
    linhas = []
    for preco in precos:
        linhas.append({
            "_fornec_norm": "1", "_cidade_norm": "X", "_modelo_norm": "M",
            "_peca_norm": "ITEM", "PECA_SERVICO": "ITEM", "FORNECEDOR": "F",
            "PRECO": preco, "_preco_original": str(preco),
            "_preco_valido": bool(pd.notna(preco) and np.isfinite(preco) and preco > 0),
        })
    return pd.DataFrame(linhas)


def base(qtd=1, preco=100):
    return pd.DataFrame({
        "Modelo": ["M"] * qtd, "_desc_norm": ["ITEM"] * qtd,
        "_cidade_norm": ["X"] * qtd, "_fornec_norm": ["1"] * qtd,
        "Valor Unitario": [preco] * qtd, "OS Quantidade": [1] * qtd,
        "Data Abertura": ["01/08/2026"] * qtd, "Codigo OS": range(1, qtd + 1),
        "Forncedor por Cidade": ["X"] * qtd, "Fornecedor": ["F"] * qtd,
        "Descrição": ["ITEM"] * qtd, "Criado Por": ["T"] * qtd,
        "Grupo Despesa": ["G"] * qtd,
    })


def test_precos_iguais_na_precisao_monetaria(rodar):
    ac = acordo([10.0, 10.0000000001])
    ac["PRECO"] = pd.to_numeric(ac["PRECO"]).round(2)
    resultado = rodar.processar(base(preco=10), ac)
    assert resultado.loc[0, "Status"] == "CONFORME"


def test_carregamento_arredonda_e_rejeita_preco_nao_finito(rodar, monkeypatch):
    bruto = pd.DataFrame({
        "MODELO": ["M"] * 5, "PECA_SERVICO": ["ITEM"] * 5,
        "CIDADE": ["X"] * 5, "CNPJ": ["1"] * 5,
        "PRECO": [10, 10.0000000001, 0, -1, np.inf], "FORNECEDOR": ["F"] * 5,
    })
    monkeypatch.setattr(pd, "read_excel", lambda *args, **kwargs: bruto.copy())
    carregado = rodar.carregar_acordo("falso.xlsx")
    assert carregado.loc[0, "PRECO"] == carregado.loc[1, "PRECO"] == 10.0
    assert carregado["_preco_valido"].tolist() == [True, True, False, False, False]


def test_ambiguo_nao_expoe_nenhuma_referencia(rodar):
    resultado = rodar.processar(base(), acordo([10.0, 20.0]))
    assert resultado.loc[0, "Status"] == rodar.STATUS_AMBIGUO
    for coluna in ("Preco Acordo", "Preco Total Acordo", "Diferenca Unit.",
                   "Diferenca Total", "Menor Preco Acordo", "Dif. p/ Menor Acordo"):
        assert pd.isna(resultado.loc[0, coluna])
    assert resultado.loc[0, "Fornecedor do Acordo"] == ""
    assert resultado.loc[0, "Tinha acordo?"] == ""


def test_preco_nulo_zero_negativo_gera_pendencia(rodar):
    for preco in (np.nan, 0, -1, np.inf):
        resultado = rodar.processar(base(), acordo([preco]))
        assert resultado.loc[0, "Status"] == rodar.STATUS_PRECO_INVALIDO


def test_denominador_exclui_quarentena(rodar):
    df = pd.DataFrame({"Status": ["CONFORME"] * 10 + [rodar.STATUS_AMBIGUO] * 90,
                       "Motivo Sem Acordo": [""] * 100})
    resumo = rodar.resumir_status(df)
    assert resumo["total_bruto"] == 100
    assert resumo["total_elegivel"] == 10
    assert resumo["percentuais_elegiveis"]["CONFORME"] == 100.0
    assert sum(resumo["contagens"].values()) == 100


def test_tres_grupos_sao_mutuamente_exclusivos(rodar):
    statuses = pd.Series(["CONFORME", "ACIMA DO ACORDO", "ABAIXO DO ACORDO",
                          "SEM ACORDO", rodar.STATUS_AMBIGUO, rodar.STATUS_PRECO_INVALIDO])
    grupos = [statuses.isin(rodar.STATUS_COM_ACORDO), statuses == "SEM ACORDO",
              statuses.isin(rodar.STATUS_QUARENTENA)]
    assert sum(int(g.sum()) for g in grupos) == len(statuses)
    assert all(sum(bool(g.iloc[i]) for g in grupos) == 1 for i in range(len(statuses)))
