import json, uuid, pathlib

PARQUET = r"C:\Projetos\supply-vision\painel\consolidado\supply_vision_painel.parquet"
T = "Painel"

def guid(seed):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "sv-painel/" + seed))

TEXTO = ["OS","Criador","Cidade","Fornecedor","Modelo","Grupo Modelo","Item","Grupo Item","Motivo Sem Acordo",
         "Tinha acordo?","Fornecedor do Acordo","Status","CNPJ","STATUS_ACORDO","RUN_ID",
         "Ano-Mes","Mes","Trimestre"]
MOEDA = ["Preco OS","Preco Acordo","Preco Total OS","Preco Total Acordo",
         "Diferenca Unit.","Diferenca Total","Menor Preco Acordo","Dif. p/ Menor Acordo"]

M = f'''let
    Fonte = Parquet.Document(File.Contents("{PARQUET}")),
    Tipos = Table.TransformColumnTypes(Fonte, {{{{"Data", type date}}}}),
    ComAno = Table.AddColumn(Tipos, "Ano", each Date.Year([Data]), Int64.Type),
    ComAnoMes = Table.AddColumn(ComAno, "Ano-Mes", each Date.ToText([Data], [Format="yyyy-MM"]), type text),
    ComMes = Table.AddColumn(ComAnoMes, "Mes", each Date.ToText([Data], [Format="MMM/yy", Culture="pt-BR"]), type text),
    ComMesNum = Table.AddColumn(ComMes, "Mes Num", each Date.Month([Data]), Int64.Type),
    ComMesNome = Table.AddColumn(ComMesNum, "Mes Nome", each Date.ToText([Data], [Format="MMMM", Culture="pt-BR"]), type text),
    ComTrimestre = Table.AddColumn(ComMesNome, "Trimestre", each "T" & Text.From(Date.QuarterOfYear([Data])) & "/" & Text.From(Date.Year([Data])), type text),
    // Janela de 30 dias ancorada na data mais recente da BASE, nao em
    // DateTime.LocalNow(): assim a pagina de conformidade e as medidas de 30
    // dias usam exatamente o mesmo recorte, e um refresh atrasado nao esvazia
    // a pagina -- ela passa a mostrar os ultimos 30 dias que existem no dado.
    Fim = List.Max(ComTrimestre[Data]),
    ComJanela = Table.AddColumn(ComTrimestre, "Ultimos 30 dias", each [Data] >= Date.AddDays(Fim, -29), type logical),
    // 365 dias para a fuga de contrato: sem vigencia na ACORDOS.xlsx, uma
    // compra de 2025 que hoje casa com um acordo pode nao ter tido acordo
    // naquela data. Um ano limita o quanto o catalogo de acordos mudou.
    ComJanelaAno = Table.AddColumn(ComJanela, "Ultimos 365 dias", each [Data] >= Date.AddDays(Fim, -364), type logical)
in
    ComJanelaAno'''

def col(nome, tipo, fmt=None, summarize="none", oculta=False):
    c = {"name": nome, "dataType": tipo, "sourceColumn": nome,
         "summarizeBy": summarize, "lineageTag": guid("col/"+nome)}
    if fmt: c["formatString"] = fmt
    if oculta: c["isHidden"] = True
    return c

colunas = [col("Data", "dateTime", "dd/mm/yyyy")]
colunas += [col(c, "string") for c in TEXTO if c != "Ano-Mes" and c != "Mes" and c != "Trimestre"]
colunas += [col("Ano-Mes","string"), col("Mes","string"), col("Trimestre","string")]
_mes_nome = col("Mes Nome","string"); _mes_nome["sortByColumn"] = "Mes Num"
colunas += [_mes_nome]
colunas += [col("Ano", "int64", "0"), col("Mes Num", "int64", "0", oculta=True)]
colunas += [col("Ultimos 30 dias", "boolean"), col("Ultimos 365 dias", "boolean")]
colunas += [col("Qtd", "double", "#,0.##", "sum")]
colunas += [col(c, "double", '"R$" #,0.00', "sum") for c in MOEDA]
colunas += [col("DATA_EXECUCAO", "dateTime", "dd/mm/yyyy hh:nn", oculta=True)]

