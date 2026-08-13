"""Paginas do painel — estado apos a revisao estetica de 13/08/2026.

Sete paginas. Titulos curtos (o contexto vem da aba, nao do texto dentro dela),
cards e segmentadores sem titulo (repetiam o nome do campo duas vezes no mesmo
quadrado) e duas paginas restritas por janela deslizante.
"""
import json, pathlib
from relatorio import *

W, H = 1280, 720
CARD_H, CARD_Y = 88, 52
AMBAR, AZUL, CINZA = "#E39502", "#1C5CAB", "#8A94A6"

CORES_COBERTURA = {"Valor Dentro do Acordo": AZUL,
                   "Valor Fora Sem Alternativa": CINZA,
                   "Valor em Fuga": AMBAR}
CORES_DENTRO_FORA = {"Valor Dentro do Acordo": AZUL, "Valor Fora do Acordo": AMBAR}

# Nome curto so na legenda. Tres rotulos de 25 caracteres comem a largura util
# do grafico -- no print da Visao Geral a legenda ocupava mais espaco que a
# menor das barras. O nome da medida no modelo continua o longo, que e o que o
# cartao precisa mostrar.
APELIDOS = {"Valor Dentro do Acordo":     "Dentro",
            "Valor Fora Sem Alternativa": "Sem alternativa",
            "Valor em Fuga":              "Fuga",
            "Valor Fora do Acordo":       "Fora"}

def faixa_cards(medidas, y=CARD_Y, fontes=None, destaque=None, larg=None):
    """Cartoes em faixa. Sem larg=, dividem a largura da pagina.

    Com dois cartoes a divisao dava 636px para um numero de oito caracteres --
    o print mostrava dois retangulos quase vazios. larg= fixa a largura e os
    encosta na esquerda.
    """
    n = len(medidas); w = larg or (W - (n-1)*8) // n
    return [card(i*(w+8), y, w, CARD_H, m, fonte=(fontes or {}).get(m),
                 destaque=(m == destaque))
            for i, m in enumerate(medidas)]

def pagina(nome, visuais, filtros=None):
    p = {"name": guid("pg/"+nome), "displayName": nome, "visualContainers": visuais}
    if filtros: p["filterConfig"] = filtros
    return p

# ═══ 1. Visao Geral ══════════════════════════════════════════════
# Tres rankings em top 20 na mesma linha: 372px de altura dao ~18px por barra.
# O grafico mensal cedeu altura (240 -> 180) para isso caber sem rolagem.
p1 = [texto(0, 0, 620, 44, "Supply Vision", 15)]
p1 += [filtro(640, 0, 300, 44, "Ano-Mes"), filtro(948, 0, 332, 44, "STATUS_ACORDO")]
p1 += faixa_cards(["Valor Total", "Valor Fora do Acordo", "% Fora do Acordo",
                   "Valor em Fuga", "% Acima 30d"], destaque="% Fora do Acordo")
# Tres rankings de 273px truncavam o nome em ~14 caracteres ("AUTO PECAS
# SAO..."), o que anula o ranking: nao se le o que esta em primeiro. Passam a
# ser dois de 414px na esquerda, e "Grupos de modelo" -- que tem rotulo curto e
# poucas categorias -- desce para a coluna da direita.
p1 += [
    empilhado(0, 148, 836, 212, "Ano-Mes",
              ["Valor Dentro do Acordo", "Valor Fora Sem Alternativa", "Valor em Fuga"],
              "Composicao mensal em R$", cores=CORES_COBERTURA, apelidos=APELIDOS),
    barras_empilhadas(844, 148, 436, 340, "Grupo Item",
                      ["Valor Dentro do Acordo", "Valor Fora do Acordo"],
                      "Top 20 grupos de item — 59,3% do valor",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Grupo Item", 20),
                      apelidos=APELIDOS),
    barras(844, 496, 436, 212, "Grupo Modelo", "Valor Total", "Grupos de modelo"),
    barras(0, 368, 414, 340, "Cidade", "Valor Total",
           "Top 20 cidades — 58,7%", filtros=top_n("Cidade", 20)),
    barras_empilhadas(422, 368, 414, 340, "Fornecedor",
                      ["Valor Dentro do Acordo", "Valor Fora do Acordo"],
                      "Top 20 fornecedores — 36,8%",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Fornecedor", 20),
                      apelidos=APELIDOS),
]

