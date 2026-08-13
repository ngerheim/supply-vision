"""Emissor PBIR (formato novo do relatorio, um arquivo por visual).

O Desktop converte report.json legado para PBIR ao salvar, entao escrever
legado significa ter o trabalho descartado na primeira vez que alguem abre e
salva. PBIR tambem tem schema publico e versionado, o que permite validar
antes de entregar em vez de descobrir requisito por requisito.

As versoes de schema abaixo sao as que o proprio Desktop 2.156 (julho/2026)
gravou neste projeto -- copiadas de la, nao escolhidas por mim.
"""
import json, uuid, pathlib

T = "Painel"
S_VC   = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json"
S_PAGE = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json"
S_REP  = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.3.0/schema.json"
S_PGS  = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json"
S_VER  = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json"

def guid(seed): return str(uuid.uuid5(uuid.NAMESPACE_URL, "sv-painel/" + seed))

# ── campos ──────────────────────────────────────────────────────────
def _campo_col(nome):
    return {"Column": {"Expression": {"SourceRef": {"Entity": T}}, "Property": nome}}
def _campo_med(nome):
    return {"Measure": {"Expression": {"SourceRef": {"Entity": T}}, "Property": nome}}

def sel_col(nome): return {"_tipo": "col", "nome": nome, "Name": f"{T}.{nome}"}
def sel_med(nome): return {"_tipo": "med", "nome": nome, "Name": f"{T}.{nome}"}
def ref(nome, como=None):
    """Referencia a um campo na projecao de um visual.

    como= renomeia o campo dentro deste visual (displayName do RoleProjection).
    Serve para a legenda: "Valor Fora Sem Alternativa" precisa desse nome no
    cartao, mas na legenda de um empilhado tres rotulos desses consomem a
    largura do grafico. O nome da medida no modelo nao muda.
    """
    r = {"queryRef": f"{T}.{nome}"}
    if como: r["displayName"] = como
    return r

def _projecao(sel, ativo=False, como=None):
    campo = _campo_col(sel["nome"]) if sel["_tipo"] == "col" else _campo_med(sel["nome"])
    p = {"field": campo, "queryRef": sel["Name"], "nativeQueryRef": sel["nome"]}
    if como: p["displayName"] = como
    if ativo: p["active"] = True
    return p

def ordenar(nome, medida=True, desc=True):
    campo = _campo_med(nome) if medida else _campo_col(nome)
    return [{"field": campo, "direction": "Descending" if desc else "Ascending"}]

def sem_titulo():
    """Desliga o titulo do container.

    Em card e slicer o titulo repete o que o proprio visual ja escreve: o card
    imprime o nome da medida embaixo do numero, e o slicer tem cabecalho com o
    nome do campo. Dois rotulos iguais no mesmo quadrado.
    """
    return {"title": [{"properties": {"show": {"expr": {"Literal": {"Value": "false"}}}}}]}


def titulo(txt):
    return {"title": [{"properties": {
        "show": {"expr": {"Literal": {"Value": "true"}}},
        "text": {"expr": {"Literal": {"Value": "'" + txt.replace("'", "''") + "'"}}}}}]}

# ── visual ──────────────────────────────────────────────────────────
def visual(tipo, x, y, w, h, projections, selects, tit=None, order=None,
           objects=None, filtros=None):
    porNome = {s["Name"]: s for s in selects}
    qs = {}
    for papel, itens in projections.items():
        qs[papel] = {"projections": [
            _projecao(porNome[i["queryRef"]], ativo=(papel == "Category"),
                      como=i.get("displayName"))
            for i in itens]}
    v = {"visualType": tipo, "query": {"queryState": qs}, "drillFilterOtherVisuals": True}
    if order: v["query"]["sortDefinition"] = {"sort": order}
    if objects: v["objects"] = objects
    if tit: v["visualContainerObjects"] = titulo(tit)
    vc = {"$schema": S_VC, "name": guid(f"vis/{tipo}/{x}/{y}/{tit}"),
          "position": {"x": x, "y": y, "z": 0, "height": h, "width": w}, "visual": v}
    if filtros: vc["filterConfig"] = filtros
    return vc