MOEDA_FMT = '"R$" #,0.00'
MEDIDAS = [
    ("Valor Total",            f"SUM('{T}'[Preco Total OS])", MOEDA_FMT),
    ("Linhas",                 f"COUNTROWS('{T}')", "#,0"),
    ("Valor Fora do Acordo",   f'CALCULATE([Valor Total], \'{T}\'[STATUS_ACORDO] = "SEM_ACORDO")', MOEDA_FMT),
    ("Valor Dentro do Acordo", f'CALCULATE([Valor Total], \'{T}\'[STATUS_ACORDO] = "COM_ACORDO")', MOEDA_FMT),
    ("% Fora do Acordo",       "DIVIDE([Valor Fora do Acordo], [Valor Total])", "0.0%"),

    # ── Fuga de contrato: comprou fora existindo acordo para a combinacao.
    # Mede o VOLUME que deveria ter passado por contrato. O excedente pago
    # (a antiga "Perda Evitavel") saiu do painel: comparava com o menor acordo
    # de qualquer fornecedor, que podia nao ter como atender aquela OS -- teto
    # teorico, nao valor recuperavel.
    ("Valor em Fuga",          f'CALCULATE([Valor Total], \'{T}\'[STATUS_ACORDO] = "SEM_ACORDO", \'{T}\'[Tinha acordo?] = "SIM")', MOEDA_FMT),
    # Fora do acordo que NAO era fuga: nao havia acordo disponivel. Existe para
    # as colunas empilhadas -- sem ela, empilhar "fora" com "fuga" contaria a
    # fuga duas vezes.
    ("Valor Fora Sem Alternativa", "[Valor Fora do Acordo] - [Valor em Fuga]", MOEDA_FMT),

    # ── Conformidade de preco. Respeitam o filtro da pagina: usadas na aba
    # restrita aos ultimos 30 dias.
    ("Valor Acima do Acordo",  f'CALCULATE(SUM(\'{T}\'[Diferenca Total]), \'{T}\'[Status] = "ACIMA DO ACORDO")', MOEDA_FMT),
    ("Valor Abaixo do Acordo", f'CALCULATE(SUM(\'{T}\'[Diferenca Total]), \'{T}\'[Status] = "ABAIXO DO ACORDO")', MOEDA_FMT),
    ("% Acima",                f'DIVIDE(CALCULATE([Valor Total], \'{T}\'[Status] = "ACIMA DO ACORDO"), [Valor Dentro do Acordo])', "0.0%"),
    ("% Conforme",             f'DIVIDE(CALCULATE([Valor Total], \'{T}\'[Status] = "CONFORME"), [Valor Dentro do Acordo])', "0.0%"),
    ("% Abaixo",               f'DIVIDE(CALCULATE([Valor Total], \'{T}\'[Status] = "ABAIXO DO ACORDO"), [Valor Dentro do Acordo])', "0.0%"),

    # ── Janela de 30 dias embutida no DAX, ancorada em MAX(Data) e imune aos
    # filtros da pagina (ALL). Servem para exibir conformidade atual numa
    # pagina historica sem contaminar o resto dela.
    ("Janela 30d",             f"VAR Fim = CALCULATE(MAX('{T}'[Data]), ALL('{T}')) "
                               'RETURN FORMAT(Fim - 29, "dd/mm/yyyy") & " a " & FORMAT(Fim, "dd/mm/yyyy")', None),
    ("Janela 365d",            f"VAR Fim = CALCULATE(MAX('{T}'[Data]), ALL('{T}')) "
                               'RETURN FORMAT(Fim - 364, "dd/mm/yyyy") & " a " & FORMAT(Fim, "dd/mm/yyyy")', None),
    ("Valor Coberto 30d",      f"VAR Fim = CALCULATE(MAX('{T}'[Data]), ALL('{T}')) "
                               f"RETURN CALCULATE([Valor Total], ALL('{T}'), '{T}'[Data] >= Fim - 29, "
                               f"'{T}'[Data] <= Fim, '{T}'[STATUS_ACORDO] = \"COM_ACORDO\")", MOEDA_FMT),
    ("% Acima 30d",            f"VAR Fim = CALCULATE(MAX('{T}'[Data]), ALL('{T}')) "
                               f"VAR Acima = CALCULATE([Valor Total], ALL('{T}'), '{T}'[Data] >= Fim - 29, "
                               f"'{T}'[Data] <= Fim, '{T}'[Status] = \"ACIMA DO ACORDO\") "
                               "RETURN DIVIDE(Acima, [Valor Coberto 30d])", "0.0%"),
    ("% Conforme 30d",         f"VAR Fim = CALCULATE(MAX('{T}'[Data]), ALL('{T}')) "
                               f"VAR Conf = CALCULATE([Valor Total], ALL('{T}'), '{T}'[Data] >= Fim - 29, "
                               f"'{T}'[Data] <= Fim, '{T}'[Status] = \"CONFORME\") "
                               "RETURN DIVIDE(Conf, [Valor Coberto 30d])", "0.0%"),
    ("% Abaixo 30d",           f"VAR Fim = CALCULATE(MAX('{T}'[Data]), ALL('{T}')) "
                               f"VAR Ab = CALCULATE([Valor Total], ALL('{T}'), '{T}'[Data] >= Fim - 29, "
                               f"'{T}'[Data] <= Fim, '{T}'[Status] = \"ABAIXO DO ACORDO\") "
                               "RETURN DIVIDE(Ab, [Valor Coberto 30d])", "0.0%"),
    ("Excedente Acima 30d",    f"VAR Fim = CALCULATE(MAX('{T}'[Data]), ALL('{T}')) "
                               f"RETURN CALCULATE(SUM('{T}'[Diferenca Total]), ALL('{T}'), "
                               f"'{T}'[Data] >= Fim - 29, '{T}'[Data] <= Fim, "
                               f"'{T}'[Status] = \"ACIMA DO ACORDO\")", MOEDA_FMT),

    # ── ano anterior, para a aba de analises mensais e anuais ──────
    ("Valor Total Ano Anterior", f"VAR A = MAX('{T}'[Ano]) "
                                 f"RETURN CALCULATE([Valor Total], ALL('{T}'[Ano]), '{T}'[Ano] = A - 1)", MOEDA_FMT),

    ("Fornecedores",           f"DISTINCTCOUNT('{T}'[Fornecedor])", "#,0"),
    ("Cidades",                f"DISTINCTCOUNT('{T}'[Cidade])", "#,0"),
    ("Itens",                  f"DISTINCTCOUNT('{T}'[Grupo Item])", "#,0"),
    ("Modelos",                f"DISTINCTCOUNT('{T}'[Grupo Modelo])", "#,0"),
    ("% do Fora do Acordo",    "DIVIDE([Valor Fora do Acordo], "
                               "CALCULATE([Valor Fora do Acordo], ALLSELECTED()))", "0.0%"),
    ("Ultima Execucao",        f"MAX('{T}'[DATA_EXECUCAO])", "dd/mm/yyyy hh:nn"),
]

