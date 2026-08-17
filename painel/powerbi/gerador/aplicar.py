"""Gera, valida e copia para o projeto. Aborta se o gate reprovar.

O passo de copia so acontece se validar.py sair com 0. E a ordem do LEIA.md:
apagar o definition/ antigo em vez de sobrescrever, porque visual removido deixa
visual.json orfao e o Power BI carrega os dois -- em 13/08/2026 foram 73
visual.json para 67 visuais, e o painel mostrou o mesmo ranking duas vezes.

EXCECAO: definition/bookmarks/. Bookmark guarda estado de segmentador, capturado
pelo Desktop porque escrever esse estado a mao valida contra o schema e ainda
assim pode nao limpar nada. Botao de "limpar filtros" que nao limpa e pior que
botao ausente. Entao a pasta e salva antes do rmtree e devolvida depois -- aqui e
tambem dentro de relatorio.escrever(), porque sao dois pontos destrutivos
diferentes: este apaga o definition/ do PROJETO, aquele o do out/.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GER = Path(r"C:\Projetos\supply-vision-privado\painel\powerbi\gerador")
REPORT = Path(r"C:\Projetos\supply-vision-privado\painel\powerbi\SupplyVisionPainel.Report")
MODEL = Path(r"C:\Projetos\supply-vision-privado\painel\powerbi\SupplyVisionPainel.SemanticModel")


def rodar(script, *args):
    r = subprocess.run([sys.executable, script, *args], cwd=GER, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    print(f"  {Path(script).name:12} rc={r.returncode}")
    for l in (r.stdout + r.stderr).strip().splitlines():
        print("     ", l)
    return r.returncode


print("1. o Power BI Desktop esta fechado?")
r = subprocess.run(["tasklist", "/fi", "imagename eq PBIDesktop.exe"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
if "PBIDesktop" in r.stdout:
    print("   ABERTO -- feche antes. Ele reescreve definition/ ao salvar e")
    print("   descarta o que for gravado por fora. Nada foi alterado.")
    sys.exit(2)
print("   fechado")

print("\n2. gerando")
for s in ("modelo.py", "paginas.py", "tema.py"):
    if rodar(s):
        print("   ABORTADO na geracao. Nada foi copiado.")
        sys.exit(1)

# O bookmark vive no projeto, nao no out/: quem o cria e o Desktop, e o gerador
# nao o emite. Copiar para o out/ ANTES de validar faz duas coisas: o out/ passa a
# ser um espelho fiel do que vai ser publicado, e a checagem de bookmark orfao
# (validar.py:bookmarks) roda sobre o conjunto real em vez de reprovar sempre por
# nao encontrar arquivo nenhum.
print("\n2b. semeando out/ com os bookmarks do projeto")
origem_bm = REPORT / "definition" / "bookmarks"
out_def = GER / "out" / "SupplyVisionPainel.Report" / "definition"
if origem_bm.is_dir():
    alvo = out_def / "bookmarks"
    if alvo.is_dir():
        shutil.rmtree(alvo)
    shutil.copytree(origem_bm, alvo)
    print(f"   {len(list(alvo.glob('*.json')))} arquivos")
else:
    print("   nenhum no projeto -- se houver botao de bookmark, o passo 3 reprova")

print("\n3. validando (porteiro)")
if rodar("validar.py"):
    print("   REPROVADO. Nada foi copiado -- o projeto continua como estava.")
    sys.exit(1)

print("\n4. copiando para o projeto")
origem = GER / "out" / "SupplyVisionPainel.Report" / "definition"
destino = REPORT / "definition"

guardado = None
bm = destino / "bookmarks"
if bm.is_dir():
    guardado = Path(tempfile.mkdtemp()) / "bookmarks"
    shutil.copytree(bm, guardado)
    print(f"   guardado bookmarks/ ({len(list(bm.glob('*.json')))} arquivos)")

if destino.exists():
    shutil.rmtree(destino)
    print(f"   apagado  {destino}")
shutil.copytree(origem, destino)
print(f"   copiado  {len(list(destino.rglob('*.json')))} arquivos json")

if guardado is not None:
    alvo_bm = destino / "bookmarks"
    if alvo_bm.is_dir():
        # A geracao passou a emitir bookmarks. O gerado ganha: se um dia
        # paginas.py declarar bookmarks, e ele a fonte, nao a copia guardada.
        print("   bookmarks/ tambem vem da geracao -- mantido o gerado")
        shutil.rmtree(guardado.parent)
    else:
        shutil.copytree(guardado, alvo_bm)
        shutil.rmtree(guardado.parent)
        print(f"   devolvido bookmarks/ ({len(list(alvo_bm.glob('*.json')))} arquivos)")

# StaticResources/ e irmao de definition/, entao o copytree acima nao o alcanca.
# E aqui que vive o tema registrado. rmtree antes: no projeto ha 14 copias antigas
# byte a byte identicas, criadas uma por importacao de tema no Desktop e nunca
# removidas por ele. A geracao deixa UMA, com nome fixo.
origem_sr = GER / "out" / "SupplyVisionPainel.Report" / "StaticResources"
destino_sr = REPORT / "StaticResources"
if origem_sr.is_dir():
    antigas = len(list(destino_sr.rglob("*.json"))) if destino_sr.is_dir() else 0
    if destino_sr.exists():
        shutil.rmtree(destino_sr)
    shutil.copytree(origem_sr, destino_sr)
    novas = len(list(destino_sr.rglob("*.json")))
    print(f"   StaticResources: {antigas} arquivo(s) -> {novas}")

shutil.copy2(GER / "model.bim.json", MODEL / "model.bim")
print("   copiado  model.bim")

print("\n5. conferindo o que foi para o projeto")
rodar("validar.py", str(destino))

print("\n6. medidas no model.bim do projeto")
import json
tb = json.loads((MODEL / "model.bim").read_text(encoding="utf-8"))["model"]["tables"][0]
med = sorted(m["name"] for m in tb["measures"])
print(f"   {len(med)} medidas, {len(tb['columns'])} colunas")
print("   titulos dinamicos:", sum(1 for m in med if m.startswith("Titulo ")))
print("   [Atualizacao] presente:", "Atualizacao" in med)

print("\n7. bookmarks no projeto")
alvo_bm = destino / "bookmarks"
if alvo_bm.is_dir():
    for f in sorted(alvo_bm.glob("*.json")):
        try:
            o = json.loads(f.read_text(encoding="utf-8"))
            print(f"   {f.name}: name={o.get('name')!r} displayName={o.get('displayName')!r}")
        except Exception as e:
            print(f"   {f.name}: (nao lido: {e})")
else:
    print("   nenhum. Crie o de 'Limpar filtros' no Desktop e rode de novo --")
    print("   a partir dai ele sobrevive as regeracoes.")
