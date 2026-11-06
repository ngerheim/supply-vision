"""Consulta sob demanda dos itens de OS de uma placa para o Reembolso."""
import json

import pytest

import consultar_os_placa as consulta
import qlik
from test_qlik import sessao

# Mesmos títulos do objeto do Qlik do alerta (amostra fictícia).
CABECALHOS = ["Grupo Despesa", "Placa", "Modelo", "Codigo OS", "Data Abertura", "Descrição", "OS Quantidade", "Valor Unitario",
              "Valor Total", "Valor Reembolso", "KM OS", "KM Atual", "Cliente", "Fornecedor"]


def linha(**extra):
    base = {"Grupo Despesa": "01.02.01 - Manutenção", "Placa": "EXE1A23", "Modelo": "Picape Exemplo", "Codigo OS": "143.591",
            "Data Abertura": "01/10/2026", "Descrição": " FILTRO DE AR ", "OS Quantidade": 2, "Valor Unitario": 10.5, "Valor Total": 21.0,
            "Valor Reembolso": 0, "KM OS": "70.280", "KM Atual": "74650", "Cliente": "Cliente Exemplo", "Fornecedor": "Oficina Exemplo"}
    base.update(extra)
    return [base[c] for c in CABECALHOS]


def test_preparar_normaliza_e_descarta_outra_placa_sem_produto_ou_data():
    rows = [linha(), linha(), linha(**{"Data Abertura": "2026-10-02", "KM OS": "-", "Valor Total": None}),
            linha(Placa="OUT9Z99"), linha(**{"Descrição": "-"}), linha(**{"Data Abertura": "-"}), linha(**{"Data Abertura": "46296"})]
    linhas, fora = consulta.preparar(CABECALHOS, rows, "EXE1A23")
    assert fora == 3
    assert len(linhas) == 4  # duas linhas iguais continuam duas: podem ser dois itens
    assert linhas[0] == {"data": "2026-10-01", "os": "143591", "produto": "FILTRO DE AR", "km": 70280, "qtd": 2, "valorUnit": 10.5,
                         "total": 21.0, "reembolso": 0, "fornecedor": "Oficina Exemplo", "grupo": "01.02.01 - Manutenção",
                         "modelo": "Picape Exemplo", "cliente": "Cliente Exemplo"}
    assert linhas[2]["data"] == "2026-10-02" and linhas[2]["km"] is None and linhas[2]["total"] is None
    assert linhas[3]["data"] == "2026-10-01"  # serial do Qlik
    with pytest.raises(qlik.QlikErro, match="KM OS"):
        consulta.preparar([c for c in CABECALHOS if c != "KM OS"], [], "EXE1A23")


def test_placa_valida():
    assert consulta.placa_valida(" exe-1a23 ") == "EXE1A23"
    for ruim in ("", "AB", "X" * 11, None):
        with pytest.raises(ValueError):
            consulta.placa_valida(ruim)


class SessaoFalsa:
    casadas = 1

    def __init__(self, *args):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def abrir_objeto(self, obj):
        return 7, CABECALHOS, len(CABECALHOS)

    def campo_da_coluna(self, h, titulo):
        assert (h, titulo) == (7, "Placa")
        return "VEICULO.PLACA"

    def selecionar_textos(self, campo, valores):
        assert (campo, valores) == ("VEICULO.PLACA", ["EXE1A23"])
        return SessaoFalsa.casadas

    def ler(self, h, headers, qcx, numericas):
        assert numericas == consulta.NUMERICAS
        if not SessaoFalsa.casadas:
            pytest.fail("sem placa casada nao le a base")
        return [linha()]


def test_main_imprime_resultado_json_e_placa_sem_os_nao_le_a_base(monkeypatch, capsys):
    monkeypatch.setattr(consulta.qlik, "Sessao", SessaoFalsa)
    SessaoFalsa.casadas = 1
    assert consulta.main(["exe1a23"]) == 0
    saida = capsys.readouterr().out.strip().splitlines()[-1]
    assert saida.startswith("RESULTADO_JSON=")
    corpo = json.loads(saida.split("=", 1)[1])
    assert corpo["placa"] == "EXE1A23" and [l["produto"] for l in corpo["linhas"]] == ["FILTRO DE AR"]
    SessaoFalsa.casadas = 0
    assert consulta.main(["EXE1A23"]) == 0
    assert json.loads(capsys.readouterr().out.strip().split("=", 1)[1]) == {"placa": "EXE1A23", "linhas": []}


