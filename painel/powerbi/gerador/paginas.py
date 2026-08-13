"""Paginas do painel — estado apos a revisao estetica de 13/08/2026.

Sete paginas. Titulos curtos (o contexto vem da aba, nao do texto dentro dela),
cards e segmentadores sem titulo (repetiam o nome do campo duas vezes no mesmo
quadrado) e duas paginas restritas por janela deslizante.
"""
import json, pathlib
from relatorio import *

W, H = 1280, 720
# Faixa de topo de 56px: o dropdown do segmentador tem cabecalho + caixa e nao
# cabe em 44px (nos prints de 13/08 o "Todos" saia cortado pela metade). Os
# cartoes descem junto e perdem 8px de altura para o grafico continuar em 148.
TOPO_H = 56
CARD_H, CARD_Y = 80, 60
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
# Sem segmentadores e sem serie temporal: a aba responde "onde esta o dinheiro",
# nao "como evoluiu". Os dois segmentadores no topo cortavam por Ano-Mes e
# STATUS_ACORDO uma pagina que existe para ser o retrato do total, e o cartao
# "% Acima 30d" trazia para ca um numero que e o assunto da aba de conformidade.
#
# Com o grafico mensal fora, os quatro rankings ficam com 560px de altura --
# 28px por barra no top 20, o dobro do que tinham.
p1 = [texto(0, 0, W, TOPO_H, "Supply Vision", 15)]
p1 += faixa_cards(["Valor Total", "Valor Fora do Acordo", "% Fora do Acordo",
                   "Valor em Fuga"], destaque="% Fora do Acordo", larg=306)
# Quatro colunas de 314px com a mesma altura. Antes, "grupos de item" tinha
# 340px para vinte barras e mostrava treze com barra de rolagem -- um top 20 que
# esconde sete nao e um top 20. Com o rotulo de dado fora, 314px de largura
# comportam mais texto de categoria do que os 414px comportavam com rotulo.
p1 += [
    barras(0, 148, 314, 560, "Cidade", "Valor Total",
           "Top 20 cidades — 58,7%", filtros=top_n("Cidade", 20)),
    barras_empilhadas(322, 148, 314, 560, "Fornecedor",
                      ["Valor Dentro do Acordo", "Valor Fora do Acordo"],
                      "Top 20 fornecedores — 36,8%",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Fornecedor", 20),
                      apelidos=APELIDOS),
    barras_empilhadas(644, 148, 314, 560, "Grupo Item",
                      ["Valor Dentro do Acordo", "Valor Fora do Acordo"],
                      "Top 20 grupos de item — 59,3%",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Grupo Item", 20),
                      apelidos=APELIDOS),
    barras(966, 148, 314, 560, "Grupo Modelo", "Valor Total", "Grupos de modelo"),
]

# ═══ 2. Fora do Acordo ═══════════════════════════════════════════
p2 = [texto(0, 0, W, TOPO_H, "Fora do acordo", 15)]
# Cartoes na janela de 30 dias. Os do total historico sao identicos aos da
# Visao Geral -- dois cartoes repetindo numero nao informam nada. Em 30 dias
# passam a responder "e agora, esta melhorando?".
p2 += faixa_cards(["Janela 30d", "Valor Fora do Acordo 30d", "% Fora do Acordo 30d"],
                  fontes={"Janela 30d": 12}, destaque="% Fora do Acordo 30d",
                  larg=306)
