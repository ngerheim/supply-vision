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
                   "Valor Sem Alternativa": CINZA,
                   "Valor em Fuga": AMBAR}
CORES_DENTRO_FORA = {"Valor Dentro do Acordo": AZUL, "Valor Sem Acordo": AMBAR}
NAVY = AZUL

# Nome curto so na legenda. Tres rotulos de 25 caracteres comem a largura util
# do grafico -- no print da Visao Geral a legenda ocupava mais espaco que a
# menor das barras. O nome da medida no modelo continua o longo, que e o que o
# cartao precisa mostrar.
APELIDOS = {"Valor Dentro do Acordo": "Dentro do acordo",
            "Valor Sem Alternativa":  "Sem alternativa",
            "Valor em Fuga":          "Fuga de contrato",
            "Valor Sem Acordo":       "Sem acordo"}

# Rotulo do cartao, quando o nome da medida nao diz o denominador. "% Acima" ao
# lado de um cartao de R$ 824,1 mil convida a multiplicar os dois -- e da R$ 176
# mil onde o numero e R$ 44 mil, porque a base e o valor COM acordo.
ROTULOS = {
    "Valor Dentro do Acordo 30d":          "Base com acordo avaliada (30d)",
    "% Acima":                             "% acima — da base avaliada",
    "% Abaixo":                            "% abaixo — da base avaliada",
    "% Conforme":                          "% conforme — da base avaliada",
    "Valor Total 30d":                     "Gasto total na janela",
    "Valor Total 365d":                    "Gasto total na janela",
    "Valor Sem Acordo 30d":                "Sem acordo na janela",
    "Valor Sem Acordo 365d":               "Sem acordo na janela",
    "Valor em Fuga 365d":                  "Fuga de contrato na janela",
    "% da Fuga sobre o Sem Acordo 365d":   "% do sem acordo que era fuga",
}


