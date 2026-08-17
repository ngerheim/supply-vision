"""Valida a arvore PBIR gerada. Tres checagens independentes:

1. schema oficial da Microsoft (clone local, ver BASE abaixo);
2. geometria -- sobreposicao e visual fora dos limites da pagina;
3. referencias orfas -- projecao apontando para medida ou coluna inexistente.

As duas ultimas existem porque o schema nao as cobre e o Power BI nao acusa:
visual fora da pagina aparece cortado, e projecao orfa aparece vazia, o que se
confunde com "nao ha dado no recorte".


O resolver do jsonschema tentaria buscar cada $ref na internet; aqui o store e
pre-carregado com todos os schemas do clone, indexados pela URI canonica, e
tambem pelo caminho relativo resolvido -- os $ref internos da Microsoft usam
caminhos como "../../semanticQuery/1.4.0/schema.json".
"""
import collections, json, glob, os, pathlib, sys


def _falta(o_que, como):
    """Uma mensagem so, cobrindo dependencia E clone.

    O import de jsonschema estourava antes de qualquer checagem, entao quem
    rodasse numa maquina sem as dependencias recebia ModuleNotFoundError e nao a
    instrucao -- e este script e declarado no LEIA.md como requisito de
    publicacao. Codigo de saida 2 distingue "nao consegui validar" de "validei e
    encontrei erro" (1), que e a diferenca que um gancho de pre-publicacao
    precisa enxergar.
    """
    print(f"nao foi possivel validar: {o_que}\n\nResolver com:\n{como}")
    sys.exit(2)


try:
    import jsonschema
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT7
except ModuleNotFoundError as e:
    _falta(f"modulo '{e.name}' ausente",
           "  pip install jsonschema referencing")

W, H = 1280, 720

CANDIDATOS = [
    os.environ.get("SV_FABRIC_SCHEMAS"),
    r"C:\Projetos\json-schemas\fabric",
    os.path.expanduser("~/json-schemas/fabric"),
    "/tmp/js/fabric",
]
URI  = "https://developer.microsoft.com/json-schemas/fabric/"


def _base():
    for c in CANDIDATOS:
        if c and os.path.isdir(c):
            return c.rstrip("/\\") + os.sep
    onde = "\n".join("  - " + c for c in CANDIDATOS if c)
    _falta("clone de microsoft/json-schemas nao encontrado.\nProcurei em:\n" + onde,
           "  git clone --depth 1 https://github.com/microsoft/json-schemas.git"
           r" C:\Projetos\json-schemas"
           "\n\nOu apontar SV_FABRIC_SCHEMAS para a pasta 'fabric' do clone.")


BASE = _base()

store = {}
recursos = {}
for f in glob.glob(BASE + "**/*.json", recursive=True):
    o = json.load(open(f, encoding="utf-8"))
    uri = URI + os.path.relpath(f, BASE).replace(os.sep, "/")
    store[uri] = o
    recursos[uri] = Resource(contents=o, specification=DRAFT7)
REGISTRY = Registry().with_resources(recursos.items())

def valida(destino):
    erros = n = 0
    for f in sorted(glob.glob(destino + "/**/*.json", recursive=True)):
        o = json.load(open(f, encoding="utf-8"))
        uri = o.get("$schema")
        if not uri:
            continue
        if uri not in store:
            print("schema fora do clone:", uri); erros += 1; continue
        v = jsonschema.Draft7Validator(store[uri], registry=REGISTRY)
        for e in v.iter_errors(o):
            erros += 1
            print(os.path.relpath(f, destino), "|", "/".join(map(str, e.absolute_path)),
                  "->", e.message[:160])
        n += 1
    print(f"arquivos validados: {n} | erros: {erros}")
    return erros

