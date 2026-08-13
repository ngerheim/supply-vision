import json, pathlib

# Ordem validada por scripts/validate_palette.js (skill dataviz):
# pior par adjacente CVD dE 14.7 (alvo >= 8) e visao normal dE 33.3 (piso 15),
# sobre superficie #FFFFFF. Os dois primeiros slots sao a leitura principal do
# painel -- ambar = fora do acordo, azul = dentro -- porque o Power BI atribui
# dataColors em ordem, e a maioria dos visuais aqui tem uma ou duas series.
SERIES = ["#E39502", "#1C5CAB", "#E34948", "#4A3AA7", "#E87BA4", "#0CA30C"]

AMBAR, NAVY, TINTA, TINTA2, MUDO = "#E39502", "#06203C", "#0B1B2E", "#4A5568", "#8A94A6"
GRADE, SUP = "#E4E7EC", "#FFFFFF"

def txt(tam, cor=TINTA, face="Segoe UI"):
    """Classe de texto do tema.

    Em textClasses a cor e hex puro, e nao {"solid": {"color": ...}} -- essa
    forma vale em visualStyles, e trocar as duas faz o Desktop recusar o tema
    inteiro. Confirmado no schema publicado (definitions/color e type string,
    e textClass tem additionalProperties: false).
    """
    return {"fontSize": tam, "fontFace": face, "color": cor}