def texto(x, y, w, h, conteudo, tamanho=20, negrito=True):
    runs = [{"value": conteudo, "textStyle": {"fontSize": f"{tamanho}pt",
             "fontWeight": "bold" if negrito else "normal", "color": "#06203C"}}]
    return {"$schema": S_VC, "name": guid(f"txt/{x}/{y}/{conteudo}"),
            "position": {"x": x, "y": y, "z": 0, "height": h, "width": w},
            "visual": {"visualType": "textbox", "drillFilterOtherVisuals": True,
                       "objects": {"general": [{"properties": {"paragraphs":
                           [{"textRuns": runs}]}}]}}}

# ── atalhos por tipo (mesma assinatura da versao legada) ────────────
def card(x, y, w, h, medida, fonte=None, destaque=False):
    """Cartao de um numero. Sem titulo -- o rotulo da categoria ja nomeia.

    destaque=True pinta o fundo com o ambar mais claro da rampa da marca. Um
    por pagina: e o numero que aquela aba existe para responder. Mais de um e a
    hierarquia se dissolve -- se tudo destaca, nada destaca.
    """
    obj = {}
    if fonte:
        obj["labels"] = [{"properties": {"fontSize": {"expr": {"Literal": {"Value": f"{fonte}D"}}}}}]
    if destaque:
        obj["background"] = [{"properties": {
            "show": {"expr": {"Literal": {"Value": "true"}}},
            "color": {"solid": {"color": {"expr": {"Literal": {"Value": "'#FDF3E0'"}}}}},
            "transparency": {"expr": {"Literal": {"Value": "0D"}}}}}]
    obj = obj or None
    v = visual("card", x, y, w, h, {"Values": [ref(medida)]}, [sel_med(medida)], None, objects=obj)
    v["visual"]["visualContainerObjects"] = sem_titulo()
    return v

def barras(x, y, w, h, dim, medida, tit, filtros=None, objetos=None):
    return visual("barChart", x, y, w, h, {"Category": [ref(dim)], "Y": [ref(medida)]},
                  [sel_col(dim), sel_med(medida)], tit, order=ordenar(medida),
                  objects=objetos, filtros=filtros)

def colunas_(x, y, w, h, dim, medida, tit, cat_asc=False, objetos=None, filtros=None):
    return visual("clusteredColumnChart", x, y, w, h,
                  {"Category": [ref(dim)], "Y": [ref(medida)]},
                  [sel_col(dim), sel_med(medida)], tit,
                  order=ordenar(dim, medida=False, desc=False) if cat_asc else ordenar(medida),
                  objects=objetos, filtros=filtros)

def linha_(x, y, w, h, cat, medida, tit, serie=None, objetos=None):
    proj = {"Category": [ref(cat)], "Y": [ref(medida)]}
    sels = [sel_col(cat), sel_med(medida)]
    if serie:
        proj["Series"] = [ref(serie)]; sels.append(sel_col(serie))
    return visual("lineChart", x, y, w, h, proj, sels, tit,
                  order=ordenar(cat, medida=False, desc=False), objects=objetos)

def rosca(x, y, w, h, dim, medida, tit):
    return visual("donutChart", x, y, w, h, {"Category": [ref(dim)], "Y": [ref(medida)]},
                  [sel_col(dim), sel_med(medida)], tit)

def arvore(x, y, w, h, dim, medida, tit):
    return visual("treemap", x, y, w, h, {"Group": [ref(dim)], "Values": [ref(medida)]},
                  [sel_col(dim), sel_med(medida)], tit, order=ordenar(medida))

def matriz(x, y, w, h, linhas, colunas, medidas, tit, filtros=None):
    proj = {"Rows": [ref(c) for c in linhas], "Columns": [ref(c) for c in colunas],
            "Values": [ref(m) for m in medidas]}
    sels = [sel_col(c) for c in linhas + colunas] + [sel_med(m) for m in medidas]
    return visual("pivotTable", x, y, w, h, proj, sels, tit, filtros=filtros)