def geometria(destino):
    """Sobreposicao entre visuais e visual fora dos limites da pagina.

    O schema nao olha coordenada: uma faixa de cinco cartoes de 254px soma 1302
    numa pagina de 1280 e valida sem erro nenhum -- a quinta caixa simplesmente
    fica cortada. Isso passou por duas rodadas de revisao visual em 13/08/2026
    sem ser nomeado, porque num print o corte parece margem.

    O agrupamento por pagina usava f.split(os.sep + "pages" + os.sep). No Windows
    isso NAO casava: o glob preserva a "/" literal do padrao e devolve caminho
    misto, entao procurar "\\pages\\" falhava, o split devolvia o caminho inteiro
    e as cinco paginas caiam num balde unico. Resultado em nb-loc-0036: "paginas
    conferidas: 1 | problemas geometricos: 308" -- todo visual comparado contra
    todos os das outras paginas. A checagem nao era fraca, era invertida: 308
    falsos positivos escondem o positivo verdadeiro. Em Linux passava porque
    os.sep e "/".

    parts[-4] em vez de split por separador: a estrutura e sempre
    .../pages/<pagina>/visuals/<guid>/visual.json, e PurePath normaliza os dois
    separadores.
    """
    paginas = collections.defaultdict(list)
    for f in glob.glob(destino + "/pages/*/visuals/*/visual.json"):
        o = json.load(open(f, encoding="utf-8"))
        p = o["position"]
        paginas[pathlib.PurePath(f).parts[-4]].append(
            (p["x"], p["y"], p["width"], p["height"], o["visual"]["visualType"]))

    def colide(a, b):
        return (a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and
                a[1] < b[1] + b[3] and b[1] < a[1] + a[3])

    erros = 0
    for pg, vs in sorted(paginas.items()):
        for i in range(len(vs)):
            for j in range(i + 1, len(vs)):
                if colide(vs[i], vs[j]):
                    print(f"sobreposicao em {pg[:8]}: {vs[i]} x {vs[j]}"); erros += 1
        for v in vs:
            if v[0] + v[2] > W or v[1] + v[3] > H:
                print(f"fora da pagina {pg[:8]}: {v}"); erros += 1
    print(f"paginas conferidas: {len(paginas)} | problemas geometricos: {erros}")
    return erros


def orfas(destino, bim="model.bim.json"):
    """Projecao que aponta para medida ou coluna que nao existe no modelo.

    O Power BI nao acusa: o visual abre vazio, e vazio se confunde com "nao ha
    dado no recorte". Aconteceu depois de cada rodada de renomeacao de medida.
    """
    if not os.path.exists(bim):
        print("model.bim.json ausente, referencias nao conferidas"); return 0
    tb = json.load(open(bim, encoding="utf-8"))["model"]["tables"][0]
    nomes = {x["name"] for x in tb["measures"]} | {c["name"] for c in tb["columns"]}
    ruins = set()
    for f in glob.glob(destino + "/pages/*/visuals/*/visual.json"):
        o = json.load(open(f, encoding="utf-8"))
        for papel in o["visual"].get("query", {}).get("queryState", {}).values():
            for pr in papel["projections"]:
                if pr["nativeQueryRef"] not in nomes:
                    ruins.add(pr["nativeQueryRef"])
        for t in o["visual"].get("visualContainerObjects", {}).get("title", []):
            e = t.get("properties", {}).get("text", {}).get("expr", {})
            m = e.get("Measure", {}).get("Property")
            if m and m not in nomes:
                ruins.add(m + " (titulo)")
        for fl in o.get("filterConfig", {}).get("filters", []):
            m = fl.get("field", {}).get("Measure", {}).get("Property")
            if m and m not in nomes:
                ruins.add(m + " (filtro)")
    print("referencias orfas:", ", ".join(sorted(ruins)) or "nenhuma")
    return len(ruins)


def bookmarks(destino):
    """Botao apontando para bookmark que nao existe.

    O bookmark e criado no Power BI Desktop -- ver botao_bookmark() em
    relatorio.py -- e o Desktop gera o identificador. Se alguem recriar o
    indicador, o nome muda e o botao passa a apontar para nada. O Power BI nao
    acusa: o botao renderiza normal e o clique nao faz efeito, o que se confunde
    com "os filtros ja estavam limpos". Um botao de limpar que nao limpa e pior
    que botao ausente, porque o leitor confia nele e segue com filtro residual.

    Confere tambem o inverso, como aviso: bookmark sem botao que o dispare e
    trabalho que ninguem alcanca pela interface.
    """
    bmdir = os.path.join(destino, "bookmarks")
    existentes = set()
    for f in glob.glob(os.path.join(bmdir, "*.bookmark.json")):
        o = json.load(open(f, encoding="utf-8"))
        if o.get("name"):
            existentes.add(o["name"])

    usados = {}
    for f in glob.glob(destino + "/pages/*/visuals/*/visual.json"):
        o = json.load(open(f, encoding="utf-8"))
        for vl in o["visual"].get("visualContainerObjects", {}).get("visualLink", []):
            v = vl.get("properties", {}).get("bookmark", {}) \
                  .get("expr", {}).get("Literal", {}).get("Value", "")
            if v:
                usados[v.strip("'")] = pathlib.PurePath(f).parts[-4]

    erros = 0
    for nome, pg in sorted(usados.items()):
        if nome not in existentes:
            print(f"botao aponta para bookmark inexistente: {nome} (pagina {pg[:8]})")
            erros += 1
    orfaos = existentes - set(usados)
    print(f"bookmarks: {len(existentes)} definidos | {len(usados)} referenciados por botao"
          + (f" | sem botao: {', '.join(sorted(orfaos))}" if orfaos else ""))
    return erros


