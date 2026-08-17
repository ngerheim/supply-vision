import json, uuid, pathlib

PARQUET = r"C:\Projetos\supply-vision-privado\painel\consolidado\supply_vision_painel.parquet"
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
    // Ancora no ultimo dia COMPLETO, nao no maior [Data] da base: a extracao
    // roda no meio da tarde, entao o dia corrente esta sempre parcial e puxa a
    // janela de 30 dias para baixo, junto com a base de conformidade. Um unico
    // registro do dia corrente desloca a janela inteira. Medicao em docs/wiki.
    DataExec = Date.From(List.Max(ComTrimestre[DATA_EXECUCAO])),
    Fim = List.Max(List.Select(ComTrimestre[Data], each Date.From(_) < DataExec)),
    ComJanela = Table.AddColumn(ComTrimestre, "Ultimos 30 dias", each [Data] >= Date.AddDays(Fim, -29), type logical),
    // 365 dias para a fuga de contrato: sem vigencia na ACORDOS.xlsx, uma
    // compra de 2025 que hoje casa com um acordo pode nao ter tido acordo
    // naquela data. Um ano limita o quanto o catalogo de acordos mudou.
    ComJanelaAno = Table.AddColumn(ComJanela, "Ultimos 365 dias", each [Data] >= Date.AddDays(Fim, -364), type logical),
    // O mes corrente esta sempre incompleto: em 13/08/2026 agosto tem 12 dias,
    // e a coluna cai a ~40% das outras em qualquer grafico mensal. Isso le como
    // queda de gasto, que nao houve. Todo grafico com Ano-Mes no eixo filtra por
    // "Mes Fechado" para nao mostrar um mes que ainda esta acontecendo.
    InicioMesFim = Date.StartOfMonth(Fim),
    ComMesFechado = Table.AddColumn(ComJanelaAno, "Mes Fechado", each [Data] < InicioMesFim, type logical),
    // Doze meses fechados: a janela de 365 dias corta o mes inicial no meio
    // (comeca em 13/08/2025), entao o primeiro mes do grafico tambem aparecia
    // pela metade. Esta coluna pega meses inteiros nas duas pontas.
    Inicio12 = Date.AddMonths(InicioMesFim, -12),
    Com12Meses = Table.AddColumn(ComMesFechado, "Ultimos 12 meses fechados",
        each [Data] >= Inicio12 and [Data] < InicioMesFim, type logical)
