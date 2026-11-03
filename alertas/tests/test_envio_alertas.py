import io
import json
from datetime import datetime

import pandas as pd

import envio_alertas
import planilhas_comparacao
import portal_conexao


def _planilha(tmp_path):
    """Gera a planilha pelo mesmo código do anexo do e-mail."""
    base = {"Grupo Despesa": "Manutencao", "Criador": "Pessoa Ficticia", "Cidade": "Cidade A", "Fornecedor": "Oficina X",
            "Modelo": "Modelo 1", "CNPJ": "01234567000199", "UF": "PA", "Qtd": 1}
    df = pd.DataFrame([
        {**base, "Data": datetime(2026, 10, 30), "OS": 146672, "Item": "Filtro de oleo", "Preco OS": 31.25, "Preco Acordo": 31.0,
         "Preco Total OS": 31.25, "Preco Total Acordo": 31.0, "Diferenca Unit.": 0.25, "Diferenca Total": 0.25, "Status": "ACIMA DO ACORDO"},
        {**base, "Data": datetime(2026, 10, 30), "OS": 146673, "Item": "Alinhamento", "Qtd": 2, "Preco OS": 40.0, "Preco Acordo": 50.0,
         "Preco Total OS": 80.0, "Preco Total Acordo": 100.0, "Diferenca Unit.": -10.0, "Diferenca Total": -20.0, "Status": "ABAIXO DO ACORDO"},
    ])
    caminho = tmp_path / "com_acordo_teste.xlsx"
    planilhas_comparacao.gerar_alerta_acordo(df, str(caminho))
    return caminho


def test_le_a_planilha_do_email_com_todas_as_colunas(tmp_path):
    linhas = envio_alertas.linhas_do_relatorio(str(_planilha(tmp_path)))
    assert len(linhas) == 2
    primeira = linhas[0]
    assert primeira["data"] == "2026-10-30"
    assert primeira["os"] == "146672"
    assert primeira["criador"] == "Pessoa Ficticia"
    assert primeira["cnpj"] == "01234567000199"  # zero a esquerda preservado
    assert primeira["uf"] == "PA"
    assert (primeira["difUnit"], primeira["difTotal"], primeira["status"]) == (0.25, 0.25, "ACIMA DO ACORDO")
    assert linhas[1]["qtd"] == 2 and linhas[1]["difTotal"] == -20.0
    assert envio_alertas.linhas_do_relatorio("") == []


def test_publica_com_chave_do_horario_e_token(monkeypatch, tmp_path):
    pedidos = []

    class Resposta(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def abrir(requisicao, timeout=60):
        pedidos.append((requisicao.full_url, requisicao.get_header("Authorization"), json.loads(requisicao.data.decode("utf-8")), timeout))
        return Resposta(b'{"success": true, "nova": true, "linhas": 2, "avisados": 3}')

    monkeypatch.setattr(portal_conexao, "abrir", abrir)
    monkeypatch.setattr(envio_alertas, "chave_rodada", lambda: "2026-10-30_1400")
    resumo = {"total_elegivel": 10, "contagens": {"ACIMA DO ACORDO": 1, "ABAIXO DO ACORDO": 1}}
    aceita, mensagem = envio_alertas.publicar_rodada("parcial", ["30/10/2026"], resumo, str(_planilha(tmp_path)), "q.csv",
                                                     url="http://localhost:3000", token="token-ficticio")
    assert aceita and "rodada nova, 2 linha(s), 3 aviso(s)" in mensagem
    url, autorizacao, corpo, timeout = pedidos[0]
    assert url == "http://localhost:3000/api/internal/alertas"
    assert autorizacao == "Bearer token-ficticio"
    assert timeout == envio_alertas.TEMPO_LIMITE_S
    assert (corpo["chave"], corpo["contexto"], corpo["datas"], corpo["qualidadePendente"]) == ("2026-10-30_1400", "parcial", ["30/10/2026"], True)
    assert corpo["resumo"] == resumo and len(corpo["linhas"]) == 2


def test_portal_fora_do_ar_ou_sem_configuracao_nao_lanca(monkeypatch, tmp_path):
    def falhar(requisicao, timeout=60):
        raise OSError("recusado")
    monkeypatch.setattr(portal_conexao, "abrir", falhar)
    monkeypatch.setattr(envio_alertas, "chave_rodada", lambda: "x")
    aceita, mensagem = envio_alertas.publicar_rodada("manha", ["29/10/2026"], {}, "", "", url="http://localhost:3000", token="t")
    assert not aceita and "recusado" in mensagem
    assert envio_alertas.publicar_rodada("manha", ["29/10/2026"], {}, "", "", url="", token="")[0] is False
