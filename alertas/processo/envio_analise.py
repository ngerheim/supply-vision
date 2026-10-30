"""Envia ao Portal as compras já comparadas, para a aba Análise.

Cada dia é enviado inteiro e substitui o que o Portal tinha daquela data,
então reenviar (rodada parcial, recorte histórico) nunca duplica linhas.
Falha no envio não interrompe o alerta: só gera aviso no log.
"""
import json
import math
import urllib.error
import urllib.request

import portal_conexao
import sv_paths

COLUNAS = {
    # coluna do DataFrame de comparação → campo enviado
    "Grupo Despesa": "grupo",
    "OS": "os",
    "Cidade": "cidade",
    "Fornecedor": "fornecedor",
    "CNPJ": "cnpj",
    "Modelo": "modelo",
    "Item": "item",
    "Qtd": "qtd",
    "Preco OS": "precoOs",
    "Preco Acordo": "precoAcordo",
    "Preco Total OS": "totalOs",
    "Preco Total Acordo": "totalAcordo",
    "Diferenca Total": "difTotal",
    "Status": "status",
    "Motivo Sem Acordo": "motivo",
    "Tinha acordo?": "tinhaAcordo",
    "Menor Preco Acordo": "menorPreco",
    "Fornecedor do Acordo": "fornecedorAcordo",
    "Dif. p/ Menor Acordo": "difMenor",
}
NUMERICOS = {"qtd", "precoOs", "precoAcordo", "totalOs", "totalAcordo", "difTotal", "menorPreco", "difMenor"}
LIMITE_LINHAS_DIA = 20000


def _valor(campo, v):
    if v is None:
        return None
    if campo in NUMERICOS:
        try:
            n = float(v)
        except (TypeError, ValueError):
            return None
        return round(n, 4) if math.isfinite(n) else None
    if isinstance(v, float) and not math.isfinite(v):
        return None
    texto = str(v).strip()
    return texto or None


def linhas_por_dia(df):
    """Agrupa as linhas por data civil (AAAA-MM-DD); datas inválidas ficam de fora."""
    dias = {}
    if df is None or df.empty or "Data" not in df.columns:
        return dias
    for registro in df.to_dict("records"):
        data = registro.get("Data")
        try:
            chave = data.isoformat()[:10]
        except (AttributeError, ValueError):
            continue
        if not (len(chave) == 10 and chave[4] == "-" and chave[:4].isdigit()):
            continue  # NaT e datas ilegíveis ficam só nas pendências do alerta
        linha = {campo: _valor(campo, registro.get(coluna)) for coluna, campo in COLUNAS.items()}
        dias.setdefault(chave, []).append(linha)
    return dias


def enviar_dia(endpoint, token, data, linhas):
    corpo = json.dumps({"data": data, "linhas": linhas}, ensure_ascii=False).encode("utf-8")
    requisicao = urllib.request.Request(endpoint, data=corpo, method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json",
    })
    with portal_conexao.abrir(requisicao, timeout=120) as resposta:
        return json.loads(resposta.read().decode("utf-8"))


def enviar_comparacao(df, url=None, token=None):
    """Envia dia a dia. Devolve (dias enviados, dias com falha)."""
    url = url if url is not None else str(sv_paths.PORTAL_URL)
    token = token if token is not None else str(sv_paths.PORTAL_API_TOKEN)
    if not url or not token:
        print("AVISO: Portal não configurado; compras não enviadas para a Análise.")
        return 0, 0
    try:
        base = portal_conexao.endereco_interno(url, str(getattr(sv_paths, "PORTAL_INTERNAL_URL", "")))
    except ValueError as erro:
        print(f"AVISO: endereço do Portal inválido para a Análise: {erro}")
        return 0, 0
    endpoint = f"{base}/api/internal/compras"
    enviados = falhas = 0
    for data, linhas in sorted(linhas_por_dia(df).items()):
        if len(linhas) > LIMITE_LINHAS_DIA:
            print(f"AVISO: {data} tem {len(linhas):,} linhas; acima do limite da Análise, não enviado.")
            falhas += 1
            continue
        try:
            enviar_dia(endpoint, token, data, linhas)
            enviados += 1
        except (OSError, ValueError, urllib.error.URLError) as erro:
            falhas += 1
            print(f"AVISO: compras de {data} não enviadas para a Análise: {erro}")
    print(f"  Análise: {enviados} dia(s) enviado(s) ao Portal" + (f", {falhas} com falha" if falhas else "") + ".")
    return enviados, falhas
