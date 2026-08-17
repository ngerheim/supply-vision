import json, pathlib

SERIES = ["#E39502", "#1C5CAB", "#E34948", "#4A3AA7", "#E87BA4", "#0CA30C"]

AMBAR, NAVY, TINTA, TINTA2, MUDO = "#E39502", "#06203C", "#0B1B2E", "#4A5568", "#667085"
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
    "maximum": "#5C3B00", "center": "#EDB04C", "minimum": "#FDF3E0",
    "textClasses": {
        "title":      txt(15, TINTA, "Segoe UI Semibold"),
        "header":     txt(12, TINTA, "Segoe UI Semibold"),
        "label":      txt(10, TINTA2),
        "callout":    txt(30, TINTA, "Segoe UI Semibold"),
        "largeTitle": txt(20, TINTA, "Segoe UI Semibold"),
    },
    "visualStyles": {
        "*": {"*": {
            "background": [{"show": True, "color": {"solid": {"color": SUP}}, "transparency": 0}],
            "border":     [{"show": True, "color": {"solid": {"color": "#E8EBEF"}}, "radius": 8}],
            "dropShadow": [{"show": False}],
            "title": [{"show": True, "fontColor": {"solid": {"color": TINTA}},
                       "fontSize": 11, "fontFamily": "Segoe UI Semibold",
                       "alignment": "left"}],
            "visualHeader": [{"show": False}],
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
            "background": [{"show": True, "color": {"solid": {"color": SUP}}, "transparency": 0}],
            "border":     [{"show": True, "color": {"solid": {"color": "#E8EBEF"}}, "radius": 8}],
            "dropShadow": [{"show": False}],
            "visualHeader": [{"show": False}],
        }},
        "barChart": {"*": {
            "labels": [{"show": False}],
            "valueAxis": [{"show": True, "fontSize": 9, "showAxisTitle": False,
                           "labelColor": {"solid": {"color": MUDO}},
                           "gridlineShow": True,
                           "gridlineColor": {"solid": {"color": "#EEF1F4"}}}],
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
        "slicer": {"*": {
            "*":      [{"mode": "Dropdown", "textSize": 9,
                        "fontColor": {"solid": {"color": TINTA}}}],
            "header": [{"show": True, "fontColor": {"solid": {"color": MUDO}}, "fontSize": 9,
                        "background": {"solid": {"color": SUP}}}],
            "items":  [{"fontColor": {"solid": {"color": TINTA}}, "fontSize": 9,
                        "background": {"solid": {"color": SUP}}}],
        }},
        "page": {"*": {
            "background": [{"color": {"solid": {"color": "#F1F3F6"}}, "transparency": 0}],
            "outspace":   [{"color": {"solid": {"color": "#F1F3F6"}}, "transparency": 0}],
        }},
    },
}
pathlib.Path("LocFrotas_SupplyVision.json").write_text(
    json.dumps(tema, indent=2, ensure_ascii=False), encoding="utf-8")
print("tema gravado | dataColors:", len(SERIES), "| visualStyles:", len(tema["visualStyles"]))