def tabela(x, y, w, h, campos, medidas, tit, filtros=None):
    proj = {"Values": [ref(c) for c in campos] + [ref(m) for m in medidas]}
    sels = [sel_col(c) for c in campos] + [sel_med(m) for m in medidas]
    return visual("tableEx", x, y, w, h, proj, sels, tit, filtros=filtros)

def filtro(x, y, w, h, dim):
    """Segmentador. Sem titulo -- o cabecalho do proprio slicer nomeia o campo."""
    v = visual("slicer", x, y, w, h, {"Values": [ref(dim)]}, [sel_col(dim)], None)
    v["visual"]["visualContainerObjects"] = sem_titulo()
    return v

def dispersao(x, y, w, h, dim, eixo_x, eixo_y, tam, tit):
    return visual("scatterChart", x, y, w, h,
                  {"Category": [ref(dim)], "X": [ref(eixo_x)], "Y": [ref(eixo_y)], "Size": [ref(tam)]},
                  [sel_col(dim), sel_med(eixo_x), sel_med(eixo_y), sel_med(tam)], tit)

def cascata(x, y, w, h, cat, medida, tit):
    return visual("waterfallChart", x, y, w, h, {"Category": [ref(cat)], "Y": [ref(medida)]},
                  [sel_col(cat), sel_med(medida)], tit)

def fita(x, y, w, h, cat, medida, serie, tit):   # mantido por compatibilidade
    return visual("ribbonChart", x, y, w, h,
                  {"Category": [ref(cat)], "Y": [ref(medida)], "Series": [ref(serie)]},
                  [sel_col(cat), sel_col(serie), sel_med(medida)], tit,
                  order=ordenar(cat, medida=False, desc=False))



# ── filtros ─────────────────────────────────────────────────────────
def _campo_col_alias(nome, alias="p"):
    """Dentro de uma FilterDefinition existe clausula From, entao a referencia
    e pelo alias da tabela; fora dela, e pela entidade. Sao as duas formas de
    SourceRef que o schema define, e trocar uma pela outra invalida o arquivo."""
    return {"Column": {"Expression": {"SourceRef": {"Source": alias}}, "Property": nome}}

def top_n(dim, quantos=20):
    """Top N do visual: usa a ordenacao do proprio visual (sortDefinition).

    Nao cria fatia "Outros" -- o Power BI esconde o resto. Quem le precisa
    saber disso, entao a cobertura vai no titulo do visual.
    """
    return {"filters": [{
        "name": guid(f"top/{dim}/{quantos}"),
        "type": "VisualTopN",
        "field": _campo_col(dim),
        "filter": {"Version": 2,
                   "From": [{"Name": "p", "Entity": T, "Type": 0}],
                   "Where": [{"Target": [_campo_col_alias(dim)],
                              "Condition": {"VisualTopN": {"ItemCount": quantos}}}]},
        "howCreated": "User",
    }]}

def filtro_janela(coluna="Ultimos 30 dias"):
    """Filtro de pagina pela coluna logica calculada no M.

    A janela e ancorada na data mais recente da base, nao em Now(): assim a
    pagina e as medidas de 30 dias usam exatamente o mesmo recorte, e um
    refresh atrasado nao esvazia a pagina.
    """
    return {"filters": [{
        "name": guid("janela/" + coluna),
        "type": "Categorical",
        "field": _campo_col(coluna),
        "filter": {"Version": 2,
                   "From": [{"Name": "p", "Entity": T, "Type": 0}],
                   "Where": [{"Condition": {"In": {
                       "Expressions": [_campo_col_alias(coluna)],
                       "Values": [[{"Literal": {"Value": "true"}}]]}}}]},
        "howCreated": "User",
    }]}