p2 += [
    colunas_(0, 148, 836, 240, "Ano-Mes", "Valor Fora do Acordo",
             "Valor fora do acordo por mes (meses fechados)", cat_asc=True, filtros=filtro_coluna("Mes Fechado")),
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
p3 = [texto(0, 0, W, TOPO_H, "Fuga de contrato", 15)]
# O gasto total da janela entra ao lado da fuga: sem ele o leitor compara
# R$ 1,8 mi de fuga com os R$ 17,1 mi do historico e conclui 10%, quando dentro
# da janela e outro numero.
p3 += faixa_cards(["Janela 365d", "Valor Total 365d", "Valor em Fuga 365d",
                   "% em Fuga 365d"], fontes={"Janela 365d": 12},
                  destaque="% em Fuga 365d", larg=306)
p3 += [
    # Doze meses fechados em vez de "tudo na janela de 365 dias": a janela
    # comeca no meio de agosto/2025 e termina no meio de agosto/2026, entao as
    # duas colunas das pontas apareciam pela metade e a serie parecia subir e
    # depois cair.
    colunas_(0, 148, 836, 240, "Ano-Mes", "Valor em Fuga",
             "Valor em fuga nos ultimos 12 meses fechados", cat_asc=True,
             filtros=filtro_coluna("Ultimos 12 meses fechados")),
    barras(844, 148, 436, 560, "Cidade", "Valor em Fuga",
           "Top 20 cidades — 96,0% da fuga (ocorre em 38)",
           filtros=top_n("Cidade", 20)),
    barras(0, 396, 414, 312, "Fornecedor", "Valor em Fuga",
           "Top 20 fornecedores — 56,3% da fuga", filtros=top_n("Fornecedor", 20)),
    barras(422, 396, 414, 312, "Grupo Item", "Valor em Fuga",
           "Top 20 grupos de item — 72,4% da fuga", filtros=top_n("Grupo Item", 20)),
]

# ═══ 4. Conformidade de Preco (30 dias) ══════════════════════════
p4 = [texto(0, 0, W, TOPO_H, "Conformidade de preco", 15)]
p4 += faixa_cards(["Janela 30d", "Valor Total 30d", "% Conforme", "% Acima",
                   "% Abaixo"], fontes={"Janela 30d": 12}, destaque="% Acima",
                  larg=254)
p4 += [
    # Era "Valor coberto por acordo" por Ano-Mes: dentro de uma janela de 30
    # dias isso rende uma ou duas colunas -- um grafico para dizer um numero
    # que o cartao ao lado ja diz. Trocado pela composicao por Status, que e a
    # pergunta da aba: dentro do que tem acordo, quanto vem acima, conforme e
    # abaixo.
    # Medida "Valor Dentro do Acordo", nao "Valor Total": com o total, a barra
    # SEM ACORDO (R$ 0,6 mi) achata ACIMA e ABAIXO a zero visivel, e sao elas a
    # pergunta da aba. Com a medida de dentro do acordo, SEM ACORDO fica vazia e
    # sai do eixo sozinha.
    barras(0, 148, 636, 260, "Status", "Valor Dentro do Acordo",
           "Composicao por status do acordo na janela"),
    barras(644, 148, 636, 260, "Fornecedor", "Valor Acima do Acordo",
           "Fornecedores que cobraram acima do acordo",
           filtros=top_n("Fornecedor", 20)),
    barras(0, 416, 636, 292, "Grupo Item", "Valor Acima do Acordo",
           "Grupos de item cobrados acima do acordo",
           filtros=top_n("Grupo Item", 20)),
    tabela(644, 416, 636, 292,
           ["Data", "OS", "Cidade", "Fornecedor", "Grupo Item"],
           ["Valor Total", "Valor Acima do Acordo"],
           "Linhas acima do acordo — base para cobrar o fornecedor"),
]

# ═══ 7. Detalhe ══════════════════════════════════════════════════
# Treze segmentadores em duas colunas. Com as abas de dimensao removidas, esta
# pagina virou o lugar de consulta pontual ("o fornecedor X cumpre acordo?").
FILTROS_ESQ = ["Ano", "Mes Nome", "Cidade", "Fornecedor", "Grupo Modelo", "Modelo", "Criador"]
FILTROS_DIR = ["Grupo Item", "Item", "Status", "STATUS_ACORDO", "Tinha acordo?", "Motivo Sem Acordo"]
# Em modo lista a caixa precisava de ~96px; o dropdown fecha em 56 e os treze
# passam a caber em duas colunas sem sobra vazia entre eles.
p7 = [texto(0, 0, W, TOPO_H, "Detalhe", 13)]
for i, dim in enumerate(FILTROS_ESQ):
    p7.append(filtro(0, 60 + i*64, 206, 56, dim))
for i, dim in enumerate(FILTROS_DIR):
    p7.append(filtro(214, 60 + i*64, 206, 56, dim))
p7 += [tabela(428, 60, 852, 648,
              ["Data", "OS", "Cidade", "Fornecedor", "Grupo Modelo", "Modelo",
               "Grupo Item", "Item", "Status", "STATUS_ACORDO", "Tinha acordo?",
               "Motivo Sem Acordo", "Criador"],
              ["Valor Total"], "Linhas do painel")]

paginas = [pagina("Visao Geral", p1),
           pagina("Fora do Acordo", p2),
           pagina("Fuga de Contrato", p3, filtros=filtro_janela("Ultimos 365 dias")),
           pagina("Conformidade de Preco", p4, filtros=filtro_janela("Ultimos 30 dias")),
           pagina("Detalhe", p7)]

n_pg, n_vis = escrever("out/SupplyVisionPainel.Report/definition", paginas)
print("paginas:", n_pg, "| visuais:", n_vis)
