"""Cópia diária dos fornecedores para a aba Rede: extração, envio e agenda."""
import importlib.util
import io
import json
import logging
import sys
import types
import urllib.error
from datetime import date
from pathlib import Path

import pytest

import baixar_fornecedores as rede
import qlik
from test_qlik import sessao

ROOT = Path(__file__).resolve().parents[1]
# Mesmos títulos e ordem da planilha baixada da pasta de fornecedores.
CABECALHOS = ["Cód Fornecedor", "Nome Fantasia", "Razão Social", "Cidade", "UF", "CNPJ", "Nome Usuário Cadastro",
              "Data Cadastro", "E-mail", "Forma Pagamento", "Segmento", "Telefone", "Situação do Fornecedor",
              "Data Último Pedido", "Valor Último Pedido", "Notas"]


def linha(codigo, situacao="A", **extra):
    base = {"Cód Fornecedor": codigo, "Nome Fantasia": f"Oficina {codigo}", "Razão Social": f"Oficina {codigo} Ltda",
            "Cidade": "Cidade Exemplo", "UF": "MG", "CNPJ": "-", "Nome Usuário Cadastro": "Pessoa", "Data Cadastro": "01/01/2022",
            "E-mail": "-", "Forma Pagamento": "-", "Segmento": '["Mecânica Automotiva"]', "Telefone": "-",
            "Situação do Fornecedor": situacao, "Data Último Pedido": "28/10/2026", "Valor Último Pedido": "10", "Notas": "-"}
    base.update(extra)
    return [base[c] for c in CABECALHOS]


def test_preparar_filtra_situacao_trata_vazios_segmentos_e_datas():
    rows = [
        linha("662", CNPJ="01138114000165", Segmento='["Auto Peças","Mecânica Automotiva ","Auto Peças"]'),
        linha("663", situacao="N"), linha("664", situacao="I"), linha("665", situacao="R"), linha("666", situacao="P"),
        linha("1.234", **{"Data Último Pedido": "-", "Segmento": "Texto solto"}),
        linha("667", Segmento="-", UF="nan"),
        linha("-"),
    ]
    linhas, fora = rede.preparar(CABECALHOS, rows)
    assert fora == 5
    assert [l["codigo"] for l in linhas] == ["662", "1234", "667"]
    primeira = linhas[0]
    assert primeira["segmentos"] == ["Auto Peças", "Mecânica Automotiva"]
    assert primeira["cnpj"] == "01138114000165" and primeira["email"] is None and primeira["telefone"] is None
    assert primeira["ultimoPedido"] == "2026-10-28"
    assert set(primeira) == set(rede.COLUNAS.values())
    assert linhas[1]["ultimoPedido"] is None and linhas[1]["segmentos"] == ["Texto solto"]
    assert linhas[2]["segmentos"] == [] and linhas[2]["uf"] is None and primeira["uf"] == "MG"


def test_preparar_junta_codigo_repetido_e_exige_colunas():
    linhas, _ = rede.preparar(CABECALHOS, [linha("9", Segmento='["A"]'), linha("9", Segmento='["B","A"]')])
    assert linhas == [dict(linhas[0], segmentos=["A", "B"])] and len(linhas) == 1
    with pytest.raises(qlik.QlikErro, match="Situação do Fornecedor"):
        rede.preparar([c for c in CABECALHOS if c != "Situação do Fornecedor"], [])


def _pasta(objetos):
    """Responde GetObject/GetLayout a partir de {id: layout}."""
    handles = {}

    def responder(p):
        if p["method"] == "GetObject":
            obj = p["params"][0]
            if obj not in objetos:
                return {"qReturn": {"qType": None, "qHandle": None}}
            handles.setdefault(len(handles) + 10, obj)
            return {"qReturn": {"qHandle": max(handles)}}
        return {"qLayout": objetos[handles[p["handle"]]]}
    return sessao(responder)


def _tabela(titulos):
    return {"qHyperCube": {"qSize": {"qcx": len(titulos)}, "qDimensionInfo": [{"qFallbackTitle": t} for t in titulos]}}