# ── formatacao por serie ────────────────────────────────────────────
def cores_series(mapa):
    """Fixa a cor de cada serie pelo nome da medida.

    Sem isso o tema aplica dataColors na ordem das series, e a mesma cor
    passaria a significar coisas diferentes de um visual para outro.
    """
    return {"dataPoint": [
        {"properties": {"fill": {"solid": {"color": {"expr": {"Literal": {"Value": f"'{cor}'"}}}}}},
         "selector": {"metadata": f"{T}.{medida}"}}
        for medida, cor in mapa.items()]}

def rotulos(ligado=True, casas=0, unidades=0):
    return {"labels": [{"properties": {
        "show": {"expr": {"Literal": {"Value": "true" if ligado else "false"}}},
        "labelPrecision": {"expr": {"Literal": {"Value": f"{casas}D"}}},
        "labelDisplayUnits": {"expr": {"Literal": {"Value": f"{unidades}D"}}}}}]}

# ── colunas empilhadas ──────────────────────────────────────────────
def empilhado(x, y, w, h, cat, medidas, tit, cores=None, cem_por_cento=False,
              filtros=None, objetos=None, apelidos=None):
    """Colunas empilhadas: um eixo, varias medidas somando a altura da coluna.

    columnChart = empilhado; clusteredColumnChart = agrupado. Nomes herdados,
    faceis de trocar por engano.
    """
    tipo = "hundredPercentStackedColumnChart" if cem_por_cento else "columnChart"
    obj = dict(objetos or {})
    if cores: obj.update(cores_series(cores))
    ap = apelidos or {}
    v = visual(tipo, x, y, w, h,
               {"Category": [ref(cat)], "Y": [ref(m, ap.get(m)) for m in medidas]},
               [sel_col(cat)] + [sel_med(m) for m in medidas], tit,
               order=ordenar(cat, medida=False, desc=False), objects=obj or None)
    if filtros: v["filterConfig"] = filtros
    return v

def barras_empilhadas(x, y, w, h, dim, medidas, tit, cores=None, filtros=None,
                      apelidos=None):
    obj = cores_series(cores) if cores else None
    ap = apelidos or {}
    v = visual("barChart", x, y, w, h,
               {"Category": [ref(dim)], "Y": [ref(m, ap.get(m)) for m in medidas]},
               [sel_col(dim)] + [sel_med(m) for m in medidas], tit,
               order=ordenar(medidas[0]), objects=obj)
    if filtros: v["filterConfig"] = filtros
    return v

# ── escrita da arvore de pastas ─────────────────────────────────────
def escrever(destino, paginas):
    """Grava definition/ no formato PBIR. Devolve (n_paginas, n_visuais)."""
    d = pathlib.Path(destino); d.mkdir(parents=True, exist_ok=True)
    esc = lambda p, o: p.write_text(json.dumps(o, indent=2, ensure_ascii=False), encoding="utf-8")
    esc(d / "version.json", {"$schema": S_VER, "version": "2.0.0"})
    esc(d / "report.json", {"$schema": S_REP, "themeCollection": {},
        "settings": {"useStylableVisualContainerHeader": True,
                     "defaultDrillFilterOtherVisuals": True}})
    pd = d / "pages"; pd.mkdir(exist_ok=True)
    esc(pd / "pages.json", {"$schema": S_PGS,
        "pageOrder": [p["name"] for p in paginas], "activePageName": paginas[0]["name"]})
    n = 0
    for pg in paginas:
        alvo = pd / pg["name"]; (alvo / "visuals").mkdir(parents=True, exist_ok=True)
        pagina_json = {"$schema": S_PAGE, "name": pg["name"],
                       "displayName": pg["displayName"], "displayOption": "FitToPage",
                       "height": 720, "width": 1280}
        if pg.get("filterConfig"): pagina_json["filterConfig"] = pg["filterConfig"]
        esc(alvo / "page.json", pagina_json)
        for i, v in enumerate(pg["visualContainers"]):
            v["position"]["z"] = i * 1000
            vd = alvo / "visuals" / v["name"]; vd.mkdir(parents=True, exist_ok=True)
            esc(vd / "visual.json", v); n += 1
    return len(paginas), n
