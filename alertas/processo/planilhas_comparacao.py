"""Montagem das planilhas de divergências, pendências e recortes históricos."""

import numpy as np
import pandas as pd
import xlsxwriter
from xlsxwriter.utility import xl_col_to_name
from contrato_comparacao import STATUS_COM_ACORDO, STATUS_QUARENTENA, _normcnpj


FONTE = "Arial"
BORDA = {"border": 1, "border_color": "#D9D9D9"}
HDR  = "#1F4E79"
BAND = {"A": "#4C5578",
        "B": "#52606E",
        "C": "#3F6B6B"}
CHIP = {"CONFORME":         "#C6EFCE",
        "ACIMA DO ACORDO":  "#FFC7CE",
        "ABAIXO DO ACORDO": "#BDD7EE",
        "SEM ACORDO":       "#FFE699"}
WASH = {"CONFORME":         "#EAF7EE",
        "ACIMA DO ACORDO":  "#FDEAEA",
        "ABAIXO DO ACORDO": "#EAF1FB",
        "SEM ACORDO":       "#F7F7F7"}
COLUNAS = [
    ("Data",                       11, "date",  "B", False, False),
    ("OS",                         11, "int",   "B", False, False),
    ("Criador",                    18, "text",  "A", False, False),
    ("Cidade",                     15, "text",  "B", False, False),
    ("Fornecedor",                 26, "text",  "A", False, True ),
    ("Modelo",                     24, "text",  "A", False, True ),
    ("Item",                       42, "text",  "A", False, True ),
    ("Motivo Sem Acordo",          24, "text",  "C", False, False),
    ("Qtd",                         6, "qty",   "C", False, False),
    ("Preco OS",                   13, "money", "C", False, False),
    ("Preco Acordo",               14, "money", "C", False, False),
    ("Preco Total OS",             14, "money", "C", False, False),
    ("Preco Total Acordo",         16, "money", "C", False, False),
    ("Diferenca Unit.",            13, "money", "C", False, False),
    ("Diferenca Total",            15, "money", "C", False, False),
    ("Tinha acordo?",              12, "text",  "C", False, False),
    ("Menor Preco Acordo",         16, "money", "C", False, False),
    ("Fornecedor do Acordo",       26, "text",  "C", False, True ),
    ("Dif. p/ Menor Acordo",       18, "money", "C", False, False),
    ("Com acordo",                  11, "text",  "B", False, False),
    ("Status",                     18, "text",  "B", False, False),
    ("CNPJ",                       16, "text",  None, True,  False),
]
SEMPRE_OCULTAR = {"Peca Acordo", "Grupo Despesa"}
DROP_COM_ACORDO = {
    "Motivo Sem Acordo",
    "Tinha acordo?",
    "Menor Preco Acordo",
    "Fornecedor do Acordo",
    "Dif. p/ Menor Acordo",
}



def _gerar_aba(wb, df, drop, nome_tabela, status_cores=None,
               mostrar_cnpj=False):
    excluir  = set(drop) | SEMPRE_OCULTAR
    catalogo = {c[0]: c for c in COLUNAS}
    cols = [n for n, *_ in COLUNAS if n in df.columns and n not in excluir] + \
           [c for c in df.columns if c not in catalogo and c not in excluir]
    idx  = {c: i for i, c in enumerate(cols)}
    L    = {c: xl_col_to_name(i) for i, c in enumerate(cols)}
    nrow, ncol = len(df), len(cols)
    ws   = wb.add_worksheet("Relatório")

    def fmt(size=9, **kw):
        return wb.add_format({"font_name": FONTE, "font_size": size, **BORDA, **kw})
    def hdr(bg):
        return fmt(10, bold=True, font_color="white", bg_color=bg,
                   align="center", valign="vcenter", text_wrap=True)

    spec     = {n: c for n, c in catalogo.items() if n not in excluir}
    hdr_band = {b: hdr(bg) for b, bg in BAND.items()}
    hdr_def  = hdr(HDR)

    def fmt_corpo(name):
        s = spec.get(name, (name, 14, "text", None, False, False))
        p = {"valign": "top"}
        if   s[2] == "money": p |= {"num_format": "R$ #,##0.00", "align": "right"}
        elif s[2] == "qty":   p |= {"num_format": "#,##0",        "align": "center"}
        elif s[2] == "int":   p |= {"num_format": "0",            "align": "center"}
        elif s[2] == "date":  p |= {"num_format": "dd/mm/yyyy",   "align": "center"}
        if s[5]: p["text_wrap"] = True
        return fmt(**p)

    def fmt_hdr(name):
        s = spec.get(name)
        return hdr_band.get(s[3], hdr_def) if s else hdr_def

    col_fmt  = {c: fmt_corpo(c) for c in cols}
    qty_fracionaria = fmt(num_format="#,##0.##", align="center", valign="top")
    chip_fmt = {st: fmt(bg_color=CHIP[st], bold=True, align="center", valign="vcenter") for st in CHIP}
    has_status = "Status" in idx

    for c in cols:
        s      = spec.get(c)
        width  = s[1] if s else 14
        hidden = bool(s[4]) if s else False
        if c == "CNPJ" and mostrar_cnpj:
            hidden = False
        ws.set_column(idx[c], idx[c], width, None, {"level": 1, "hidden": True} if hidden else {})
    ws.set_default_row(28); ws.set_row(0, 30)

    for r, row in enumerate(df.to_dict("records"), 1):
        st = row.get("Status") or "SEM ACORDO"
        for c in cols:
            v  = row.get(c, "")
            if pd.isna(v): v = ""
            elif c == "CNPJ": v = _normcnpj(v)
            f_ = chip_fmt.get(st, col_fmt[c]) if (has_status and c == "Status") else col_fmt[c]
            if c == "Qtd" and isinstance(v, (int, float)) and np.isfinite(v) and v % 1:
                f_ = qty_fracionaria
            ws.write(r, idx[c], v, f_)

    if nrow:
        ws.add_table(0, 0, nrow, ncol - 1, {
            "name": nome_tabela, "style": "Table Style Light 1",
            "banded_rows": False, "header_row": True,
            "columns": [{"header": c, "header_format": fmt_hdr(c)} for c in cols],
        })

    if has_status:
        sc = idx["Status"]
        cores_ativas = WASH.keys() if status_cores is None else status_cores
        for st in cores_ativas:
            bg = WASH[st]
            rule = {"type": "formula", "criteria": f'=${L["Status"]}2="{st}"',
                    "format": wb.add_format({"bg_color": bg})}
            if sc > 0:        ws.conditional_format(1, 0, nrow, sc-1, rule)
            if sc < ncol - 1: ws.conditional_format(1, sc+1, nrow, ncol-1, rule)

    red   = wb.add_format({"font_color": "#C00000", "bold": True})
    green = wb.add_format({"font_color": "#1E7B34"})
    for c in ("Diferenca Unit.", "Diferenca Total"):
        if c in idx:
            rng = (1, idx[c], nrow, idx[c])
            ws.conditional_format(*rng, {"type": "cell", "criteria": ">", "value": 0, "format": red})
            ws.conditional_format(*rng, {"type": "cell", "criteria": "<", "value": 0, "format": green})



