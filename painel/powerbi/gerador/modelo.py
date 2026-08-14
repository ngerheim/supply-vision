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
    // Ancora no ultimo dia COMPLETO, nao no maior [Data] da base. Medido em
    // 13/08/2026: o dia da extracao tinha 59 linhas e R$ 7,7 mil contra ~200
    // linhas e R$ 30 a 54 mil dos dias anteriores -- a extracao roda no meio da
    // tarde. Com o dia parcial dentro, a janela de 30 dias fechava em R$ 824,1
    // mil em vez de R$ 850,8 mil: 3,2% a menos, e o mesmo desvio na base de
    // conformidade. Um unico registro do dia corrente desloca a janela inteira.
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

# Fim da janela em DAX, espelhando a coluna Fim do M: ultimo dia anterior ao dia
# da extracao. Todas as medidas de janela referenciam esta, em vez de cada uma
# recalcular MAX(Data) -- assim nao existe a possibilidade de a pagina e o
# cartao usarem recortes diferentes.
FIM = "VAR Fim = [Data Fim Completa] "

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

    # ── Fuga de contrato: comprou fora existindo acordo para a combinacao.
    # Mede o VOLUME que deveria ter passado por contrato. O excedente pago
    # (a antiga "Perda Evitavel") saiu do painel: comparava com o menor acordo
    # de qualquer fornecedor, que podia nao ter como atender aquela OS -- teto
    # teorico, nao valor recuperavel.
    ("Valor em Fuga",          f'CALCULATE([Valor Total], \'{T}\'[STATUS_ACORDO] = "SEM_ACORDO", \'{T}\'[Tinha acordo?] = "SIM")', MOEDA_FMT),
    # Fora do acordo que NAO era fuga: nao havia acordo disponivel. Existe para
    # as colunas empilhadas -- sem ela, empilhar "fora" com "fuga" contaria a
    # fuga duas vezes.
    ("Valor Sem Alternativa", "[Valor Sem Acordo] - [Valor em Fuga]", MOEDA_FMT),

    # ── Conformidade de preco. Respeitam o filtro da pagina: usadas na aba
    # restrita aos ultimos 30 dias.
    # Nao existe medida de excedente sem janela, de proposito. Duas medidas de
    # excedente com nomes parecidos -- uma com janela, outra sem -- foi
    # exatamente a causa da divergencia de 13/08/2026: R$ 387.898,08 no total de
    # uma tabela ao lado de R$ 13.940,24 num cartao. O excedente do painel e
    # Excedente Acima 30d, e so ele. Comparar preco fora da janela nao e uma
    # opcao que deva estar disponivel no modelo.
    ("% Acima",                f'DIVIDE(CALCULATE([Valor Total], \'{T}\'[Status] = "ACIMA DO ACORDO"), [Valor Dentro do Acordo])', "0.0%"),
    ("% Conforme",             f'DIVIDE(CALCULATE([Valor Total], \'{T}\'[Status] = "CONFORME"), [Valor Dentro do Acordo])', "0.0%"),
    ("% Abaixo",               f'DIVIDE(CALCULATE([Valor Total], \'{T}\'[Status] = "ABAIXO DO ACORDO"), [Valor Dentro do Acordo])', "0.0%"),

    # ── Janela de 30 dias embutida no DAX, ancorada em MAX(Data) e imune aos
    # filtros da pagina (ALL). Servem para exibir conformidade atual numa
    # pagina historica sem contaminar o resto dela.
    ("Janela 30d",             FIM +
                               'RETURN FORMAT(Fim - 29, "dd/mm/yyyy") & " a " & FORMAT(Fim, "dd/mm/yyyy")', None),
    ("Janela 365d",            FIM +
                               'RETURN FORMAT(Fim - 364, "dd/mm/yyyy") & " a " & FORMAT(Fim, "dd/mm/yyyy")', None),
    ("Valor Coberto 30d",      FIM +
                               f"RETURN CALCULATE([Valor Total], ALL('{T}'), '{T}'[Data] >= Fim - 29, "
                               f"'{T}'[Data] <= Fim, '{T}'[STATUS_ACORDO] = \"COM_ACORDO\")", MOEDA_FMT),
    ("% Acima 30d",            FIM +
                               f"VAR Acima = CALCULATE([Valor Total], ALL('{T}'), '{T}'[Data] >= Fim - 29, "
                               f"'{T}'[Data] <= Fim, '{T}'[Status] = \"ACIMA DO ACORDO\") "
                               "RETURN DIVIDE(Acima, [Valor Coberto 30d])", "0.0%"),
    ("% Conforme 30d",         FIM +
                               f"VAR Conf = CALCULATE([Valor Total], ALL('{T}'), '{T}'[Data] >= Fim - 29, "
                               f"'{T}'[Data] <= Fim, '{T}'[Status] = \"CONFORME\") "
                               "RETURN DIVIDE(Conf, [Valor Coberto 30d])", "0.0%"),
    ("% Abaixo 30d",           FIM +
                               f"VAR Ab = CALCULATE([Valor Total], ALL('{T}'), '{T}'[Data] >= Fim - 29, "
                               f"'{T}'[Data] <= Fim, '{T}'[Status] = \"ABAIXO DO ACORDO\") "
                               "RETURN DIVIDE(Ab, [Valor Coberto 30d])", "0.0%"),
    # Excedente pago na janela, respeitando o contexto do visual. KEEPFILTERS,
    # nao ALL(): com ALL() a medida ignora fornecedor, item e -- pior -- a
    # propria linha da tabela, e o mesmo numero apareceria em toda linha. Com
    # KEEPFILTERS o filtro de data INTERSECTA o contexto, entao numa linha de
    # 2025 a intersecao e vazia e a medida devolve vazio, enquanto no total da
    # tabela ela vale exatamente o mesmo que no cartao.
    #
    # Esta e a medida unica de excedente: cartao, ranking e tabela usam ela, e o
    # total do Detalhe reconcilia com o cartao da Conformidade por construcao.
    ("Excedente Acima 30d",    FIM +
                               f"RETURN CALCULATE(SUM('{T}'[Diferenca Total]), "
                               f"KEEPFILTERS('{T}'[Data] >= Fim - 29), "
                               f"KEEPFILTERS('{T}'[Data] <= Fim), "
                               f"KEEPFILTERS('{T}'[Status] = \"ACIMA DO ACORDO\"))", MOEDA_FMT),

    # ── Denominadores das janelas. Cada aba restrita a um recorte precisa
    # dizer sobre QUAL total o seu percentual foi calculado -- sem isso o
    # leitor compara "R$ 1,8 mi em fuga" com os R$ 17,1 mi do historico
    # inteiro e conclui 10%, quando na janela e 12,6%.
    ("Valor Total 30d",        FIM +
                               f"RETURN CALCULATE([Valor Total], ALL('{T}'), "
                               f"'{T}'[Data] >= Fim - 29, '{T}'[Data] <= Fim)", MOEDA_FMT),
    ("Valor Total 365d",       FIM +
                               f"RETURN CALCULATE([Valor Total], ALL('{T}'), "
                               f"'{T}'[Data] >= Fim - 364, '{T}'[Data] <= Fim)", MOEDA_FMT),
    ("Valor Sem Acordo 30d", FIM +
                               f"RETURN CALCULATE([Valor Total], ALL('{T}'), "
                               f"'{T}'[Data] >= Fim - 29, '{T}'[Data] <= Fim, "
                               f"'{T}'[STATUS_ACORDO] = \"SEM_ACORDO\")", MOEDA_FMT),
    ("% Sem Acordo 30d",   "DIVIDE([Valor Sem Acordo 30d], [Valor Total 30d])", "0.0%"),
    ("Valor em Fuga 365d",     FIM +
                               f"RETURN CALCULATE([Valor Total], ALL('{T}'), "
                               f"'{T}'[Data] >= Fim - 364, '{T}'[Data] <= Fim, "
                               f"'{T}'[STATUS_ACORDO] = \"SEM_ACORDO\", "
                               f"'{T}'[Tinha acordo?] = \"SIM\")", MOEDA_FMT),
    ("Valor Sem Acordo 365d", FIM +
                               f"RETURN CALCULATE([Valor Total], ALL('{T}'), "
                               f"'{T}'[Data] > Fim - 365, '{T}'[Data] <= Fim, "
                               f"'{T}'[STATUS_ACORDO] = \"SEM_ACORDO\")", MOEDA_FMT),
    # O percentual que responde a pergunta do funil: dentro do que passou fora,
    # quanto tinha acordo disponivel? Medido em 13/08/2026: 22,7%. O outro
    # denominador possivel (sobre o gasto total, 16,2%) responde outra pergunta
    # e nao encadeia com a aba anterior.
    ("% da Fuga sobre o Sem Acordo 365d", "DIVIDE([Valor em Fuga 365d], [Valor Sem Acordo 365d])", "0.0%"),
    # Base de conformidade explicita e imune ao filtro da pagina. O cartao de
    # "Valor Total 30d" ao lado de "% Acima" fazia o leitor calcular 21,4% sobre
    # os R$ 824,1 mil e chegar a R$ 176 mil, quando o valor e R$ 44 mil: os
    # percentuais de conformidade sao sobre a base COM acordo, R$ 205,5 mil.
    # ── Comparacao de preco no Detalhe, valida so dentro da janela ──
    # A tabela do Detalhe e historica de proposito (rastreabilidade), mas preco
    # acordado e diferenca comparados contra o catalogo de HOJE em uma OS de
    # 2025 sao a comparacao que o painel inteiro evita. Estas duas medidas
    # devolvem vazio fora da janela de 30 dias: a linha continua na tabela, com
    # data, fornecedor, item, quantidade e preco pago, mas sem um numero de
    # diferenca que ninguem pode defender. Ordenando por elas, o topo da tabela
    # e necessariamente comparavel.
    # IF(MAX(Data) >= Fim - 29, ...) parecia funcionar e nao funcionava: na linha
    # de TOTAL da tabela o MAX(Data) e a data maxima global, a condicao fica
    # verdadeira, e o SUM percorre o historico inteiro. Medido em 13/08/2026: o
    # total da coluna mostrava R$ 387.898,08 -- a soma liquida de dezenove meses
    # -- ao lado de um cartao de R$ 13,9 mil. Um gate por IF nao e um filtro; a
    # forma correta e CALCULATE com KEEPFILTERS, que intersecta o contexto em
    # qualquer grao.
    ("Preco Acordo Vigente",   FIM +
                               f"RETURN CALCULATE(SUM('{T}'[Preco Acordo]), "
                               f"KEEPFILTERS('{T}'[Data] >= Fim - 29), "
                               f"KEEPFILTERS('{T}'[Data] <= Fim))", MOEDA_FMT),

    ("Valor Dentro do Acordo 30d", FIM +
                               f"RETURN CALCULATE([Valor Total], ALL('{T}'), "
                               f"'{T}'[Data] >= Fim - 29, '{T}'[Data] <= Fim, "
                               f"'{T}'[STATUS_ACORDO] = \"COM_ACORDO\")", MOEDA_FMT),

    ("Fornecedores",           f"DISTINCTCOUNT('{T}'[Fornecedor])", "#,0"),
    ("Cidades",                f"DISTINCTCOUNT('{T}'[Cidade])", "#,0"),
    ("Itens",                  f"DISTINCTCOUNT('{T}'[Grupo Item])", "#,0"),
    ("Modelos",                f"DISTINCTCOUNT('{T}'[Grupo Modelo])", "#,0"),
    ("% do Sem Acordo",    "DIVIDE([Valor Sem Acordo], "
                               "CALCULATE([Valor Sem Acordo], ALLSELECTED()))", "0.0%"),
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