# ═══ 2. Fora do Acordo ═══════════════════════════════════════════
p2 = [texto(0, 0, 900, 44, "Fora do acordo", 15)]
p2 += faixa_cards(["Valor Fora do Acordo", "% Fora do Acordo"],
                  destaque="Valor Fora do Acordo", larg=306)
p2 += [
    colunas_(0, 148, 836, 240, "Ano-Mes", "Valor Fora do Acordo",
             "Valor fora do acordo por mes", cat_asc=True),
    barras(844, 148, 436, 280, "Motivo Sem Acordo", "Valor Fora do Acordo",
           "Em qual dimensao faltou referencia"),
    barras(844, 436, 436, 272, "Grupo Modelo", "Valor Fora do Acordo",
           "Grupos de modelo fora do acordo"),
    barras(0, 396, 414, 312, "Fornecedor", "Valor Fora do Acordo",
           "Top 20 fornecedores — 25,9% do fora do acordo",
           filtros=top_n("Fornecedor", 20)),
    barras(422, 396, 414, 312, "Grupo Item", "Valor Fora do Acordo",
           "Top 20 grupos de item — 51,7% do fora do acordo",
           filtros=top_n("Grupo Item", 20)),
]

# ═══ 3. Fuga de Contrato (365 dias) ══════════════════════════════
# Restrita a um ano deslizante: sem vigencia na ACORDOS.xlsx, uma compra de
# 2025 que hoje casa com um acordo pode nao ter tido acordo naquela data. Um
# ano limita o quanto o catalogo mudou entre a OS e a tabela atual.
# Na janela: R$ 1,77 mi em 10.986 linhas, e a fuga se concentra em 38 cidades.
p3 = [texto(0, 0, 900, 44, "Fuga de contrato", 15)]
p3 += faixa_cards(["Janela 365d", "Valor em Fuga"], fontes={"Janela 365d": 12},
                  destaque="Valor em Fuga", larg=306)
p3 += [
    colunas_(0, 148, 836, 240, "Ano-Mes", "Valor em Fuga",
             "Valor em fuga por mes", cat_asc=True),
    barras(844, 148, 436, 560, "Cidade", "Valor em Fuga",
           "Top 20 cidades — 96,0% da fuga (ocorre em 38)",
           filtros=top_n("Cidade", 20)),
    barras(0, 396, 414, 312, "Fornecedor", "Valor em Fuga",
           "Top 20 fornecedores — 56,3% da fuga", filtros=top_n("Fornecedor", 20)),
    barras(422, 396, 414, 312, "Grupo Item", "Valor em Fuga",
           "Top 20 grupos de item — 72,4% da fuga", filtros=top_n("Grupo Item", 20)),
]

# ═══ 4. Conformidade de Preco (30 dias) ══════════════════════════
p4 = [texto(0, 0, 1000, 44, "Conformidade de preco", 15)]
p4 += faixa_cards(["Janela 30d", "Valor Dentro do Acordo", "% Conforme", "% Acima", "% Abaixo"],
                  fontes={"Janela 30d": 12}, destaque="% Acima")
p4 += [
    # Era "Valor coberto por acordo" por Ano-Mes: dentro de uma janela de 30
    # dias isso rende uma ou duas colunas -- um grafico para dizer um numero
    # que o cartao ao lado ja diz. Trocado pela composicao por Status, que e a
    # pergunta da aba: dentro do que tem acordo, quanto vem acima, conforme e
    # abaixo.
    barras(0, 148, 636, 260, "Status", "Valor Total",
           "Composicao por status na janela"),
    barras(644, 148, 636, 260, "Fornecedor", "Valor Acima do Acordo",
           "Fornecedores que cobraram acima do acordo",
           filtros=top_n("Fornecedor", 20)),
    barras(0, 416, 636, 292, "Grupo Item", "Valor Acima do Acordo",
           "Grupos de item cobrados acima do acordo", filtros=top_n("Grupo Item", 20)),
    tabela(644, 416, 636, 292,
           ["Data", "OS", "Cidade", "Fornecedor", "Grupo Item"],
           ["Valor Total", "Valor Acima do Acordo"],
           "Linhas acima do acordo — base para cobrar o fornecedor"),
]