def _filhos(*ids):
    return {"qChildList": {"qItems": [{"qInfo": {"qId": i}} for i in ids]}}


def test_tabela_da_pasta_desce_em_conteiner_e_ignora_outras_tabelas():
    s = _pasta({"pasta": _filhos("texto", "filtro", "conteiner"), "texto": {}, "filtro": _tabela(["UF"]),
                "conteiner": _filhos("fornecedores"), "fornecedores": _tabela(CABECALHOS)})
    h, headers, qcx = s.tabela_da_pasta("pasta", rede.OBRIGATORIAS)
    assert headers == CABECALHOS and qcx == len(CABECALHOS) and isinstance(h, int)


@pytest.mark.parametrize("objetos,motivo", [
    ({"pasta": _filhos("a", "b"), "a": _tabela(CABECALHOS), "b": _tabela(CABECALHOS)}, "2 tabela"),
    ({"pasta": _filhos("a"), "a": _tabela(["UF"])}, "0 tabela"),
    ({}, "não encontrado"),
])
def test_tabela_da_pasta_recusa_ambiguidade_e_ausencia(objetos, motivo):
    with pytest.raises(qlik.QlikErro, match=motivo):
        _pasta(objetos).tabela_da_pasta("pasta", rede.OBRIGATORIAS)


class SessaoFalsa:
    def __init__(self, *args):
        self.args = args

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def tabela_da_pasta(self, pasta, obrigatorias):
        assert pasta == "pasta-ficticia" and obrigatorias == rede.OBRIGATORIAS
        return 7, CABECALHOS, len(CABECALHOS)

    def ler(self, h, headers, qcx, numericas):
        return [linha("1"), linha("2", situacao="N"), linha("3")]


def test_main_sem_configuracao_nao_acessa_qlik(monkeypatch, capsys):
    monkeypatch.setattr(rede.sv_paths, "QLIK_REDE_APP_ID", "")
    monkeypatch.setattr(rede.qlik, "Sessao", lambda *a: pytest.fail("nao deve conectar"))
    assert rede.main([]) == 0
    assert "RESULTADO=REDE_NAO_CONFIGURADA" in capsys.readouterr().out


