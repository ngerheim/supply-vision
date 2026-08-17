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

    # ── Janela de 30 dias: conformidade de preco ────────────────────
    ("Valor Dentro do Acordo 30d", janela(29, extra=[("STATUS_ACORDO", "COM_ACORDO")]), MOEDA_FMT),
    ("Valor Total 30d",        janela(29), MOEDA_FMT),
    ("Valor Sem Acordo 30d",   janela(29, extra=[("STATUS_ACORDO", "SEM_ACORDO")]), MOEDA_FMT),
    ("% Sem Acordo 30d",       "DIVIDE([Valor Sem Acordo 30d], [Valor Total 30d])", "0.0%"),
    # Nao existem "% Acima 30d", "% Conforme 30d" e "% Abaixo 30d". As medidas
    # usadas sao [% Acima], [% Conforme] e [% Abaixo], que dividem pela base com
    # acordo do CONTEXTO -- e como a aba de Conformidade tem filtro de janela
    # travado na pagina, o contexto ja e a janela de 30 dias. Duas medidas quase
    # iguais, uma com janela embutida e outra sem, foi exatamente o que produziu
    # a divergencia de R$ 387.898,08 contra R$ 13.940,24. Uma so.
    #
    # Excedente pago: a UNICA medida de excedente do painel. Cartao, ranking e
    # tabela usam ela, entao o total do Detalhe reconcilia com o cartao da
    # Conformidade por construcao.
    ("Excedente Acima 30d",    janela(29, expr=f"SUM('{T}'[Diferenca Total])",
                                      extra=[("Status", "ACIMA DO ACORDO")]), MOEDA_FMT),
    # Comparacao de preco no Detalhe: vazia fora da janela. A linha de 2025
    # continua na tabela com data, fornecedor, item, quantidade e preco pago --
    # falta so a diferenca contra um catalogo que nao existia naquela data.
    ("Preco Acordo Vigente",   janela(29, expr=f"SUM('{T}'[Preco Acordo])"), MOEDA_FMT),

    # ── Janela de 365 dias: fuga de contrato ────────────────────────
    ("Valor Total 365d",       janela(365, inicio=">"), MOEDA_FMT),
    ("Valor Sem Acordo 365d",  janela(365, inicio=">",
                                      extra=[("STATUS_ACORDO", "SEM_ACORDO")]), MOEDA_FMT),
    ("Valor em Fuga 365d",     janela(365, inicio=">",
                                      extra=[("STATUS_ACORDO", "SEM_ACORDO"),
                                             ("Tinha acordo?", "SIM")]), MOEDA_FMT),
    # O percentual do funil: dentro do que passou sem acordo, quanto tinha acordo
    # disponivel? 22,7%. O outro denominador possivel (gasto total, 16,2%)
    # responde outra pergunta e nao encadeia com a aba anterior.
    ("% da Fuga sobre o Sem Acordo 365d",
     "DIVIDE([Valor em Fuga 365d], [Valor Sem Acordo 365d])", "0.0%"),

    ("Fornecedores",           f"DISTINCTCOUNT('{T}'[Fornecedor])", "#,0"),
    ("Cidades",                f"DISTINCTCOUNT('{T}'[Cidade])", "#,0"),
    ("Itens",                  f"DISTINCTCOUNT('{T}'[Grupo Item])", "#,0"),
    ("Modelos",                f"DISTINCTCOUNT('{T}'[Grupo Modelo])", "#,0"),
    ("% do Sem Acordo",    "DIVIDE([Valor Sem Acordo], "
                               "CALCULATE([Valor Sem Acordo], ALLSELECTED()))", "0.0%"),
    ("Ultima Execucao",        f"MAX('{T}'[DATA_EXECUCAO])", "dd/mm/yyyy hh:nn"),

    # ── Frescor do dado ─────────────────────────────────────────────
    # O refresh do Servico termina "com sucesso" lendo um parquet que nao
    # avancou: se o pipeline falhou, o arquivo anterior continua no lugar e o
    # Power BI atualiza contra ele -- nada no painel muda de aparencia. E o mesmo
    # modo de falha do gateway pessoal: o painel nao quebra, envelhece.
    #
    # As duas datas sao diferentes de proposito. DATA_EXECUCAO diz quando o
    # pipeline rodou; [Data Fim Completa] diz ate onde o dado alcanca. Um
    # pipeline que roda todo dia sobre uma extracao travada mantem a primeira
    # andando e a segunda parada -- e e a segunda que importa para quem decide.
    # "carga" e termo do pipeline, nao de quem le o painel. As duas datas
    # continuam separadas porque medem coisas diferentes -- ver o comentario
    # acima -- mas a segunda passa a se chamar pelo que ela significa para o
    # leitor: quando isto foi atualizado.
    ("Atualizacao",
     '"Dados até " & FORMAT([Data Fim Completa], "dd/mm/yyyy") & '
     '"   |   Atualizado em " & FORMAT([Ultima Execucao], "dd/mm/yyyy") & '
     '" às " & FORMAT([Ultima Execucao], "HH:mm")', None),
    # Nao existe medida "Dias de Defasagem". Ela precisaria de ALL('Painel') para
    # ancorar a data de execucao globalmente, o que exigiria abrir ALL_PERMITIDO
    # -- e nenhum visual a usaria: [Atualizacao] ja imprime as duas datas, e a
    # diferenca entre elas e visivel sem uma terceira medida para calcula-la.
] + [
    # ── Cobertura do top 20: o numero que estava digitado no titulo ──
    # Nove titulos deste painel carregavam percentual na string. O percentual vem
    # da distribuicao da base; a string nao acompanha refresh nenhum. Depois da
    # primeira atualizacao que mexa na cauda, o titulo afirma uma cobertura que as
    # barras nao mostram -- e ninguem confere titulo contra grafico.
    #
    # ALL na COLUNA da dimensao, nao na tabela: o denominador precisa escapar do
    # proprio VisualTopN do grafico (senao seria top20/top20 = 100%), mas tem de
    # continuar obedecendo fornecedor, cidade e janela que o leitor filtrou.
    # ALL('Painel'[Coluna]) remove um filtro; ALL('Painel') removeria todos -- e
    # por isso esta forma nao precisa entrar em ALL_PERMITIDO.
    (f"% Top 20 {rot}",
     f"VAR Base = FILTER(ALL('{T}'[{dim}]), NOT ISBLANK('{T}'[{dim}])) "
     f"VAR Top20 = TOPN(20, Base, [{med}], DESC, '{T}'[{dim}], ASC) "
     f"VAR VTop = SUMX(Top20, CALCULATE([{med}])) "
     f"VAR VTot = SUMX(Base, CALCULATE([{med}])) "
     "RETURN DIVIDE(VTop, VTot)", "0.0%")
    for rot, dim, med in [
        # Visao Geral: cobertura pelo TOTAL da barra. conferir.py ja garante a
        # identidade total = dentro + sem acordo, entao [Valor Total] E a soma das
        # duas series -- nao ha por que criar medida auxiliar somando as duas.
        ("Cidades",              "Cidade",     "Valor Total"),
        ("Fornecedores",         "Fornecedor", "Valor Total"),
        ("Grupos de Item",       "Grupo Item", "Valor Total"),
        ("Fornecedores SA",      "Fornecedor", "Valor Sem Acordo"),
        ("Grupos de Item SA",    "Grupo Item", "Valor Sem Acordo"),
        # Fuga: a medida com janela embutida, nao a base. O filtro de pagina de
        # 365 dias saiu (ver paginas.py), entao a janela tem de vir da medida.
        ("Fornecedores Fuga",    "Fornecedor", "Valor em Fuga 365d"),
        ("Grupos de Item Fuga",  "Grupo Item", "Valor em Fuga 365d"),
        ("Cidades Fuga",         "Cidade",     "Valor em Fuga 365d"),
    ]
] + [
    # "ocorre em 38": contagem digitada, mesmo problema.
    ("Cidades com Fuga 365d",
     f"COUNTROWS(FILTER(FILTER(ALL('{T}'[Cidade]), NOT ISBLANK('{T}'[Cidade])), "
     "CALCULATE([Valor em Fuga 365d]) > 0))", "#,0"),

    # ── Titulos. O texto mora onde mora o numero ─────────────────────
    # Separar os dois foi a causa do problema: titulo no relatorio, numero na
    # base. Aqui um refresh que mude a distribuicao muda o titulo junto.
    # "todos os 8" reaproveita [Modelos], que ja e DISTINCTCOUNT(Grupo Modelo) --
    # criar uma segunda contagem quase igual e o padrao que produziu a divergencia
    # de R$ 387.898,08 contra R$ 13.940,24.
    # Padrao unico: "Top 20 <dimensao> — X% <referencia>". Antes havia duas
    # formas ("Fornecedores — top 20 = 36,7%" e "Top 20 fornecedores — 56,2% da
    # fuga"), o que faz o leitor reprocessar a estrutura da frase em cada visual.
    # A referencia ("do total", "do sem acordo", "da fuga") e obrigatoria: sem
    # ela o percentual nao tem denominador declarado.
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
    # "na janela" sai: a faixa acima ja declara 365 dias corridos e o cartao
    # imprime as datas. Repetir em tres titulos gasta caractere que o nome da
    # categoria precisa.
    ("Titulo Fuga Fornecedores",
     '"Top 20 fornecedores — " & FORMAT([% Top 20 Fornecedores Fuga], "0.0%") & " da fuga"', None),
    ("Titulo Fuga Grupos de Item",
     '"Top 20 grupos de item — " & FORMAT([% Top 20 Grupos de Item Fuga], "0.0%") & " da fuga"', None),
    # "(ocorre em 38)" sai do titulo. A contagem era informacao boa em lugar
    # ruim: dentro do titulo ela competia com o percentual e empurrava o texto
    # para duas linhas em 436px. [Cidades com Fuga 365d] continua no modelo,
    # pronta para um cartao, e nao esta em visual nenhum hoje.
    ("Titulo Fuga Cidades",
     '"Top 20 cidades — " & FORMAT([% Top 20 Cidades Fuga], "0.0%") & " da fuga"', None),
]

