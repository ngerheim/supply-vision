import io
import json
import math
from datetime import date

import pandas as pd

import envio_analise
import portal_conexao


def _df():
    return pd.DataFrame([
        {"Data": date(2026, 10, 1), "OS": "OS-1", "Cidade": "Cidade A", "Fornecedor": "Oficina X", "CNPJ": "12345678000199",
         "Modelo": "Modelo 1", "Item": "Troca de oleo", "Qtd": 2, "Preco OS": 110.0, "Preco Acordo": 100.0,
         "Preco Total OS": 220.0, "Preco Total Acordo": 200.0, "Diferenca Total": 20.0, "Status": "ACIMA DO ACORDO",
         "Motivo Sem Acordo": "", "Tinha acordo?": "SIM", "Menor Preco Acordo": 90.0, "Fornecedor do Acordo": "Oficina Y",
         "Dif. p/ Menor Acordo": 40.0, "Grupo Despesa": "Manutencao", "Criador": "Pessoa Ficticia"},
        {"Data": date(2026, 10, 2), "OS": "OS-2", "Cidade": "Cidade B", "Fornecedor": "Oficina Z", "CNPJ": "98765432000199",
         "Modelo": "Modelo 2", "Item": "Alinhamento", "Qtd": 1, "Preco OS": 80.0, "Preco Acordo": math.nan,
         "Preco Total OS": 80.0, "Preco Total Acordo": math.nan, "Diferenca Total": math.nan, "Status": "SEM ACORDO",
         "Motivo Sem Acordo": "Fornecedor", "Tinha acordo?": "NAO", "Menor Preco Acordo": math.nan, "Fornecedor do Acordo": "",
         "Dif. p/ Menor Acordo": math.nan, "Grupo Despesa": "Manutencao", "Criador": "Pessoa Ficticia"},
        {"Data": pd.NaT, "OS": "OS-3", "Status": "DATA DE ABERTURA INVÁLIDA"},
    ])


def test_agrupa_por_dia_sem_nome_de_quem_criou_e_sem_nan():
    dias = envio_analise.linhas_por_dia(_df())
    assert sorted(dias) == ["2026-10-01", "2026-10-02"]
    linha = dias["2026-10-02"][0]
    assert linha["precoAcordo"] is None and linha["difMenor"] is None and linha["fornecedorAcordo"] is None
    assert "Pessoa Ficticia" not in json.dumps(dias, ensure_ascii=False)
    assert dias["2026-10-01"][0]["difMenor"] == 40.0


def test_envia_um_dia_por_requisicao_e_continua_apos_falha(monkeypatch, capsys):
    pedidos = []

    class Resposta(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def abrir(requisicao, timeout=60):
        corpo = json.loads(requisicao.data.decode("utf-8"))
        pedidos.append((requisicao.full_url, requisicao.get_header("Authorization"), corpo["data"], len(corpo["linhas"])))
        if corpo["data"] == "2026-10-01":
            raise OSError("Portal fora do ar")
        return Resposta(b'{"success": true}')

    monkeypatch.setattr(portal_conexao, "abrir", abrir)
    enviados, falhas = envio_analise.enviar_comparacao(_df(), url="http://localhost:3000", token="token-ficticio")
    assert (enviados, falhas) == (1, 1)
    assert [p[2] for p in pedidos] == ["2026-10-01", "2026-10-02"]
    assert pedidos[0][0] == "http://localhost:3000/api/internal/compras"
    assert pedidos[0][1] == "Bearer token-ficticio"
    assert "não enviadas para a Análise" in capsys.readouterr().out


def test_sem_portal_configurado_nao_envia(monkeypatch):
    monkeypatch.setattr(portal_conexao, "abrir", lambda *a, **k: (_ for _ in ()).throw(AssertionError("não deveria enviar")))
    assert envio_analise.enviar_comparacao(_df(), url="", token="") == (0, 0)