tema = {
    "name": "Loc Frotas — Supply Vision",
    "dataColors": SERIES,
    "background": SUP,
    "foreground": TINTA,
    "tableAccent": AMBAR,
    "good": "#0CA30C", "neutral": MUDO, "bad": "#D03B3B",
    "maximum": "#5C3B00", "center": "#EDB04C", "minimum": "#FDF3E0",  # rampa ambar
    "textClasses": {
        "title":      txt(15, TINTA, "Segoe UI Semibold"),
        "header":     txt(12, TINTA, "Segoe UI Semibold"),
        "label":      txt(10, TINTA2),
        "callout":    txt(30, TINTA, "Segoe UI Semibold"),
        "largeTitle": txt(20, TINTA, "Segoe UI Semibold"),
    },
    "visualStyles": {
        "*": {"*": {
            # Cartao com anel fino e canto arredondado, no lugar da borda cinza
            # padrao: a hierarquia vem do agrupamento, nao de moldura grossa.
            "background": [{"show": True, "color": {"solid": {"color": SUP}}, "transparency": 0}],
            "border":     [{"show": True, "color": {"solid": {"color": "#E8EBEF"}}, "radius": 8}],
            # Sem sombra. Com 13 visuais na pagina eram 13 sombras competindo,
            # e o card branco sobre o plano cinza ja se separa sem ela.
            "dropShadow": [{"show": False}],
            # Titulo sem bloco de fundo: sobre fundo branco nao produzia efeito
            # nenhum e quebrava o alinhamento com o resto do cartao.
            "title": [{"show": True, "fontColor": {"solid": {"color": TINTA}},
                       "fontSize": 11, "fontFamily": "Segoe UI Semibold",
                       "alignment": "left"}],
            # Cabecalho do visual e ferramenta de autoria (foco, filtro, menu).
            "visualHeader": [{"show": False}],
            # Eixos e grade recuados: linha de grade fina, sem linha vertical.
            "categoryAxis": [{"show": True, "fontSize": 10,
                              "labelColor": {"solid": {"color": MUDO}},
                              "showAxisTitle": False,
                              "gridlineShow": False,
                              "lineColor": {"solid": {"color": "#C9CFD8"}}}],
            "valueAxis":    [{"show": True, "fontSize": 10,
                              "labelColor": {"solid": {"color": MUDO}},
                              "showAxisTitle": False,
                              "gridlineShow": True,
                              "gridlineColor": {"solid": {"color": GRADE}},
                              "gridlineThickness": 1, "gridlineStyle": "solid"}],
            "legend": [{"show": True, "position": "TopLeft", "showTitle": False,
                        "fontSize": 10, "labelColor": {"solid": {"color": TINTA2}}}],
            "labels": [{"show": False}],
        }},
        # ── Cartao KPI ────────────────────────────────────────────
        # labelDisplayUnits e o ajuste que mais muda a faixa de cards. Sem
        # ele, o formato da medida ("R$" #,0.00) manda "R$ 17.117.247,11" para
        # um tile de 249px: o Power BI encolhe a fonte para caber, e como cada
        # valor tem um comprimento diferente, cada card acaba com um corpo de
        # letra diferente. Com unidade automatica e uma casa, vira "R$ 17,1 mi"
        # em todos -- mesma largura, mesma fonte, faixa alinhada.
        #
        # 0 = automatico. A precisao de 1 casa evita "R$ 17 mi", que perde
        # granularidade justamente nos numeros que interessam.
        "card": {"*": {
            "labels":         [{"fontSize": 28,
                                "color": {"solid": {"color": TINTA}},
                                "fontFamily": "Segoe UI Semibold",
                                "labelDisplayUnits": 0, "labelPrecision": 1}],
            "categoryLabels": [{"show": True, "fontSize": 9,
                                "fontFamily": "Segoe UI",
                                "color": {"solid": {"color": MUDO}}}],
            "wordWrap": [{"show": False}],
            "title": [{"show": False}],
            # Uma camada de moldura, nao tres. O card branco sobre o plano
            # cinza da pagina ja se destaca sozinho: borda fina resolve o
            # contorno, e sombra em cima disso era a terceira camada.
            "background": [{"show": True, "color": {"solid": {"color": SUP}}, "transparency": 0}],
            "border":     [{"show": True, "color": {"solid": {"color": "#E8EBEF"}}, "radius": 8}],
            "dropShadow": [{"show": False}],
            # O cabecalho do visual e ferramenta de autoria (foco, filtro,
            # menu). Num card de um numero ele nao serve para nada e ocupa a
            # faixa superior do tile.
            "visualHeader": [{"show": False}],
        }},
        # Barras: rotulo de dado ligado (o ranking e para ler valor, nao estimar)
        "barChart": {"*": {
            "labels": [{"show": True, "fontSize": 9, "color": {"solid": {"color": TINTA2}},
                        "labelDisplayUnits": 0, "labelPrecision": 1}],
            "valueAxis": [{"show": False}],
            "categoryAxis": [{"show": True, "fontSize": 10, "showAxisTitle": False,
                              "labelColor": {"solid": {"color": TINTA2}}}],
        }},
        "clusteredColumnChart": {"*": {
            "labels": [{"show": False}],
        }},
        "lineChart": {"*": {
            "lineStyles": [{"strokeWidth": 2, "showMarker": True, "markerSize": 4,
                            "lineStyle": "solid"}],
            "labels": [{"show": False}],
        }},
        "donutChart": {"*": {
            "slices": [{"innerRadiusRatio": 62}],
            "labels": [{"show": True, "fontSize": 10, "labelStyle": "Category, percent of total"}],
            "legend": [{"show": False}],
        }},
        "treemap": {"*": {
            "labels": [{"show": True, "fontSize": 10}],
            "legend": [{"show": False}],
        }},
        "pivotTable": {"*": {
            "grid": [{"gridVertical": False, "gridHorizontal": True,
                      "gridHorizontalColor": {"solid": {"color": GRADE}},
                      "rowPadding": 4, "outlineColor": {"solid": {"color": GRADE}}}],
            "columnHeaders": [{"fontColor": {"solid": {"color": MUDO}}, "fontSize": 9,
                               "backColor": {"solid": {"color": SUP}}, "autoSizeColumnWidth": True}],
            "values": [{"fontSize": 10, "fontColorPrimary": {"solid": {"color": TINTA}},
                        "backColorPrimary": {"solid": {"color": SUP}},
                        "backColorSecondary": {"solid": {"color": "#F8F9FB"}}}],
            "subTotals": [{"rowSubtotals": True, "columnSubtotals": False}],
        }},
        "tableEx": {"*": {
            "grid": [{"gridVertical": False, "gridHorizontal": True,
                      "gridHorizontalColor": {"solid": {"color": GRADE}}, "rowPadding": 3}],
            "columnHeaders": [{"fontColor": {"solid": {"color": MUDO}}, "fontSize": 9,
                               "backColor": {"solid": {"color": SUP}}}],
            "values": [{"fontSize": 10, "backColorPrimary": {"solid": {"color": SUP}},
                        "backColorSecondary": {"solid": {"color": "#F8F9FB"}}}],
        }},
        # Dropdown, nao lista. Em lista o slicer precisa de ~120px de altura
        # para mostrar itens; em 44px so aparece o cabecalho, e a caixa parece
        # vazia. Dropdown funciona em 40px e cabe treze deles na aba Detalhe.
        # "mode" e propriedade do card "*" do slicer -- conferido no schema.
        "slicer": {"*": {
            "*":      [{"mode": "Dropdown", "textSize": 9,
                        "fontColor": {"solid": {"color": TINTA}}}],
            "header": [{"show": True, "fontColor": {"solid": {"color": MUDO}}, "fontSize": 9,
                        "background": {"solid": {"color": SUP}}}],
            "items":  [{"fontColor": {"solid": {"color": TINTA}}, "fontSize": 9,
                        "background": {"solid": {"color": SUP}}}],
        }},
        # A pagina inteira sobre o plano claro; o cabecalho navy vem do textbox.
        "page": {"*": {
            "background": [{"color": {"solid": {"color": "#F1F3F6"}}, "transparency": 0}],
            "outspace":   [{"color": {"solid": {"color": "#F1F3F6"}}, "transparency": 0}],
        }},
    },
}
pathlib.Path("LocFrotas_SupplyVision.json").write_text(
    json.dumps(tema, indent=2, ensure_ascii=False), encoding="utf-8")
print("tema gravado | dataColors:", len(SERIES), "| visualStyles:", len(tema["visualStyles"]))
