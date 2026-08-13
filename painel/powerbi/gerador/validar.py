"""Valida a arvore PBIR contra os schemas oficiais (clone local em /tmp/js).

O resolver do jsonschema tentaria buscar cada $ref na internet; aqui o store e
pre-carregado com todos os schemas do clone, indexados pela URI canonica, e
tambem pelo caminho relativo resolvido -- os $ref internos da Microsoft usam
caminhos como "../../semanticQuery/1.4.0/schema.json".
"""
import json, glob, os, sys, jsonschema

BASE = "/tmp/js/fabric/"
URI  = "https://developer.microsoft.com/json-schemas/fabric/"

store = {}
for f in glob.glob(BASE + "**/*.json", recursive=True):
    o = json.load(open(f, encoding="utf-8"))
    store[URI + os.path.relpath(f, BASE)] = o
    store["file://" + f] = o

def valida(destino):
    erros = n = 0
    for f in sorted(glob.glob(destino + "/**/*.json", recursive=True)):
        o = json.load(open(f, encoding="utf-8"))
        uri = o.get("$schema")
        if not uri:
            continue
        if uri not in store:
            print("schema fora do clone:", uri); erros += 1; continue
        r = jsonschema.RefResolver(base_uri=uri, referrer=store[uri], store=store)
        v = jsonschema.Draft7Validator(store[uri], resolver=r)
        for e in v.iter_errors(o):
            erros += 1
            print(os.path.relpath(f, destino), "|", "/".join(map(str, e.absolute_path)),
                  "->", e.message[:160])
        n += 1
    print(f"arquivos validados: {n} | erros: {erros}")
    return erros

if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else "out/SupplyVisionPainel.Report/definition"
    sys.exit(1 if valida(d) else 0)
