"""
Consulta sob demanda: itens de OS de uma placa, para a calculadora de
Reembolso do Portal.

O Portal chama este script quando alguém digita a placa (e guarda o
resultado por algumas horas). Lê o mesmo objeto do Qlik que o alerta usa
(QLIK_APP_ID/QLIK_OBJ_ID), seleciona só a placa, sem filtro de data, e
devolve as linhas numa única linha de saída:
    RESULTADO_JSON={"placa": "...", "linhas": [...]}
Não toma o lock do pipeline: só lê o Qlik e não grava nada.

À mão (para medir o tempo):
    python processo/consultar_os_placa.py ABC1D23
"""
import json
import re
import sys
import time
from datetime import date, timedelta

import qlik
import sv_paths

COLUNA_PLACA = "Placa"
# coluna do objeto do Qlik → campo devolvido ao Portal
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


def placa_valida(valor):
    placa = re.sub(r"[^A-Z0-9]", "", str(valor or "").upper())
    if not 5 <= len(placa) <= 10:
        raise ValueError("Placa inválida.")
    return placa


def preparar(headers, rows, placa):
    """Linhas do Qlik → itens da placa. Devolve (linhas, descartadas).

    Fica fora a linha de outra placa, sem produto ou sem data. Não junta
    linhas iguais: duas linhas idênticas podem ser dois itens da OS.
    """
    faltam = [c for c in OBRIGATORIAS if c not in headers]
    if faltam:
        raise qlik.QlikErro(f"Colunas ausentes no objeto do Qlik: {', '.join(faltam)}.")
    indice = {c: headers.index(c) for c in (*OBRIGATORIAS, *OPCIONAIS) if c in headers}
    linhas, fora = [], 0
    for row in rows:
        def valor(coluna):
            i = indice.get(coluna)
            return row[i] if i is not None and i < len(row) else None
        data = _data(valor("Data Abertura"))
        produto = _texto(valor("Descrição"))
        if not data or not produto or re.sub(r"[^A-Z0-9]", "", str(valor("Placa") or "").upper()) != placa:
            fora += 1
            continue
        os_ = _inteiro(valor("Codigo OS"))
        km = _inteiro(valor("KM OS"))
        linha = {"data": data, "os": str(os_) if os_ is not None else _texto(valor("Codigo OS"), 30),
                 "produto": produto, "km": km if km and km > 0 else None}
        for coluna, campo in OPCIONAIS.items():
            linha[campo] = _numero(valor(coluna)) if coluna in NUMERICAS else _texto(valor(coluna))
        linhas.append(linha)
    return linhas, fora


def consultar(placa):
    with qlik.Sessao(sv_paths.QLIK_TENANT, sv_paths.QLIK_APP_ID, str(sv_paths.CFG_QLIK)) as s:
        h, headers, qcx = s.abrir_objeto(sv_paths.QLIK_OBJ_ID)
        campo = s.campo_da_coluna(h, COLUNA_PLACA)
        # Zero casadas deixaria o campo sem seleção, isto é, a base inteira.
        if not s.selecionar_textos(campo, [placa]):
            return [], 0
        return preparar(headers, s.ler(h, headers, qcx, NUMERICAS), placa)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    placa = placa_valida(argv[0] if argv else "")
    inicio = time.monotonic()
    linhas, fora = consultar(placa)
    print(f"Placa {placa}: {len(linhas):,} itens de OS em {time.monotonic() - inicio:.1f} s ({fora:,} descartados).", file=sys.stderr)
    print("RESULTADO_JSON=" + json.dumps({"placa": placa, "linhas": linhas}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        sys.exit(main())
    except (qlik.QlikErro, OSError, ValueError) as erro:
        print(f"ERRO: {erro}", file=sys.stderr)
        sys.exit(1)
