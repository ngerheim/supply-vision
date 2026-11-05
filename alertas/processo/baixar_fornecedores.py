"""
Cópia diária dos fornecedores do ERP para a aba Rede do Portal.

Lê no Qlik a tabela da pasta de fornecedores (QLIK_REDE_APP_ID e
QLIK_REDE_SHEET_ID em cfg_ambiente.txt), mantém só os fornecedores
disponíveis e envia a lista inteira ao Portal, que troca a cópia de uma vez.

O pipeline roda isto uma vez por dia, depois do alerta. À mão:
    python processo/baixar_fornecedores.py [--aceitar-queda]
--aceitar-queda aceita uma lista com menos da metade dos fornecedores atuais.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date

import portal_conexao
import qlik
import sv_paths
from segredos import mascarar

# coluna da tabela do Qlik → campo enviado ao Portal
COLUNAS = {
    "Cód Fornecedor": "codigo",
    "Nome Fantasia": "nomeFantasia",
    "Razão Social": "razaoSocial",
    "Cidade": "cidade",
    "UF": "uf",
    "CNPJ": "cnpj",
    "Telefone": "telefone",
    "E-mail": "email",
    "Segmento": "segmentos",
    "Data Último Pedido": "ultimoPedido",
}
COLUNA_SITUACAO = "Situação do Fornecedor"
OBRIGATORIAS = (*COLUNAS, COLUNA_SITUACAO)
# Só "A" entra na Rede; N, R, P e I são bloqueados ou inativos no ERP.
SITUACOES_DISPONIVEIS = {"A"}
VAZIOS = {"", "-", "—"}
# A troca da cópia no Portal grava milhares de linhas de uma vez.
TEMPO_LIMITE_S = 120


def _texto(valor):
    texto = "" if valor is None else str(valor).strip()
    return None if texto in VAZIOS else texto


def _codigo(valor):
    """Código do ERP; tira o separador de milhar que o Qlik pode exibir."""
    texto = _texto(valor)
    if texto and re.fullmatch(r"\d{1,3}(\.\d{3})+", texto):
        texto = texto.replace(".", "")
    return texto


def _segmentos(valor):
    """O Qlik exibe a lista como JSON: ["Mecânica Automotiva","Auto Peças"]."""
    texto = _texto(valor)
    if not texto:
        return []
    try:
        lista = json.loads(texto)
    except ValueError:
        lista = [texto]
    if not isinstance(lista, list):
        lista = [lista]
    return list(dict.fromkeys(s for s in (_texto(x) for x in lista) if s))


def _data(valor):
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", _texto(valor) or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def preparar(headers, rows):
    """Linhas do Qlik → fornecedores disponíveis. Devolve (lista, fora da Rede).

    O mesmo código repetido (uma dimensão a mais na tabela) vira um só
    fornecedor, com os segmentos somados.
    """
    faltam = [c for c in OBRIGATORIAS if c not in headers]
    if faltam:
        raise qlik.QlikErro(f"Colunas ausentes na tabela de fornecedores: {', '.join(faltam)}. "
                            f"Recebidas: {', '.join(map(str, headers))}.")
    indice = {c: headers.index(c) for c in OBRIGATORIAS}
    por_codigo, fora = {}, 0
    for row in rows:
        def valor(coluna):
            i = indice[coluna]
            return row[i] if i < len(row) else None
        if (_texto(valor(COLUNA_SITUACAO)) or "").upper() not in SITUACOES_DISPONIVEIS:
            fora += 1
            continue
        codigo = _codigo(valor("Cód Fornecedor"))
        if not codigo:
            fora += 1
            continue
        linha = {campo: _texto(valor(coluna)) for coluna, campo in COLUNAS.items()}
        uf = linha["uf"]
        linha.update(codigo=codigo, segmentos=_segmentos(valor("Segmento")),
                     ultimoPedido=_data(valor("Data Último Pedido")),
                     uf=uf.upper() if uf and re.fullmatch(r"[A-Za-z]{2}", uf) else None)
        if not linha["nomeFantasia"] and not linha["razaoSocial"]:
            fora += 1
            continue
        existente = por_codigo.get(codigo)
        if existente:
            existente["segmentos"] = list(dict.fromkeys(existente["segmentos"] + linha["segmentos"]))
        else:
            por_codigo[codigo] = linha
    return list(por_codigo.values()), fora


def enviar(linhas, aceitar_queda=False, url=None, token=None):
    url = url if url is not None else str(sv_paths.PORTAL_URL)
    token = token if token is not None else str(sv_paths.PORTAL_API_TOKEN)
    if not url or not token:
        raise RuntimeError("Portal não configurado (PORTAL_URL e PORTAL_API_TOKEN em portal.env).")
    base = portal_conexao.endereco_interno(url, str(getattr(sv_paths, "PORTAL_INTERNAL_URL", "")))
    corpo = json.dumps({"linhas": linhas, "aceitarQueda": aceitar_queda}, ensure_ascii=False).encode("utf-8")
    requisicao = urllib.request.Request(f"{base}/api/internal/rede", data=corpo, method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json",
    })
    try:
        with portal_conexao.abrir(requisicao, timeout=TEMPO_LIMITE_S) as resposta:
            return json.loads(resposta.read().decode("utf-8"))
    except urllib.error.HTTPError as erro:
        try:
            motivo = json.loads(erro.read().decode("utf-8")).get("error")
        except (OSError, ValueError, AttributeError):
            motivo = None
        raise RuntimeError(f"Portal recusou a lista (HTTP {erro.code}): {motivo or erro.reason}") from None


def marcar_concluido(hoje=None):
    sv_paths.REDE_MARCADOR.parent.mkdir(parents=True, exist_ok=True)
    sv_paths.REDE_MARCADOR.write_text((hoje or date.today()).isoformat(), encoding="utf-8")


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    app, pasta = sv_paths.QLIK_REDE_APP_ID, sv_paths.QLIK_REDE_SHEET_ID
    if not app or not pasta:
        print("AVISO: QLIK_REDE_APP_ID e QLIK_REDE_SHEET_ID ausentes em cfg_ambiente.txt; Rede não atualizada.")
        print("RESULTADO=REDE_NAO_CONFIGURADA")
        return 0
    with qlik.Sessao(sv_paths.QLIK_TENANT, app, str(sv_paths.CFG_QLIK)) as s:
        h, headers, qcx = s.tabela_da_pasta(pasta, OBRIGATORIAS)
        rows = s.ler(h, headers, qcx, set())
    linhas, fora = preparar(headers, rows)
    print(f"Fornecedores lidos: {len(rows):,} | disponíveis: {len(linhas):,} | fora da Rede: {fora:,}")
    if not linhas:
        print("ERRO: nenhum fornecedor disponível na tabela; a Rede do Portal foi mantida.")
        return 1
    r = enviar(linhas, "--aceitar-queda" in argv)
    print(f"Rede atualizada no Portal: {r.get('linhas', 0):,} fornecedores, {r.get('semCoordenada', 0):,} sem coordenada.")
    marcar_concluido()
    print("RESULTADO=REDE_ATUALIZADA")
    return 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    from pipeline import garantir_lock_entrada
    garantir_lock_entrada()
    try:
        sys.exit(main())
    except (qlik.QlikErro, RuntimeError, OSError, ValueError) as erro:
        print(f"ERRO: {mascarar(str(erro), str(sv_paths.PORTAL_API_TOKEN))}")
        sys.exit(1)