def test_main_envia_disponiveis_e_marca_o_dia(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(rede.sv_paths, "QLIK_REDE_APP_ID", "app-ficticio")
    monkeypatch.setattr(rede.sv_paths, "QLIK_REDE_SHEET_ID", "pasta-ficticia")
    monkeypatch.setattr(rede.sv_paths, "REDE_MARCADOR", tmp_path / "dados" / "rede.ok")
    monkeypatch.setattr(rede.qlik, "Sessao", SessaoFalsa)
    enviados = []
    monkeypatch.setattr(rede, "enviar", lambda linhas, aceitar: enviados.append((linhas, aceitar)) or {"linhas": len(linhas), "semCoordenada": 0})
    assert rede.main(["--aceitar-queda"]) == 0
    assert [l["codigo"] for l in enviados[0][0]] == ["1", "3"] and enviados[0][1] is True
    assert (tmp_path / "dados" / "rede.ok").read_text(encoding="utf-8") == date.today().isoformat()
    assert "RESULTADO=REDE_ATUALIZADA" in capsys.readouterr().out


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
            raise urllib.error.HTTPError(req.full_url, 409, "Conflict", {}, io.BytesIO(json.dumps({"error": "menos da metade"}).encode()))
        return Resposta(b'{"success": true, "linhas": 1}')
    monkeypatch.setattr(rede.portal_conexao, "abrir", abrir)
    assert rede.enviar([{"codigo": "1"}], url="http://127.0.0.1:3000", token="t")["linhas"] == 1
    assert pedidos[0].full_url == "http://127.0.0.1:3000/api/internal/rede"
    assert pedidos[0].get_header("Authorization") == "Bearer t"
    assert json.loads(pedidos[0].data) == {"linhas": [{"codigo": "1"}], "aceitarQueda": False}
    with pytest.raises(RuntimeError, match="HTTP 409.*menos da metade"):
        rede.enviar([], url="http://127.0.0.1:3000", token="t")
    with pytest.raises(RuntimeError, match="não configurado"):
        rede.enviar([], url="", token="")


def carregar_pipeline(monkeypatch, tmp_path, configurada=True):
    fake = types.ModuleType("sv_paths")
    fake.OPERACAO = fake.LOG_DIR = tmp_path
    fake.PIPELINE_TIMEOUT_S = 1
    fake.SCRIPT_BAIXAR, fake.SCRIPT_RODAR, fake.SCRIPT_EMAIL = (tmp_path / n for n in ("baixar.py", "rodar.py", "email.py"))
    fake.SCRIPT_REDE = tmp_path / "rede.py"
    fake.REDE_MARCADOR = tmp_path / "rede.ok"
    fake.QLIK_REDE_APP_ID = "app" if configurada else ""
    fake.QLIK_REDE_SHEET_ID = "pasta"
    monkeypatch.setitem(sys.modules, "sv_paths", fake)
    spec = importlib.util.spec_from_file_location("pipeline_rede_test", ROOT / "processo" / "pipeline.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod.estado_entrega, "sv_paths", fake)
    monkeypatch.setattr(mod, "adquirir_lock", lambda: None)
    monkeypatch.setattr(mod, "configurar_log", lambda: str(tmp_path / "pipeline.log"))
    monkeypatch.setattr(mod.estado_entrega, "consultar_entrega", lambda: None)
    monkeypatch.setattr(sys, "argv", ["pipeline.py"])
    monkeypatch.setenv("MODO_ENSAIO", "0")
    monkeypatch.delenv("SUPPLY_VISION_SEM_ENVIO", raising=False)
    return mod, fake


def test_rede_roda_depois_do_alerta_uma_vez_por_dia_e_falha_nao_muda_o_codigo(monkeypatch, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    mod, fake = carregar_pipeline(monkeypatch, tmp_path)
    chamadas = []
    sem_dados = (True, "CONTEXTO_EMAIL=manha\nDATAS_EMAIL=14/09/2026\nRESULTADO=SEM_DADOS_QLIK")
    monkeypatch.setattr(mod, "rodar_script", lambda caminho, nome, args=None: chamadas.append(nome) or
                        (sem_dados if nome.startswith("Download") else (False, "")))
    with pytest.raises(SystemExit) as saida:
        mod.main()
    assert saida.value.code == 0
    assert chamadas == ["Download Qlik (filtrado)", "Rede de fornecedores (Qlik)"]
    assert "Rede de fornecedores não atualizada" in caplog.text

    fake.REDE_MARCADOR.write_text(date.today().isoformat(), encoding="utf-8")
    chamadas.clear()
    with pytest.raises(SystemExit):
        mod.main()
    assert chamadas == ["Download Qlik (filtrado)"]


def test_rede_tambem_roda_quando_o_alerta_falha(monkeypatch, tmp_path):
    mod, _ = carregar_pipeline(monkeypatch, tmp_path)
    chamadas = []
    monkeypatch.setattr(mod, "rodar_script", lambda caminho, nome, args=None: chamadas.append(nome) or (nome.startswith("Rede"), ""))
    with pytest.raises(SystemExit) as saida:
        mod.main()
    assert saida.value.code == 1
    assert chamadas == ["Download Qlik (filtrado)", "Rede de fornecedores (Qlik)"]


@pytest.mark.parametrize("configurada,sem_envio,marcador,esperado", [
    (True, False, None, True),
    (True, False, "2000-01-01", True),
    (True, False, "hoje", False),
    (False, False, None, False),
    (True, True, None, False),
])
def test_rede_pendente(monkeypatch, tmp_path, configurada, sem_envio, marcador, esperado):
    mod, fake = carregar_pipeline(monkeypatch, tmp_path, configurada)
    if sem_envio:
        monkeypatch.setenv("SUPPLY_VISION_SEM_ENVIO", "1")
    if marcador:
        fake.REDE_MARCADOR.write_text(date.today().isoformat() if marcador == "hoje" else marcador, encoding="utf-8")
    assert mod.rede_pendente() is esperado
