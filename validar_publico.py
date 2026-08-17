"""Porteiro de publicacao: nenhum arquivo rastreado carrega dado da operacao.

O .gitignore cuida de ARQUIVO de dado. Isto cuida de outra coisa, que nenhum
.gitignore alcanca: cifra dentro de codigo, comentario ou docstring.

Existe porque o repositorio deste projeto e publico e o main desce da mesma raiz
que o publico -- nao sao duas historias, e uma. Um "git push" leva tudo. E porque
a pratica de documentar decisao com o numero medido e boa: sem uma trava, a
primeira cifra volta no primeiro commit em que alguem quiser registrar uma
medicao, e ninguem revisa comentario procurando cifra.

    python validar_publico.py          -> codigo 0 se limpo, 1 se achou
    python validar_publico.py --lista  -> imprime cada ocorrencia

Onde as medicoes moram: docs/wiki/, fora do versionamento. Quando existir um
repositorio PRIVADO, elas viram a wiki dele -- wiki de repositorio publico e
publica, nao existe wiki privada em repo publico.
"""
import re
import subprocess
import sys
from pathlib import Path

R = Path(__file__).resolve().parent

# Cada padrao com o motivo, para a mensagem de erro ensinar em vez de so acusar.
PADROES = [
    (re.compile(r"R\$\s?\d[\d.,]{2,}"),
     "valor em reais"),
    (re.compile(r"\b\d{1,3},\d\s?%"),
     "percentual medido"),
    (re.compile(r"\b\d{2,3}\.\d{3}\b"),
     "contagem de linhas da base"),
    # So os nomes distintivos. "gol", "polo", "toro" e "strada" sao palavras
    # comuns em portugues e em ingles: como padrao geram ruido, e gate ruidoso
    # ensina quem le a ignorar o gate.
    (re.compile(r"\b(hilux|oroch|saveiro|renegade)\b", re.I),
     "modelo da frota"),
    (re.compile(r"\b(megatrans|maicon|zizo|anhanguera|alencar|gv pneus|"
                r"truck car|rio verde|technocar|stop car|clean box)\b", re.I),
     "nome de fornecedor"),
    # "contagem" fora: colide com a palavra portuguesa, e apareceu em dois
    # arquivos que nao tem nada de cidade. "congonhas" fora pelo mesmo motivo
    # (aeroporto, bairro).
    (re.compile(r"\b(parauapebas|paracatu|itabirito|tres lagoas|cocalinho|"
                r"mara rosa|alvorada do norte)\b", re.I),
     "cidade da operacao"),
    # UNC de verdade: precedido por inicio, aspas, espaco ou "=". Sem isso o
    # padrao casava com "C:\\Projetos\\" escapado dentro de JSON, que e caminho
    # local e nao revela nada.
    (re.compile(r"(?:^|[\"'\s=(])\\\\[\w.-]+\\[A-Za-z]|192\.168\.\d+\.\d+"),
     "caminho de rede interno"),
]

# O tema declara a marca no proprio conteudo, e e isso que aparece no Desktop.
# Nao e cifra e nao sai. Idem o LICENSE, que nomeia o titular.
ISENTOS = {
    "painel/powerbi/LocFrotas_SupplyVision.json",
    "painel/powerbi/SupplyVisionPainel.Report/StaticResources/RegisteredResources/tema_supply_vision.json",
    "LICENSE",
    "validar_publico.py",
}
EXT = (".py", ".ps1", ".md", ".txt", ".yml", ".yaml", ".bat", ".json", ".bim",
       ".pbip", ".pbir", ".pbism", ".csv")



def rastreados():
    r = subprocess.run(("git", "ls-files"), cwd=R, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    return [l for l in r.stdout.splitlines() if l]


def main(listar):
    achados = []
    n = 0
    for rel in rastreados():
        if rel in ISENTOS or not rel.endswith(EXT):
            continue
        p = R / rel
        try:
            linhas = p.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        n += 1
        for i, linha in enumerate(linhas, 1):
            for padrao, motivo in PADROES:
                m = padrao.search(linha)
                if m:
                    achados.append((rel, i, motivo, m.group(0), linha.strip()[:100]))
                    break

    print(f"arquivos rastreados inspecionados: {n}")
    if not achados:
        print("nenhum dado da operacao em arquivo rastreado.")
        return 0

    porq = {}
    for rel, i, motivo, trecho, linha in achados:
        porq.setdefault(motivo, []).append((rel, i, trecho, linha))
    print(f"ENCONTRADO em {len(achados)} linha(s):\n")
    for motivo, itens in sorted(porq.items()):
        print(f"  {motivo}  ({len(itens)})")
        for rel, i, trecho, linha in (itens if listar else itens[:3]):
            print(f"    {rel}:{i}  [{trecho}]")
            if listar:
                print(f"        {linha}")
        if not listar and len(itens) > 3:
            print(f"    ... e mais {len(itens) - 3} (use --lista)")
        print()
    print("Como resolver: mova o numero para docs/wiki/ e deixe no codigo o")
    print("MECANISMO, que e o que a proxima pessoa precisa ler naquela linha.")
    print("Se for falso positivo, acrescente o caminho a ISENTOS com o motivo.")
    return 1


if __name__ == "__main__":
    sys.exit(main("--lista" in sys.argv))