def tabelas_com_janela(destino, bim="model.bim.json"):
    """Tabela em que TODA medida tem janela: as linhas de fora desaparecem.

    Uma tabela do Power BI e executada como SUMMARIZECOLUMNS, e SUMMARIZECOLUMNS
    nao devolve linha em que TODAS as medidas sao BLANK. Se cada medida da tabela
    restringe data, as linhas fora do recorte somem -- sem erro, sem celula vazia,
    sem nada que se leia como defeito. A tabela apenas parece ter menos dado.

    Foi o que aconteceu no Detalhe: duas medidas, as duas de 30 dias, e a grande
    maioria das linhas invisivel. O comentario do gerador afirmava explicitamente
    que a linha de 2025 continuava na tabela. Nao continuava. Quem descobriu foi um
    leitor selecionando um fornecedor no segmentador e recebendo tabela vazia --
    tres em cada quatro fornecedores faziam isso. Numeros em docs/wiki.

    Deteccao exata, nao heuristica: toda medida de janela deste modelo passa pelo
    helper janela(), que emite "VAR Fim = [Data Fim Completa]". Medida cuja
    expressao referencia [Data Fim Completa] restringe data; medida que nao
    referencia, nao. Se uma tabela tem medidas e todas restringem, e erro.

    Duas isencoes, porque o que se procura e restricao ACIDENTAL:

    - pagina com filtro de janela declarado. A Conformidade tem "Ultimos 30 dias"
      travado no modo de leitura: a pagina inteira e a janela, entao a tabela
      restringir junto e o desenho, nao o defeito.
    - tabela com filtro proprio sobre medida. "[Excedente Acima 30d] > 0" diz que
      o autor quer so um subconjunto; nao faz sentido avisar que ha linha de fora.
    """
    if not os.path.exists(bim):
        return 0
    tb = json.load(open(bim, encoding="utf-8"))["model"]["tables"][0]
    com_janela = {m["name"] for m in tb["measures"]
                  if "[Data Fim Completa]" in m.get("expression", "")}
    COLUNAS_JANELA = {"Ultimos 30 dias", "Ultimos 365 dias", "Mes Fechado",
                      "Ultimos 12 meses fechados"}

    def pagina_declara_janela(caminho_visual):
        pj = pathlib.Path(caminho_visual).parents[2] / "page.json"
        if not pj.exists():
            return False
        o = json.load(open(pj, encoding="utf-8"))
        for fl in (o.get("filterConfig") or {}).get("filters", []):
            col = (fl.get("field") or {}).get("Column") or {}
            if col.get("Property") in COLUNAS_JANELA:
                return True
        return False

    erros = 0
    for f in glob.glob(destino + "/pages/*/visuals/*/visual.json"):
        o = json.load(open(f, encoding="utf-8"))
        v = o["visual"]
        if v.get("visualType") not in ("tableEx", "pivotTable"):
            continue
        if pagina_declara_janela(f):
            continue
        if any((fl.get("field") or {}).get("Measure")
               for fl in (o.get("filterConfig") or {}).get("filters", [])):
            continue
        medidas = []
        for papel in v.get("query", {}).get("queryState", {}).values():
            for pr in papel["projections"]:
                if "Measure" in (pr.get("field") or {}):
                    medidas.append(pr["nativeQueryRef"])
        if not medidas:
            continue
        livres = [m for m in medidas if m not in com_janela]
        if not livres:
            pg = pathlib.PurePath(f).parts[-4]
            print(f"tabela so com medidas de janela em {pg[:8]}: {', '.join(medidas)}"
                  f" -- linhas fora do recorte nao serao devolvidas")
            erros += 1
    print(f"tabelas conferidas contra recorte silencioso: problemas: {erros}")
    return erros


if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else "out/SupplyVisionPainel.Report/definition"
    total = (valida(d) + geometria(d) + orfas(d) + bookmarks(d)
             + tabelas_com_janela(d))
    sys.exit(1 if total else 0)
