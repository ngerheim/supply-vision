"""Histórico de OS para o Reembolso do Portal: extração, envio e agenda."""
import io
import json
import logging
import urllib.error
from datetime import date, timedelta

import pytest

import baixar_historico_os as hist
import qlik
from test_rede_fornecedores import carregar_pipeline

# Mesmos títulos do objeto do Qlik do alerta (amostra fictícia).
CABECALHOS = ["Grupo Despesa", "Placa", "Modelo", "Codigo OS", "Data Abertura", "Descrição", "OS Quantidade", "Valor Unitario",
              "Valor Total", "Valor Reembolso", "KM OS", "KM Atual", "Cliente", "Fornecedor"]
D1, D2 = date(2026, 10, 1), date(2026, 10, 2)


def linha(**extra):
    base = {"Grupo Despesa": "01.02.01 - Manutenção", "Placa": "EXE-1A23", "Modelo": "Picape Exemplo", "Codigo OS": "143.591",
            "Data Abertura": "01/10/2026", "Descrição": " FILTRO DE AR ", "OS Quantidade": 2, "Valor Unitario": 10.5, "Valor Total": 21.0,
            "Valor Reembolso": 0, "KM OS": "70.280", "KM Atual": "74650", "Cliente": "Cliente Exemplo", "Fornecedor": "Oficina Exemplo"}
    base.update(extra)
    return [base[c] for c in CABECALHOS]


def test_preparar_normaliza_e_descarta_sem_placa_produto_ou_fora_do_periodo():
    rows = [linha(), linha(), linha(**{"Data Abertura": "2026-10-02", "KM OS": "-", "Valor Total": None}),
            linha(Placa="-"), linha(**{"Descrição": "-"}), linha(**{"Data Abertura": "05/10/2026"}), linha(**{"Data Abertura": "46296"})]
    linhas, fora = hist.preparar(CABECALHOS, rows, [D1, D2])
    assert fora == 3
    assert len(linhas) == 4  # duas linhas iguais continuam duas: podem ser dois itens
    assert linhas[0] == {"data": "2026-10-01", "placa": "EXE1A23", "os": "143591", "produto": "FILTRO DE AR", "km": 70280,
                         "qtd": 2, "valorUnit": 10.5, "total": 21.0, "reembolso": 0, "fornecedor": "Oficina Exemplo",
                         "grupo": "01.02.01 - Manutenção", "modelo": "Picape Exemplo", "cliente": "Cliente Exemplo"}
    assert linhas[2]["data"] == "2026-10-02" and linhas[2]["km"] is None and linhas[2]["total"] is None
    assert linhas[3]["data"] == "2026-10-01"  # serial do Qlik
    with pytest.raises(qlik.QlikErro, match="KM OS"):
        hist.preparar([c for c in CABECALHOS if c != "KM OS"], [], [D1])


def test_periodo_diario_e_manual_em_blocos():
    hoje = date(2026, 11, 5)
    assert hist.periodo([], hoje) == (date(2026, 10, 30), hoje, False)
    assert hist.periodo(["--de", "2026-01-01", "--ate=2026-01-25"], hoje) == (date(2026, 1, 1), date(2026, 1, 25), True)
    assert [len(b) for b in hist.blocos(date(2026, 1, 1), date(2026, 1, 25))] == [10, 10, 5]
    for argv in (["--de", "01/01/2026"], ["--de", "2026-02-01", "--ate", "2026-01-01"], ["--de", "2026-01-01", "--ate", "2026-12-01"]):
        with pytest.raises(ValueError):
            hist.periodo(argv, hoje)


class SessaoFalsa:
    selecionadas = []

    def __init__(self, *args):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def abrir_objeto(self, obj):
        return 7, CABECALHOS, len(CABECALHOS)

    def selecionar_datas(self, campo, datas):
        assert campo == hist.CAMPO_DATA
        SessaoFalsa.selecionadas.append(list(datas))
        return 0 if datas[0] > date(2026, 11, 1) else 1

    def ler(self, h, headers, qcx, numericas):
        assert numericas == hist.NUMERICAS
        return [linha()]


def test_main_diario_envia_blocos_marca_o_dia_e_nao_le_bloco_sem_datas(monkeypatch, tmp_path, capsys):
    SessaoFalsa.selecionadas = []
    monkeypatch.setattr(hist.qlik, "Sessao", SessaoFalsa)
    monkeypatch.setattr(hist.sv_paths, "HISTORICO_OS_MARCADOR", tmp_path / "dados" / "historico.ok")
    enviados = []
    monkeypatch.setattr(hist, "enviar", lambda datas, linhas: enviados.append((datas, linhas)) or {"linhas": len(linhas)})
    assert hist.main(["--de", "2026-09-25", "--ate", "2026-11-04"]) == 0
    assert [len(d) for d, _ in enviados] == [10, 10, 10, 10, 1]
    assert [len(l) for _, l in enviados] == [1, 0, 0, 0, 0]  # só o bloco com 01/10 tem a linha da amostra
    assert not (tmp_path / "dados" / "historico.ok").exists()  # carga manual não marca o dia
    enviados.clear()
    assert hist.main([]) == 0
    assert len(enviados) == 1 and len(enviados[0][0]) == hist.DIAS_DIARIOS
    assert (tmp_path / "dados" / "historico.ok").read_text(encoding="utf-8") == date.today().isoformat()
    assert "RESULTADO=HISTORICO_OS_ATUALIZADO" in capsys.readouterr().out