in
    Com12Meses'''

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
colunas += [col("Ultimos 30 dias", "boolean"), col("Ultimos 365 dias", "boolean"),
            col("Mes Fechado", "boolean"), col("Ultimos 12 meses fechados", "boolean")]
colunas += [col("Qtd", "double", "#,0.##", "sum")]
colunas += [col(c, "double", '"R$" #,0.00', "sum") for c in MOEDA]
colunas += [col("DATA_EXECUCAO", "dateTime", "dd/mm/yyyy hh:nn", oculta=True)]

MOEDA_FMT = '"R$" #,0.00'

FIM = "VAR Fim = [Data Fim Completa] "


def janela(dias, expr="[Valor Total]", extra=(), inicio=">="):
    """Medida restrita a uma janela que TERMINA no ultimo dia completo.

    Existe para nao haver dez strings quase iguais. Na primeira versao havia, e
    a diferenca entre elas era ALL() ou KEEPFILTERS -- ao converter, converti
    duas e deixei oito para tras, e os cartoes ficaram parados no total quando o
    leitor filtrava um fornecedor. Um helper unico torna esse erro impossivel de
    cometer pela metade.

    KEEPFILTERS, nunca ALL(): ALL() remove TODO filtro, inclusive fornecedor,
    item e cidade. O que se quer e restringir a data POR CIMA do contexto, nao
    apagar o contexto. A unica medida que legitimamente usa ALL() e
    [Data Fim Completa], porque a ancora da janela precisa ser global -- do
    contrario cada fornecedor teria a sua propria data de fim.
    """
    partes = [f"KEEPFILTERS('{T}'[Data] {inicio} Fim - {dias})",
              f"KEEPFILTERS('{T}'[Data] <= Fim)"]
    partes += [f"KEEPFILTERS('{T}'[{c}] = \"{v}\")" for c, v in extra]
    return FIM + f"RETURN CALCULATE({expr}, " + ", ".join(partes) + ")"


MEDIDAS = [
    ("Data Fim Completa",      f"VAR Exec = CALCULATE(MAX('{T}'[DATA_EXECUCAO]), ALL('{T}')) "
                               f"VAR DiaExec = DATE(YEAR(Exec), MONTH(Exec), DAY(Exec)) "
                               f"RETURN CALCULATE(MAX('{T}'[Data]), ALL('{T}'), "
                               f"'{T}'[Data] < DiaExec)", "dd/mm/yyyy"),
    ("Valor Total",            f"SUM('{T}'[Preco Total OS])", MOEDA_FMT),
    ("Linhas",                 f"COUNTROWS('{T}')", "#,0"),
    ("Valor Sem Acordo",   f'CALCULATE([Valor Total], \'{T}\'[STATUS_ACORDO] = "SEM_ACORDO")', MOEDA_FMT),
    ("Valor Dentro do Acordo", f'CALCULATE([Valor Total], \'{T}\'[STATUS_ACORDO] = "COM_ACORDO")', MOEDA_FMT),
    ("% Sem Acordo",       "DIVIDE([Valor Sem Acordo], [Valor Total])", "0.0%"),

    ("Valor em Fuga",          f'CALCULATE([Valor Total], \'{T}\'[STATUS_ACORDO] = "SEM_ACORDO", \'{T}\'[Tinha acordo?] = "SIM")', MOEDA_FMT),
    ("Valor Sem Alternativa", "[Valor Sem Acordo] - [Valor em Fuga]", MOEDA_FMT),

    ("% Acima",                f'DIVIDE(CALCULATE([Valor Total], \'{T}\'[Status] = "ACIMA DO ACORDO"), [Valor Dentro do Acordo])', "0.0%"),
    ("% Conforme",             f'DIVIDE(CALCULATE([Valor Total], \'{T}\'[Status] = "CONFORME"), [Valor Dentro do Acordo])', "0.0%"),
    ("% Abaixo",               f'DIVIDE(CALCULATE([Valor Total], \'{T}\'[Status] = "ABAIXO DO ACORDO"), [Valor Dentro do Acordo])', "0.0%"),

    ("Janela 30d",             FIM +
                               'RETURN FORMAT(Fim - 29, "dd/mm/yyyy") & " a " & FORMAT(Fim, "dd/mm/yyyy")', None),
    ("Janela 365d",            FIM +
                               'RETURN FORMAT(Fim - 364, "dd/mm/yyyy") & " a " & FORMAT(Fim, "dd/mm/yyyy")', None),

    ("Valor Dentro do Acordo 30d", janela(29, extra=[("STATUS_ACORDO", "COM_ACORDO")]), MOEDA_FMT),
    ("Valor Total 30d",        janela(29), MOEDA_FMT),
    ("Valor Sem Acordo 30d",   janela(29, extra=[("STATUS_ACORDO", "SEM_ACORDO")]), MOEDA_FMT),
    ("% Sem Acordo 30d",       "DIVIDE([Valor Sem Acordo 30d], [Valor Total 30d])", "0.0%"),
    ("Excedente Acima 30d",    janela(29, expr=f"SUM('{T}'[Diferenca Total])",
                                      extra=[("Status", "ACIMA DO ACORDO")]), MOEDA_FMT),
    ("Preco Acordo Vigente",   janela(29, expr=f"SUM('{T}'[Preco Acordo])"), MOEDA_FMT),

    ("Valor Total 365d",       janela(365, inicio=">"), MOEDA_FMT),
    ("Valor Sem Acordo 365d",  janela(365, inicio=">",
                                      extra=[("STATUS_ACORDO", "SEM_ACORDO")]), MOEDA_FMT),
    ("Valor em Fuga 365d",     janela(365, inicio=">",
                                      extra=[("STATUS_ACORDO", "SEM_ACORDO"),
                                             ("Tinha acordo?", "SIM")]), MOEDA_FMT),
    ("% da Fuga sobre o Sem Acordo 365d",
     "DIVIDE([Valor em Fuga 365d], [Valor Sem Acordo 365d])", "0.0%"),

    ("Fornecedores",           f"DISTINCTCOUNT('{T}'[Fornecedor])", "#,0"),
    ("Cidades",                f"DISTINCTCOUNT('{T}'[Cidade])", "#,0"),
    ("Itens",                  f"DISTINCTCOUNT('{T}'[Grupo Item])", "#,0"),
    ("Modelos",                f"DISTINCTCOUNT('{T}'[Grupo Modelo])", "#,0"),
    ("% do Sem Acordo",    "DIVIDE([Valor Sem Acordo], "
                               "CALCULATE([Valor Sem Acordo], ALLSELECTED()))", "0.0%"),
    ("Ultima Execucao",        f"MAX('{T}'[DATA_EXECUCAO])", "dd/mm/yyyy hh:nn"),

    ("Atualizacao",
     '"Dados até " & FORMAT([Data Fim Completa], "dd/mm/yyyy") & '
     '"   |   Atualizado em " & FORMAT([Ultima Execucao], "dd/mm/yyyy") & '
     '" às " & FORMAT([Ultima Execucao], "HH:mm")', None),
] + [
    (f"% Top 20 {rot}",
     f"VAR Base = FILTER(ALL('{T}'[{dim}]), NOT ISBLANK('{T}'[{dim}])) "
     f"VAR Top20 = TOPN(20, Base, [{med}], DESC, '{T}'[{dim}], ASC) "
     f"VAR VTop = SUMX(Top20, CALCULATE([{med}])) "
     f"VAR VTot = SUMX(Base, CALCULATE([{med}])) "
     "RETURN DIVIDE(VTop, VTot)", "0.0%")
    for rot, dim, med in [
        ("Cidades",              "Cidade",     "Valor Total"),
        ("Fornecedores",         "Fornecedor", "Valor Total"),
        ("Grupos de Item",       "Grupo Item", "Valor Total"),
        ("Fornecedores SA",      "Fornecedor", "Valor Sem Acordo"),
        ("Grupos de Item SA",    "Grupo Item", "Valor Sem Acordo"),
        ("Fornecedores Fuga",    "Fornecedor", "Valor em Fuga 365d"),
        ("Grupos de Item Fuga",  "Grupo Item", "Valor em Fuga 365d"),
        ("Cidades Fuga",         "Cidade",     "Valor em Fuga 365d"),
    ]
] + [
    ("Cidades com Fuga 365d",
     f"COUNTROWS(FILTER(FILTER(ALL('{T}'[Cidade]), NOT ISBLANK('{T}'[Cidade])), "
     "CALCULATE([Valor em Fuga 365d]) > 0))", "#,0"),

    ("Titulo VG Cidades",
     '"Top 20 cidades — " & FORMAT([% Top 20 Cidades], "0.0%") & " do total"', None),
    ("Titulo VG Fornecedores",
     '"Top 20 fornecedores — " & FORMAT([% Top 20 Fornecedores], "0.0%") & " do total"', None),
    ("Titulo VG Grupos de Item",
     '"Top 20 itens — " & FORMAT([% Top 20 Grupos de Item], "0.0%") & " do total"', None),
    ("Titulo SA Fornecedores",
     '"Top 20 fornecedores — " & FORMAT([% Top 20 Fornecedores SA], "0.0%") & " do sem acordo"', None),
    ("Titulo SA Grupos de Item",
     '"Top 20 itens — " & FORMAT([% Top 20 Grupos de Item SA], "0.0%") & " do sem acordo"', None),
    ("Titulo Fuga Fornecedores",
     '"Top 20 fornecedores — " & FORMAT([% Top 20 Fornecedores Fuga], "0.0%") & " da fuga"', None),
    ("Titulo Fuga Grupos de Item",
     '"Top 20 grupos de item — " & FORMAT([% Top 20 Grupos de Item Fuga], "0.0%") & " da fuga"', None),
    ("Titulo Fuga Cidades",
     '"Top 20 cidades — " & FORMAT([% Top 20 Cidades Fuga], "0.0%") & " da fuga"', None),
]

def _medida(n, e, f):
    m = {"name": n, "expression": e, "lineageTag": guid("med/"+n)}
    if f: m["formatString"] = f
    return m
medidas = [_medida(*x) for x in MEDIDAS]

ALL_PERMITIDO = {"Data Fim Completa"}
_com_all = [m["name"] for m in medidas
            if f"ALL('{T}')" in m["expression"] and m["name"] not in ALL_PERMITIDO]
assert not _com_all, f"medidas usando ALL() sem justificativa: {_com_all}"

model = {
    "name": "SupplyVisionPainel",
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
        "annotations": [
            {"name": "PBI_QueryOrder", "value": json.dumps([T])},
            {"name": "__PBI_TimeIntelligenceEnabled", "value": "0"},
        ],
    },
}

pathlib.Path("model.bim.json").write_text(json.dumps(model, indent=2, ensure_ascii=False), encoding="utf-8")
print("colunas:", len(colunas), "| medidas:", len(medidas))
