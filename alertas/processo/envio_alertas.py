"""Publica no Portal (aba Alertas) a rodada que vai por e-mail.

O conteúdo é o mesmo do anexo de divergências: as linhas acima e abaixo do
acordo, lidas da planilha gerada nesta execução, mais o resumo da comparação.
A chave é o horário agendado (a mesma do registro de entrega), então
reexecutar o horário troca a rodada no Portal sem duplicar nem avisar de novo.
Falha aqui não impede o e-mail: só gera aviso no log.
"""
import json
import math
import urllib.error
import urllib.request

import pandas as pd

import estado_entrega
import portal_conexao
import sv_paths

COLUNAS = {
    # coluna da planilha com_acordo → campo enviado
    "OS": "os",
    "Criador": "criador",
    "Cidade": "cidade",
    "UF": "uf",
    "Fornecedor": "fornecedor",
    "CNPJ": "cnpj",
    "Modelo": "modelo",
    "Item": "item",
    "Qtd": "qtd",
    "Preco OS": "precoOs",
    "Preco Acordo": "precoAcordo",
    "Preco Total OS": "totalOs",
    "Preco Total Acordo": "totalAcordo",
    "Diferenca Unit.": "difUnit",
    "Diferenca Total": "difTotal",
    "Status": "status",
}
NUMERICOS = {"qtd", "precoOs", "precoAcordo", "totalOs", "totalAcordo", "difUnit", "difTotal"}
TEMPO_LIMITE_S = 30


def chave_rodada():
    """Mesma chave do registro de entrega: data_horario agendado ou o run id."""
    return estado_entrega.caminho_entrega().stem


def _valor(campo, v):
    if v is None or (isinstance(v, float) and not math.isfinite(v)) or v is pd.NaT:
        return None
    if campo in NUMERICOS:
        try:
            n = float(v)
        except (TypeError, ValueError):
            return None
        return round(n, 4) if math.isfinite(n) else None
    if campo == "os" and isinstance(v, float) and v.is_integer():
        v = int(v)
    texto = str(v).strip()
    return texto or None


def _data(v):
    try:
        if v is None or pd.isna(v):
            return None
        return pd.Timestamp(v).date().isoformat()
    except (TypeError, ValueError):
        return None


def linhas_do_relatorio(caminho):
    """Lê a planilha de divergências desta execução; sem planilha, nenhuma linha."""
    if not caminho:
        return []
    df = pd.read_excel(caminho, sheet_name=0, dtype={"CNPJ": str})
    linhas = []
    for registro in df.to_dict("records"):
        linha = {campo: _valor(campo, registro.get(coluna)) for coluna, campo in COLUNAS.items()}
        linha["data"] = _data(registro.get("Data"))
        if linha["status"] in ("ACIMA DO ACORDO", "ABAIXO DO ACORDO"):
            linhas.append(linha)
    return linhas


def publicar_rodada(contexto, datas, resumo, caminho_com, tem_qualidade, url=None, token=None):
    """Envia a rodada ao Portal. Devolve (aceita, mensagem para o log)."""
    url = url if url is not None else str(sv_paths.PORTAL_URL)
    token = token if token is not None else str(sv_paths.PORTAL_API_TOKEN)
    if not url or not token:
        return False, "Portal não configurado; rodada não publicada na aba Alertas."
    try:
        base = portal_conexao.endereco_interno(url, str(getattr(sv_paths, "PORTAL_INTERNAL_URL", "")))
        corpo = {
            "chave": chave_rodada(), "contexto": contexto, "datas": list(datas), "resumo": resumo,
            "qualidadePendente": bool(tem_qualidade), "linhas": linhas_do_relatorio(caminho_com),
        }
        requisicao = urllib.request.Request(
            f"{base}/api/internal/alertas", method="POST",
            data=json.dumps(corpo, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"},
        )
        with portal_conexao.abrir(requisicao, timeout=TEMPO_LIMITE_S) as resposta:
            retorno = json.loads(resposta.read().decode("utf-8"))
    except (OSError, ValueError, urllib.error.URLError) as erro:
        return False, f"rodada não publicada na aba Alertas do Portal: {erro}"
    situacao = "nova" if retorno.get("nova") else "atualizada"
    return True, (f"Alertas no Portal: rodada {situacao}, {retorno.get('linhas', 0)} linha(s), "
                  f"{retorno.get('avisados', 0)} aviso(s) na Central.")