def test_enviar_usa_rota_interna_e_traduz_recusa(monkeypatch):
    pedidos = []

    class Resposta(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def abrir(req, timeout):
        pedidos.append(req)
        if len(pedidos) == 2:
            raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, io.BytesIO(json.dumps({"error": "fora das datas"}).encode()))
        return Resposta(b'{"success": true, "linhas": 1}')
    monkeypatch.setattr(hist.portal_conexao, "abrir", abrir)
    assert hist.enviar([D1], [{"data": "2026-10-01"}], url="http://127.0.0.1:3000", token="t")["linhas"] == 1
    assert pedidos[0].full_url == "http://127.0.0.1:3000/api/internal/reembolso-historico"
    assert json.loads(pedidos[0].data) == {"datas": ["2026-10-01"], "linhas": [{"data": "2026-10-01"}]}
    with pytest.raises(RuntimeError, match="HTTP 400.*fora das datas"):
        hist.enviar([D1], [], url="http://127.0.0.1:3000", token="t")
    with pytest.raises(RuntimeError, match="não configurado"):
        hist.enviar([D1], [], url="", token="")


def test_historico_roda_depois_da_rede_uma_vez_por_dia(monkeypatch, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    mod, fake = carregar_pipeline(monkeypatch, tmp_path)
    fake.SCRIPT_HISTORICO_OS = tmp_path / "historico.py"
    fake.HISTORICO_OS_MARCADOR = tmp_path / "historico.ok"
    fake.PORTAL_URL, fake.PORTAL_API_TOKEN = "http://127.0.0.1:3000", "t"
    mod.SCRIPT_HISTORICO_OS = fake.SCRIPT_HISTORICO_OS
    chamadas = []
    sem_dados = (True, "CONTEXTO_EMAIL=manha\nDATAS_EMAIL=14/09/2026\nRESULTADO=SEM_DADOS_QLIK")
    monkeypatch.setattr(mod, "rodar_script", lambda caminho, nome, args=None: chamadas.append(nome) or
                        (sem_dados if nome.startswith("Download") else (False, "")))
    with pytest.raises(SystemExit) as saida:
        mod.main()
    assert saida.value.code == 0
    assert chamadas == ["Download Qlik (filtrado)", "Rede de fornecedores (Qlik)", "Histórico de OS do Reembolso (Qlik)"]
    assert "histórico de OS não atualizado" in caplog.text
    fake.HISTORICO_OS_MARCADOR.write_text(date.today().isoformat(), encoding="utf-8")
    assert mod.historico_os_pendente() is False
    fake.PORTAL_API_TOKEN = ""
    fake.HISTORICO_OS_MARCADOR.unlink()
    assert mod.historico_os_pendente() is False


def test_tudo_comeca_na_primeira_data_do_qlik_e_erro_indica_retomada(monkeypatch, tmp_path):
    hoje = date(2026, 11, 5)
    assert hist.periodo(["--tudo"], hoje, primeira=date(2019, 3, 4)) == (date(2019, 3, 4), hoje, True)
    with pytest.raises(ValueError, match="primeira data"):
        hist.periodo(["--tudo"], hoje)

    class SessaoTudo(SessaoFalsa):
        def primeira_data(self, campo):
            assert campo == hist.CAMPO_DATA
            return date.today() - timedelta(days=25)
    monkeypatch.setattr(hist.qlik, "Sessao", SessaoTudo)
    monkeypatch.setattr(hist.sv_paths, "HISTORICO_OS_MARCADOR", tmp_path / "historico.ok")
    enviados = []

    def enviar(datas, linhas):
        if len(enviados) == 2:
            raise RuntimeError("Portal recusou o histórico (HTTP 503): fora do ar.")
        enviados.append(datas)
        return {"linhas": 0}
    monkeypatch.setattr(hist, "enviar", enviar)
    with pytest.raises(RuntimeError, match=r"retome com --de \d{4}-\d{2}-\d{2}"):
        hist.main(["--tudo"])
    assert len(enviados) == 2 and not (tmp_path / "historico.ok").exists()


def test_primeira_data_pega_o_menor_serial_valido():
    from test_qlik import sessao

    def responder(p):
        if p["method"] == "CreateSessionObject":
            assert p["params"][0]["qListObjectDef"]["qDef"]["qSortCriterias"] == [{"qSortByState": 0, "qSortByNumeric": 1}]
            return {"qReturn": {"qHandle": 5}}
        return {"qLayout": {"qListObject": {"qDataPages": [{"qMatrix": [[{"qNum": "NaN"}], [{"qNum": 43466}], [{"qNum": 43467}]]}]}}}
    assert sessao(responder).primeira_data("Data") == date(2019, 1, 1)
    vazio = sessao(lambda p: {"qReturn": {"qHandle": 5}} if p["method"] == "CreateSessionObject" else {"qLayout": {"qListObject": {}}})
    assert vazio.primeira_data("Data") is None