def _gerar_tabela_simples(df, path, drop, nome_tabela, nome_aba):
    """Gera tabela listrada, sem quebra de texto e com dimensões ajustadas."""
    excluir = set(drop) | SEMPRE_OCULTAR
    catalogo = {c[0]: c for c in COLUNAS}
    cols = [n for n, *_ in COLUNAS if n in df.columns and n not in excluir] + [
        c for c in df.columns if c not in catalogo and c not in excluir
    ]
    dados = df[cols]
    wb = xlsxwriter.Workbook(path, {"strings_to_formulas": False})
    ws = wb.add_worksheet(nome_aba)
    formatos = {
        "text": wb.add_format({"font_name": FONTE, "font_size": 9}),
        "date": wb.add_format({"font_name": FONTE, "font_size": 9, "num_format": "dd/mm/yyyy"}),
        "int": wb.add_format({"font_name": FONTE, "font_size": 9, "num_format": "0"}),
        "qty": wb.add_format({"font_name": FONTE, "font_size": 9, "num_format": "#,##0"}),
        "money": wb.add_format({"font_name": FONTE, "font_size": 9, "num_format": "R$ #,##0.00"}),
    }

    for r, row in enumerate(dados.to_dict("records"), 1):
        for c, nome in enumerate(cols):
            valor = row.get(nome, "")
            if pd.isna(valor):
                valor = ""
            elif nome == "CNPJ":
                valor = _normcnpj(valor)
            tipo = catalogo.get(nome, (nome, 14, "text", None, False, False))[2]
            ws.write(r, c, valor, formatos.get(tipo, formatos["text"]))

    if len(dados):
        ws.add_table(0, 0, len(dados), len(cols) - 1, {
            "name": nome_tabela,
            "style": "Table Style Medium 15",
            "banded_rows": True,
            "columns": [{"header": c} for c in cols],
        })

    for c, nome in enumerate(cols):
        largura_base = catalogo.get(nome, (nome, 14))[1]
        amostra = [len(str(nome))] + [len(str(v)) for v in dados[nome].dropna().head(500)]
        largura = min(max(largura_base, max(amostra, default=0) + 2), 45)
        ws.set_column(c, c, largura)
    ws.set_default_row(18)
    ws.set_row(0, 20)
    ws.freeze_panes(1, 0)
    wb.close()
    print(f"  Salvo: {path}")



def gerar_alerta_acordo(df, path):
    """Reproduz o layout clássico, sem a regra verde dos conformes."""
    wb = xlsxwriter.Workbook(path, {"strings_to_formulas": False})
    _gerar_aba(
        wb, df, DROP_COM_ACORDO, "DivergenciasAcordo",
        status_cores=("ACIMA DO ACORDO", "ABAIXO DO ACORDO"),
        mostrar_cnpj=True,
    )
    wb.close()
    print(f"  Salvo: {path}")



def preparar_recorte_historico(df):
    """Une os quatro estados elegíveis e identifica a cobertura do acordo."""
    elegiveis = STATUS_COM_ACORDO | {"SEM ACORDO"}
    dados = df[df["Status"].isin(elegiveis)].copy().reset_index(drop=True)
    dados["Com acordo"] = np.where(dados["Status"] == "SEM ACORDO", "NÃO", "SIM")
    return dados



def gerar_recorte_historico(df, path):
    """Gera uma única tabela neutra com linhas com e sem acordo."""
    dados = preparar_recorte_historico(df)
    if dados.empty:
        return False
    _gerar_tabela_simples(
        dados, path, set(), "RecorteHistorico", "Relatório"
    )
    return True



def gerar_pendencias_comparacao(df, path):
    dados = df[df["Status"].isin(STATUS_QUARENTENA)].reset_index(drop=True)
    if dados.empty:
        return False
    _gerar_tabela_simples(dados, path, set(), "PendenciasComparacao", "Pendências")
    return True