def _medida(n, e, f):
    m = {"name": n, "expression": e, "lineageTag": guid("med/"+n)}
    if f: m["formatString"] = f
    return m
medidas = [_medida(*x) for x in MEDIDAS]

# Trava contra a regressao mais cara deste modelo. ALL() remove TODO filtro,
# inclusive fornecedor, item e cidade: uma medida de janela com ALL() fica presa
# no total e o cartao nao reage quando o leitor filtra -- pior que numero errado,
# porque parece certo. A unica excecao legitima e a ancora da janela, que precisa
# ser global. Se uma medida nova precisar de ALL(), acrescente aqui com o motivo.
ALL_PERMITIDO = {"Data Fim Completa"}
_com_all = [m["name"] for m in medidas
            if f"ALL('{T}')" in m["expression"] and m["name"] not in ALL_PERMITIDO]
assert not _com_all, f"medidas usando ALL() sem justificativa: {_com_all}"

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
        "annotations": [
            {"name": "PBI_QueryOrder", "value": json.dumps([T])},
            # Desliga a data/hora automatica. Sem isto o Desktop cria uma tabela
            # oculta por coluna de data ao abrir o projeto -- em 17/08/2026 eram
            # tres (DateTableTemplate_... e dois LocalDateTable_...), e o
            # model.bim do projeto passou a ter 4 tabelas contra 1 do gerador.
            #
            # O efeito nao e so tamanho (29 KB -> 67 KB). E oscilacao: aplicar.py
            # copia a versao de 1 tabela, o Desktop devolve as 3 na abertura
            # seguinte, e cada commit alterna 38 KB. Diff que muda sozinho para
            # frente e para tras deixa de ser lido, e ai um diff que importa passa
            # junto.
            #
            # Aqui nao se perde nada: o painel nao usa hierarquia de data do
            # Power BI. Ano, Ano-Mes, Mes Nome, Mes Fechado e as tres colunas de
            # janela sao calculadas no M e vem prontas na tabela Painel.
            {"name": "__PBI_TimeIntelligenceEnabled", "value": "0"},
        ],
    },
}

pathlib.Path("model.bim.json").write_text(json.dumps(model, indent=2, ensure_ascii=False), encoding="utf-8")
print("colunas:", len(colunas), "| medidas:", len(medidas))