def test_campo_da_coluna_e_selecao_de_texto():
    chamadas = []

    def responder(p):
        chamadas.append(p["method"])
        if p["method"] == "GetLayout" and p["handle"] == 7:
            return {"qLayout": {"qHyperCube": {"qDimensionInfo": [{"qFallbackTitle": "Placa", "qGroupFieldDefs": ["VEICULO.PLACA"]}]}}}
        if p["method"] == "CreateSessionObject":
            return {"qReturn": {"qHandle": 20}}
        if p["method"] == "GetField":
            return {"qReturn": {"qHandle": 21}}
        if p["method"] == "SelectValues":
            assert p["params"]["qFieldValues"] == [{"qText": "EXE1A23", "qIsNumeric": False}]
            return {"qReturn": True}
        if p["method"] == "GetLayout":
            return {"qLayout": {"qListObject": {"qDimensionInfo": {"qStateCounts": {"qSelected": 1}}}}}
        return {}
    s = sessao(responder)
    assert s.campo_da_coluna(7, "Placa") == "VEICULO.PLACA"
    with pytest.raises(qlik.QlikErro, match="Modelo"):
        s.campo_da_coluna(7, "Modelo")
    assert s.selecionar_textos("VEICULO.PLACA", ["EXE1A23"]) == 1
    assert chamadas[-5:] == ["ClearAll", "CreateSessionObject", "GetField", "SelectValues", "GetLayout"]


class SessaoContada(SessaoFalsa):
    abertas = 0
    falhar_uma = False

    def __enter__(self):
        SessaoContada.abertas += 1
        return self

    def ler(self, h, headers, qcx, numericas):
        if SessaoContada.falhar_uma:
            SessaoContada.falhar_uma = False
            raise qlik.QlikErro("sessão encerrada pelo Qlik")
        return [linha()]


def test_servidor_reaproveita_a_sessao_e_reabre_depois_de_falha():
    import io
    SessaoFalsa.casadas = 1
    SessaoContada.abertas = 0
    pedidos = io.StringIO("\n".join([
        json.dumps({"id": 1, "aquecer": True}), json.dumps({"id": 2, "placa": "exe1a23"}), json.dumps({"id": 3, "placa": "EXE1A23"}),
        json.dumps({"id": 4, "placa": "x"}), "isto nao e json", "",
    ]) + "\n")
    saida = io.StringIO()
    consultor = consulta.Consultor(fabrica=SessaoContada)
    consulta.servir(pedidos, saida, consultor)
    respostas = [json.loads(l.split("=", 1)[1]) for l in saida.getvalue().splitlines()]
    assert respostas[0] == {"id": 1, "pronto": True}
    assert [len(r.get("linhas", [])) for r in respostas[1:3]] == [1, 1]
    assert SessaoContada.abertas == 1  # aquecer abriu; as consultas reaproveitaram
    assert respostas[3]["id"] == 4 and "Placa" in respostas[3]["erro"]
    assert respostas[4]["id"] is None and "erro" in respostas[4]
    # Sessão que caiu: fecha, reabre e responde na mesma consulta.
    SessaoContada.falhar_uma = True
    consultor = consulta.Consultor(fabrica=SessaoContada)
    assert len(consultor.consultar("EXE1A23")[0]) == 1
    assert SessaoContada.abertas == 3


class SocketFechado(Exception):
    """Como o websocket-client: não é OSError nem QlikErro."""


class SessaoQueCai(SessaoContada):
    def ler(self, h, headers, qcx, numericas):
        if SessaoContada.falhar_uma:
            SessaoContada.falhar_uma = False
            raise SocketFechado("socket is already closed.")
        return [linha()]

    def call(self, metodo, handle, params):
        assert (metodo, handle) == ("EngineVersion", -1)
        if getattr(self, "caiu", False):
            raise SocketFechado("socket is already closed.")
        return {"qVersion": {"qComponentVersion": "x"}}


def test_sessao_derrubada_pelo_qlik_e_reaberta_e_ping_mantem_viva():
    import io
    import time as relogio
    SessaoFalsa.casadas = 1
    SessaoContada.abertas = 0
    consultor = consulta.Consultor(fabrica=SessaoQueCai)
    consultor.abrir()
    SessaoContada.falhar_uma = True
    assert len(consultor.consultar("EXE1A23")[0]) == 1
    assert SessaoContada.abertas == 2
    consultor.manter_viva()
    assert consultor.sessao is not None
    consultor.sessao.caiu = True
    consultor.manter_viva()
    assert consultor.sessao is None  # descartada; a próxima consulta reabre

    # Servidor parado faz ping; pedido depois do ping usa a mesma sessão.
    class Entrada:
        def __iter__(self):
            yield json.dumps({"id": 1, "aquecer": True}) + "\n"
            relogio.sleep(0.25)
            yield json.dumps({"id": 2, "placa": "EXE1A23"}) + "\n"
    pings = []
    consultor = consulta.Consultor(fabrica=SessaoQueCai)
    original = consultor.manter_viva
    consultor.manter_viva = lambda: pings.append(1) or original()
    saida = io.StringIO()
    consulta.servir(Entrada(), saida, consultor, intervalo_ping=0.05)
    respostas = [json.loads(l.split("=", 1)[1]) for l in saida.getvalue().splitlines()]
    assert respostas[0]["pronto"] and len(respostas[1]["linhas"]) == 1
    assert pings and SessaoContada.abertas == 3
