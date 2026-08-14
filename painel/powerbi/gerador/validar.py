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
import collections, json, glob, os, sys

import jsonschema
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

W, H = 1280, 720

BASE = "/tmp/js/fabric/"
URI  = "https://developer.microsoft.com/json-schemas/fabric/"

# Registry do referencing em vez do RefResolver antigo. O RefResolver empilhava
# escopo ao entrar num $ref externo e, ao voltar, resolvia um "#/definitions/..."
# contra o documento errado -- na pratica, adicionar visualInteractions ao
# page.json fazia a validacao estourar com KeyError em vez de acusar erro de
# schema. O Registry indexa cada documento pela URI canonica e nao tem esse
# problema de escopo.
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
    """
    paginas = collections.defaultdict(list)
    for f in glob.glob(destino + "/pages/*/visuals/*/visual.json"):
        o = json.load(open(f, encoding="utf-8"))
        p = o["position"]
        paginas[f.split(os.sep + "pages" + os.sep)[-1].split(os.sep)[0]].append(
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
    print("referencias orfas:", ", ".join(sorted(ruins)) or "nenhuma")
    return len(ruins)


if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else "out/SupplyVisionPainel.Report/definition"
    total = valida(d) + geometria(d) + orfas(d)
    sys.exit(1 if total else 0)