def _medida(n, e, f):
    m = {"name": n, "expression": e, "lineageTag": guid("med/"+n)}
    if f: m["formatString"] = f
    return m
medidas = [_medida(*x) for x in MEDIDAS]

model = {
    "name": "SupplyVisionPainel",
    # 1606 e o nivel que o Desktop 2.156 usa ao criar o banco tabular local.
    # Banco tabular nao aceita downgrade de compatibilityLevel: declarar um
    # numero menor aqui faz o projeto inteiro falhar ao abrir, porque o Desktop
    # cria o banco no nivel dele e depois aplica este TMSL. Se um dia a
    # mensagem trouxer um nivel maior ("CompatibilityLevel atual"), e esse o
    # numero que entra aqui.
    "compatibilityLevel": 1606,
    "model": {
        "culture": "pt-BR",
        "defaultPowerBIDataSourceVersion": "powerBI_V3",
        "sourceQueryCulture": "pt-BR",
        "dataAccessOptions": {"legacyRedirects": True, "returnErrorValuesAsNull": True},
        "tables": [{
            "name": T,
            "lineageTag": guid("tbl/"+T),
            "columns": colunas,
            "measures": medidas,
            "partitions": [{
                "name": T, "mode": "import",
                "source": {"type": "m", "expression": M.split("\n")}
            }],
        }],
        "annotations": [{"name": "PBI_QueryOrder", "value": json.dumps([T])}],
    },
}

pathlib.Path("model.bim.json").write_text(json.dumps(model, indent=2, ensure_ascii=False), encoding="utf-8")
print("colunas:", len(colunas), "| medidas:", len(medidas))