def faixa_cards(medidas, y=CARD_Y, fontes=None, destaque=None, larg=None):
    """Cartoes em faixa. Sem larg=, dividem a largura da pagina.

    Com dois cartoes a divisao dava 636px para um numero de oito caracteres --
    o print mostrava dois retangulos quase vazios. larg= fixa a largura e os
    encosta na esquerda.
    """
    n = len(medidas); w = larg or (W - (n-1)*8) // n
    return [card(i*(w+8), y, w, CARD_H, m, fonte=(fontes or {}).get(m),
                 destaque=(m == destaque), rotulo=ROTULOS.get(m))
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
# O cartao de fuga usa a medida de 365 dias, nao a historica. Mostrar R$ 2,6 mi
# de fuga no historico contradiz a propria regra do painel: sem vigencia no
# acordo, a fuga historica e justamente a leitura que a metodologia considera
# insegura. Na janela sao R$ 1,8 mi, e esse e o numero acionavel.
p1 += faixa_cards(["Valor Total", "Valor Sem Acordo", "% Sem Acordo",
                   "Valor em Fuga 365d"], destaque="% Sem Acordo", larg=306)
# Quatro colunas de 314px com a mesma altura. Antes, "grupos de item" tinha
# 340px para vinte barras e mostrava treze com barra de rolagem -- um top 20 que
# esconde sete nao e um top 20. Com o rotulo de dado fora, 314px de largura
# comportam mais texto de categoria do que os 414px comportavam com rotulo.
p1 += [
    barras(0, 148, 314, 560, "Cidade", "Valor Total",
           "Top 20 cidades — 58,7% do gasto total (histórico)",
           filtros=top_n("Cidade", 20), cor=NAVY),
    barras_empilhadas(322, 148, 314, 560, "Fornecedor",
                      ["Valor Dentro do Acordo", "Valor Sem Acordo"],
                      "Top 20 fornecedores — 36,8% do gasto (histórico)",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Fornecedor", 20),
                      apelidos=APELIDOS),
    barras_empilhadas(644, 148, 314, 560, "Grupo Item",
                      ["Valor Dentro do Acordo", "Valor Sem Acordo"],
                      "Top 20 grupos de item — 59,3% do gasto (histórico)",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Grupo Item", 20),
                      apelidos=APELIDOS),
    # Oito grupos apos os filtros do Supply Vision, entao nao ha top N a aplicar
    # e a cobertura e 100% por construcao.
    barras(966, 148, 314, 560, "Grupo Modelo", "Valor Total",
           "Gasto por grupo de modelo (histórico, 8 grupos)", cor=NAVY),
]

# ═══ 2. Fora do Acordo ═══════════════════════════════════════════
p2 = [texto(0, 0, W, TOPO_H, "Sem acordo", 15)]
# Cartoes na janela de 30 dias. Os do total historico sao identicos aos da
# Visao Geral -- dois cartoes repetindo numero nao informam nada. Em 30 dias
# passam a responder "e agora, esta melhorando?".
p2 += faixa_cards(["Janela 30d", "Valor Sem Acordo 30d", "% Sem Acordo 30d"],
                  fontes={"Janela 30d": 11}, destaque="% Sem Acordo 30d",
                  larg=306)
# A pagina mistura dois periodos de proposito: os cartoes dizem como esta agora,
# os graficos dizem a estrutura do problema no historico. Sem rotular as duas
# zonas, o leitor supoe que o grafico detalha o cartao -- e nao detalha.
p2 += [texto(942, 60, 338, 36, "Situacao atual — 30 dias", 10, negrito=False),
       texto(0, 112, 640, 30, "Diagnostico historico — 01/2025 em diante", 10,
             negrito=False)]
p2 += [
    colunas_(0, 146, 836, 242, "Ano-Mes", "Valor Sem Acordo",
             "Valor sem acordo por mês — histórico, meses fechados", cat_asc=True, filtros=filtro_coluna("Mes Fechado")),
    barras(844, 146, 436, 282, "Motivo Sem Acordo", "Valor Sem Acordo",
           "Em qual dimensão faltou referência — histórico"),
    barras(844, 436, 436, 272, "Grupo Modelo", "Valor Sem Acordo",
           "Sem acordo por grupo de modelo — histórico"),
    barras(0, 396, 414, 312, "Fornecedor", "Valor Sem Acordo",
           "Top 20 fornecedores — 25,9% do sem acordo (histórico)",
           filtros=top_n("Fornecedor", 20)),
    barras(422, 396, 414, 312, "Grupo Item", "Valor Sem Acordo",
           "Top 20 grupos de item — 51,7% do sem acordo (histórico)",
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
# Funil na ordem da decisao: gasto -> fora do acordo -> tinha acordo e nao foi
# usado -> que fracao do fora isso representa. O percentual antigo dividia pelo
# gasto total (16,2%), o que responde outra pergunta: sobre o fora sao 22,7%.
p3 += faixa_cards(["Janela 365d", "Valor Total 365d", "Valor Sem Acordo 365d",
                   "Valor em Fuga 365d", "% da Fuga sobre o Sem Acordo 365d"],
                  fontes={"Janela 365d": 11},
                  destaque="% da Fuga sobre o Sem Acordo 365d", larg=254)
p3 += [
    # Doze meses fechados em vez de "tudo na janela de 365 dias": a janela
    # comeca no meio de agosto/2025 e termina no meio de agosto/2026, entao as
    # duas colunas das pontas apareciam pela metade e a serie parecia subir e
    # depois cair.
    colunas_(0, 148, 836, 240, "Ano-Mes", "Valor em Fuga",
             "Fuga de contrato por mês — 12 meses fechados", cat_asc=True,
             filtros=filtro_coluna("Ultimos 12 meses fechados")),
    barras(844, 148, 436, 560, "Cidade", "Valor em Fuga",
           "Top 20 cidades — 96,0% da fuga na janela (ocorre em 38)",
           filtros=top_n("Cidade", 20)),
    barras(0, 396, 414, 312, "Fornecedor", "Valor em Fuga",
           "Top 20 fornecedores — 56,3% da fuga na janela", filtros=top_n("Fornecedor", 20)),
    barras(422, 396, 414, 312, "Grupo Item", "Valor em Fuga",
           "Top 20 grupos de item — 72,4% da fuga na janela", filtros=top_n("Grupo Item", 20)),
]

# ═══ 4. Conformidade de Preco (30 dias) ══════════════════════════
p4 = [texto(0, 0, W, TOPO_H, "Conformidade de preço", 15)]
# "% Conforme" sai da faixa: e 100% menos acima menos abaixo, e o espaco vale
# mais para a base do calculo, que era o que faltava.
p4 += faixa_cards(["Janela 30d", "Valor Total 30d", "Valor Dentro do Acordo 30d",
                   "% Acima", "% Abaixo"], fontes={"Janela 30d": 11},
                  destaque="% Acima", larg=254)
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
           "Valor comprado por status do preço — janela de 30 dias", cor=NAVY),
    # Excedente pago, nao valor comprado: sao numeros de ordem de grandeza
    # diferente e antes tinham nomes parecidos.
    barras(644, 148, 636, 260, "Fornecedor", "Excedente Acima do Acordo",
           "Excedente pago por fornecedor — janela de 30 dias",
           filtros=top_n("Fornecedor", 20)),
    barras(0, 416, 636, 292, "Grupo Item", "Excedente Acima do Acordo",
           "Excedente pago por grupo de item — janela de 30 dias",
           filtros=top_n("Grupo Item", 20)),
    # A prova da cobranca e preco cobrado x preco acordado x quantidade x
    # diferenca. Antes essas quatro colunas ficavam fora da area visivel, atras
    # de Cidade e Grupo Item, e a tabela abria ordenada por data -- comecava
    # pela linha mais antiga em vez da mais caras.
    tabela(644, 416, 636, 292,
           ["Data", "OS", "Fornecedor", "Item", "Qtd",
            "Preco OS", "Preco Acordo", "Diferenca Total"],
           [], "Linhas acima do acordo, da maior diferença para a menor",
           ordem=("Diferenca Total", False)),
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
# Colunas na ordem da decisao: quem, o que, quanto, e so depois a classificacao.
# Antes a tabela abria por data e as colunas de dinheiro ficavam atras de sete
# colunas de dimensao, fora da area visivel.
p7 += [tabela(428, 60, 852, 648,
              ["Data", "OS", "Fornecedor", "Item", "Qtd", "Preco OS",
               "Preco Acordo", "Diferenca Total", "Cidade", "Modelo",
               "Grupo Modelo", "Grupo Item", "Status", "STATUS_ACORDO",
               "Tinha acordo?", "Motivo Sem Acordo", "Criador"],
              [], "Linhas do painel, da maior diferença para a menor",
              ordem=("Diferenca Total", False))]

# Nome da aba com acento: ele aparece na barra de abas e no link direto para a
# pagina. Trocar depois de publicar quebra o link daquela aba -- e agora ou nunca.
paginas = [pagina("Visão Geral", p1),
           pagina("Sem acordo", p2),
           pagina("Fuga de contrato", p3, filtros=filtro_janela("Ultimos 365 dias")),
           pagina("Conformidade de preço", p4, filtros=filtro_janela("Ultimos 30 dias")),
           pagina("Detalhe", p7)]

n_pg, n_vis = escrever("out/SupplyVisionPainel.Report/definition", paginas)
print("paginas:", n_pg, "| visuais:", n_vis)
