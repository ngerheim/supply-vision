"""
Histórico de OS para a calculadora de Reembolso do Portal.

Lê no mesmo objeto do Qlik que o alerta usa (QLIK_APP_ID/QLIK_OBJ_ID) os
itens de OS por data de abertura e envia ao Portal placa, OS, KM, produto e
valores. O Portal troca as linhas de cada data enviada de uma vez, então
repetir um período nunca duplica nada, e descarta o que estiver nos filtros
da tela Reembolso › Histórico de OS.

O pipeline roda isto uma vez por dia, depois do alerta, com os últimos
DIAS_DIARIOS dias (pega lançamentos atrasados). Carga inicial à mão:
    python processo/baixar_historico_os.py --tudo
    python processo/baixar_historico_os.py --de 2024-11-01 [--ate 2026-11-05]
--tudo começa na primeira data de abertura existente no Qlik. O período é
baixado em blocos de DIAS_POR_BLOCO dias; se parar no meio, rode de novo com
--de na data indicada.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

import portal_conexao
import qlik
import sv_paths
from segredos import mascarar

CAMPO_DATA = "OS.OSABERTURADATA"
DIAS_DIARIOS = 7
DIAS_POR_BLOCO = 10
# Troca de dias no Portal grava milhares de linhas por envio.
TEMPO_LIMITE_S = 180

# coluna do objeto do Qlik → campo enviado ao Portal
OBRIGATORIAS = ("Data Abertura", "Placa", "Codigo OS", "Descrição", "KM OS")
OPCIONAIS = {
    "OS Quantidade": "qtd",
    "Valor Unitario": "valorUnit",
    "Valor Total": "total",
    "Valor Reembolso": "reembolso",
    "Fornecedor": "fornecedor",
    "Grupo Despesa": "grupo",
    "Modelo": "modelo",
    "Cliente": "cliente",
}
NUMERICAS = {"OS Quantidade", "Valor Unitario", "Valor Total", "Valor Reembolso"}
VAZIOS = {"", "-", "—", "nan", "None"}


def _texto(valor, limite=200):
    texto = "" if valor is None else str(valor).strip()
    return None if texto in VAZIOS else texto[:limite]


def _data(valor):
    texto = _texto(valor) or ""
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", texto)
    if m:
        texto = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    elif re.fullmatch(r"\d{5}", texto):  # serial do Qlik/Excel
        texto = (date(1899, 12, 30) + timedelta(days=int(texto))).isoformat()
    try:
        return date.fromisoformat(texto[:10]).isoformat()
    except ValueError:
        return None


def _inteiro(valor):
    """KM e código de OS chegam como texto; aceita separador de milhar."""
    texto = _texto(valor) or ""
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", texto):
        texto = texto.replace(".", "")
    texto = texto.split(",")[0]
    return int(texto) if texto.isdigit() else None


def _numero(valor):
    return float(valor) if isinstance(valor, (int, float)) and valor == valor else None


def preparar(headers, rows, datas):
    """Linhas do Qlik → linhas do histórico. Devolve (linhas, descartadas).

    Fica fora a linha sem placa, sem produto ou com data fora do bloco. Não
    junta linhas iguais: duas linhas idênticas podem ser dois itens da OS.
    """
    faltam = [c for c in OBRIGATORIAS if c not in headers]
    if faltam:
        raise qlik.QlikErro(f"Colunas ausentes no objeto do Qlik: {', '.join(faltam)}.")
    indice = {c: headers.index(c) for c in (*OBRIGATORIAS, *OPCIONAIS) if c in headers}
    periodo = {d.isoformat() for d in datas}
    linhas, fora = [], 0
    for row in rows:
        def valor(coluna):
            i = indice.get(coluna)
            return row[i] if i is not None and i < len(row) else None
        data = _data(valor("Data Abertura"))
        placa = re.sub(r"[^A-Z0-9]", "", str(valor("Placa") or "").upper())
        produto = _texto(valor("Descrição"))
        if data not in periodo or not 5 <= len(placa) <= 10 or not produto:
            fora += 1
            continue
        os_ = _inteiro(valor("Codigo OS"))
        km = _inteiro(valor("KM OS"))
        linha = {"data": data, "placa": placa, "os": str(os_) if os_ is not None else _texto(valor("Codigo OS"), 30),
                 "produto": produto, "km": km if km and km > 0 else None}
        for coluna, campo in OPCIONAIS.items():
            linha[campo] = _numero(valor(coluna)) if coluna in NUMERICAS else _texto(valor(coluna))
        linhas.append(linha)
    return linhas, fora


def enviar(datas, linhas, url=None, token=None):
    url = url if url is not None else str(sv_paths.PORTAL_URL)
    token = token if token is not None else str(sv_paths.PORTAL_API_TOKEN)
    if not url or not token:
        raise RuntimeError("Portal não configurado (PORTAL_URL e PORTAL_API_TOKEN em portal.env).")
    base = portal_conexao.endereco_interno(url, str(getattr(sv_paths, "PORTAL_INTERNAL_URL", "")))
    corpo = json.dumps({"datas": [d.isoformat() for d in datas], "linhas": linhas}, ensure_ascii=False).encode("utf-8")
    requisicao = urllib.request.Request(f"{base}/api/internal/reembolso-historico", data=corpo, method="POST", headers={
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
        raise RuntimeError(f"Portal recusou o histórico (HTTP {erro.code}): {motivo or erro.reason}") from None


def blocos(inicio, fim, tamanho=DIAS_POR_BLOCO):
    """Dias de inicio a fim (inclusive), em listas de até `tamanho` dias."""
    dias = [inicio + timedelta(days=n) for n in range((fim - inicio).days + 1)]
    return [dias[i:i + tamanho] for i in range(0, len(dias), tamanho)]


def periodo(argv, hoje=None, primeira=None):
    """(início, fim, manual). --tudo usa `primeira`, a menor data do Qlik."""
    hoje = hoje or date.today()
    if "--tudo" in argv:
        if primeira is None:
            raise ValueError("Não foi possível descobrir a primeira data no Qlik; use --de AAAA-MM-DD.")
        return primeira, hoje, True
    valores = {}
    for i, arg in enumerate(argv):
        for chave in ("--de", "--ate"):
            if arg == chave and i + 1 < len(argv):
                valores[chave] = argv[i + 1]
            elif arg.startswith(chave + "="):
                valores[chave] = arg.split("=", 1)[1]
    if "--de" not in valores:
        return hoje - timedelta(days=DIAS_DIARIOS - 1), hoje, False
    try:
        inicio = datetime.strptime(valores["--de"], "%Y-%m-%d").date()
        fim = datetime.strptime(valores.get("--ate", hoje.isoformat()), "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Use --de AAAA-MM-DD [--ate AAAA-MM-DD].") from None
    if fim < inicio or fim > hoje:
        raise ValueError("Período inválido: --ate deve ser depois de --de e no máximo hoje.")
    return inicio, fim, True


def marcar_concluido(hoje=None):
    sv_paths.HISTORICO_OS_MARCADOR.parent.mkdir(parents=True, exist_ok=True)
    sv_paths.HISTORICO_OS_MARCADOR.write_text((hoje or date.today()).isoformat(), encoding="utf-8")


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    total = 0
    with qlik.Sessao(sv_paths.QLIK_TENANT, sv_paths.QLIK_APP_ID, str(sv_paths.CFG_QLIK)) as s:
        inicio, fim, manual = periodo(argv, primeira=s.primeira_data(CAMPO_DATA) if "--tudo" in argv else None)
        lista = blocos(inicio, fim)
        print(f"Histórico de OS: {inicio.isoformat()} a {fim.isoformat()} em {len(lista)} bloco(s).")
        h, headers, qcx = s.abrir_objeto(sv_paths.QLIK_OBJ_ID)
        for n, datas in enumerate(lista, 1):
            try:
                # Zero datas casadas deixaria o campo sem seleção, isto é, a
                # base inteira: nesse caso nada é lido e o Portal só zera o período.
                casadas = s.selecionar_datas(CAMPO_DATA, datas)
                rows = s.ler(h, headers, qcx, NUMERICAS) if casadas else []
                linhas, fora = preparar(headers, rows, datas) if rows else ([], 0)
                r = enviar(datas, linhas)
            except (qlik.QlikErro, RuntimeError, OSError) as erro:
                if not manual:
                    raise
                raise RuntimeError(f"{erro} Os blocos anteriores ficaram gravados; retome com --de {datas[0].isoformat()}.") from None
            total += r.get("linhas", 0)
            print(f"  bloco {n}/{len(lista)} ({datas[0].isoformat()} a {datas[-1].isoformat()}): "
                  f"{len(linhas):,} itens enviados, {r.get('filtradas', 0):,} barrados pelos filtros do Portal, "
                  f"{fora:,} sem placa/produto/data.", flush=True)
    if not manual:
        marcar_concluido()
    print(f"Histórico de OS atualizado no Portal: {total:,} itens.")
    print("RESULTADO=HISTORICO_OS_ATUALIZADO")
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