# ═══ 5. Analises Mensais ═════════════════════════════════════════
p5 = [texto(0, 0, 900, 44, "Analises mensais", 15)]
p5 += [filtro(948, 0, 332, 44, "Ano")]
p5 += faixa_cards(["Valor Total", "% Fora do Acordo", "Valor em Fuga"],
                  destaque="% Fora do Acordo")
p5 += [
    empilhado(0, 148, 1280, 260, "Ano-Mes",
              ["Valor Dentro do Acordo", "Valor Fora Sem Alternativa", "Valor em Fuga"],
              "Participacao mensal — a cobertura melhora ou piora?",
              cores=CORES_COBERTURA, cem_por_cento=True),
    matriz(0, 416, 1280, 292, ["Ano-Mes"], [],
           ["Valor Total", "Valor Dentro do Acordo", "Valor Fora do Acordo",
            "% Fora do Acordo", "Valor em Fuga"],
           "Mes a mes, em numero"),
]

# ═══ 6. Analises Anuais ══════════════════════════════════════════
# Sem cartao de variacao anual: 2026 esta parcial (vai ate 12/08) e um YoY
# mostraria queda que nao existe. A matriz Ano x Mes deixa a parcialidade
# visivel em vez de esconder num percentual.
p6 = [texto(0, 0, 900, 44, "Analises anuais", 15)]
p6 += faixa_cards(["Valor Total", "% Fora do Acordo", "Valor em Fuga"],
                  destaque="% Fora do Acordo")
p6 += [
    empilhado(0, 148, 436, 260, "Ano",
              ["Valor Dentro do Acordo", "Valor Fora Sem Alternativa", "Valor em Fuga"],
              "Comparativo anual (2026 parcial, ate 12/08)", cores=CORES_COBERTURA),
    linha_(444, 148, 836, 260, "Mes Nome", "Valor Total",
           "Sazonalidade — mesmo mes, anos diferentes", serie="Ano"),
    matriz(0, 416, 1280, 292, ["Ano"], ["Mes Nome"], ["Valor Total"],
           "Ano x mes — onde 2026 ainda nao fechou"),
]

# ═══ 7. Detalhe ══════════════════════════════════════════════════
# Treze segmentadores em duas colunas. Com as abas de dimensao removidas, esta
# pagina virou o lugar de consulta pontual ("o fornecedor X cumpre acordo?").
FILTROS_ESQ = ["Ano", "Mes Nome", "Cidade", "Fornecedor", "Grupo Modelo", "Modelo", "Criador"]
FILTROS_DIR = ["Grupo Item", "Item", "Status", "STATUS_ACORDO", "Tinha acordo?", "Motivo Sem Acordo"]
p7 = [texto(0, 0, 900, 40, "Detalhe", 13)]
for i, dim in enumerate(FILTROS_ESQ):
    p7.append(filtro(0, 44 + i*96, 206, 92, dim))
for i, dim in enumerate(FILTROS_DIR):
    p7.append(filtro(214, 44 + i*112, 206, 108, dim))
p7 += [tabela(428, 44, 852, 668,
              ["Data", "OS", "Cidade", "Fornecedor", "Grupo Modelo", "Modelo",
               "Grupo Item", "Item", "Status", "STATUS_ACORDO", "Tinha acordo?",
               "Motivo Sem Acordo", "Criador"],
              ["Valor Total"], "Linhas do painel")]

paginas = [pagina("Visao Geral", p1),
           pagina("Fora do Acordo", p2),
           pagina("Fuga de Contrato", p3, filtros=filtro_janela("Ultimos 365 dias")),
           pagina("Conformidade de Preco", p4, filtros=filtro_janela("Ultimos 30 dias")),
           pagina("Analises Mensais", p5),
           pagina("Analises Anuais", p6),
           pagina("Detalhe", p7)]

n_pg, n_vis = escrever("out/SupplyVisionPainel.Report/definition", paginas)
print("paginas:", n_pg, "| visuais:", n_vis)
