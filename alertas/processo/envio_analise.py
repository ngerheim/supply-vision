"""Envia ao Portal as compras já comparadas, para a aba Análise.

Cada dia é enviado inteiro e substitui o que o Portal tinha daquela data,
então reenviar (rodada parcial, recorte histórico) nunca duplica linhas.
Falha no envio não interrompe o alerta: só gera aviso no log.

No fim, avisa o Portal (com a data de corte de vigência), que refaz as
próximas ações de Suprimentos com os dados novos.
"""
import json
import math
import re
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
# Curto de proposito: o alerta nao pode esperar um Portal fora do ar.
TEMPO_LIMITE_S = 20


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
    with portal_conexao.abrir(requisicao, timeout=TEMPO_LIMITE_S) as resposta:
        return json.loads(resposta.read().decode("utf-8"))


def corte_vigencia():
    """Data de corte em AAAA-MM-DD; antes dela vale a tabela atual de acordos."""
    valor = getattr(sv_paths, "CORTE_VIGENCIA_ACORDOS", None)
    texto = valor.isoformat()[:10] if hasattr(valor, "isoformat") else str(valor or "").strip()[:10]
    return texto if re.fullmatch(r"\d{4}-\d{2}-\d{2}", texto) else None


def concluir_envio(base, token):
    corpo = json.dumps({"corteVigencia": corte_vigencia()}).encode("utf-8")
    requisicao = urllib.request.Request(f"{base}/api/internal/analise/concluir", data=corpo, method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json",
    })
    with portal_conexao.abrir(requisicao, timeout=TEMPO_LIMITE_S * 3) as resposta:
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
    dias = sorted(linhas_por_dia(df).items())
    for indice, (data, linhas) in enumerate(dias):
        if len(linhas) > LIMITE_LINHAS_DIA:
            print(f"AVISO: {data} tem {len(linhas):,} linhas; acima do limite da Análise, não enviado.")
            falhas += 1
            continue
        try:
            enviar_dia(endpoint, token, data, linhas)
            enviados += 1
        except (OSError, ValueError, urllib.error.URLError) as erro:
            # Portal indisponivel ou recusando: nao insiste dia a dia. O
            # proximo alerta ou recorte reenvia os dias inteiros.
            falhas += len(dias) - indice
            print(f"AVISO: compras de {data} em diante não enviadas para a Análise: {erro}")
            break
    print(f"  Análise: {enviados} dia(s) enviado(s) ao Portal" + (f", {falhas} com falha" if falhas else "") + ".")
    if enviados:
        try:
            r = concluir_envio(endpoint.rsplit("/api/", 1)[0], token)
            print(f"  Próximas ações: {r.get('novas', 0)} nova(s), {r.get('encerradas', 0)} encerrada(s).")
        except (OSError, ValueError, urllib.error.URLError) as erro:
            print(f"AVISO: próximas ações não atualizadas no Portal: {erro}")
    return enviados, falhas
