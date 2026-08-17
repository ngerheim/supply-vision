"""Paginas do painel — estado apos a revisao estetica de 13/08/2026.

Sete paginas. Titulos curtos (o contexto vem da aba, nao do texto dentro dela),
cards e segmentadores sem titulo (repetiam o nome do campo duas vezes no mesmo
quadrado) e duas paginas restritas por janela deslizante.
"""
import json, pathlib
from relatorio import *

W, H = 1280, 720
TOPO_H = 56
CARD_H, CARD_Y = 80, 60
AMBAR, AZUL, CINZA = "#E39502", "#1C5CAB", "#8A94A6"

CORES_COBERTURA = {"Valor Dentro do Acordo": AZUL,
                   "Valor Sem Alternativa": CINZA,
                   "Valor em Fuga": AMBAR}
CORES_DENTRO_FORA = {"Valor Dentro do Acordo": AZUL, "Valor Sem Acordo": AMBAR}
NAVY = AZUL

APELIDOS = {"Valor Dentro do Acordo": "Dentro do acordo",
            "Valor Sem Alternativa":  "Sem alternativa",
            "Valor em Fuga":          "Fuga de contrato",
            "Valor Sem Acordo":       "Sem acordo"}

ROTULOS = {
    "Valor Dentro do Acordo 30d":          "Valor avaliado com acordo — 30d",
    "Excedente Acima 30d":                 "Excedente pago — 30d",
    "% Acima":                             "% acima — do valor avaliado",
    "% Abaixo":                            "% abaixo — do valor avaliado",
    "% Conforme":                          "% conforme — do valor avaliado",
    "Valor Total 30d":                     "Gasto total — 30d",
    "Valor Total 365d":                    "Gasto total — 365d",
    "Valor Sem Acordo 30d":                "Sem acordo — 30d",
    "Valor Sem Acordo 365d":               "Sem acordo — 365d",
    "Valor em Fuga 365d":                  "Fuga de contrato — 365d",
    "% da Fuga sobre o Sem Acordo 365d":   "% do sem acordo por fuga",
}


def faixa_cards(medidas, y=CARD_Y, fontes=None, destaque=None, larg=None):
    """Cartoes em faixa. Sem larg=, dividem a largura da pagina.

    Com dois cartoes a divisao dava 636px para um numero de oito caracteres --
    o print mostrava dois retangulos quase vazios. larg= fixa a largura e os
    encosta na esquerda.
    """
    n = len(medidas); w = larg or (W - (n-1)*8) // n
    assert (n - 1) * 8 + n * w <= W, f"faixa de {n} cartoes de {w}px estoura {W}px"
    return [card(i*(w+8), y, w, CARD_H, m, fonte=(fontes or {}).get(m),
                 destaque=(m == destaque), rotulo=ROTULOS.get(m))
            for i, m in enumerate(medidas)]

FAIXA_H = 32


def faixa(y, conteudo, x=0, w=W):
    """Cabecalho fino de secao, sem fundo e sem borda."""
    return texto(x, y, w, FAIXA_H, conteudo, 9, negrito=False, cor=MUDO,
                 chapa=False)


MUDO = "#667085"


def pagina(nome, visuais, filtros=None):
    p = {"name": guid("pg/"+nome), "displayName": nome, "visualContainers": visuais}
    if filtros:
        p["filterConfig"] = filtros
    inter = interacoes(visuais)
    if inter:
        p["visualInteractions"] = inter
    return p

p1 = [texto(0, 0, 860, 44, "Supply Vision", 15),
      card(868, 0, 412, 44, "Atualizacao", fonte=10, sem_rotulo=True)]
p1 += faixa_cards(["Valor Total", "Valor Sem Acordo", "% Sem Acordo",
                   "Valor em Fuga 365d"], y=44, destaque="% Sem Acordo", larg=306)
p1 += [faixa(126, "Gasto por dimensão — desde 01/2025")]
p1 += [
    barras(0, 162, 380, 546, "Cidade", "Valor Total",
           "Top 20 cidades", tit_medida="Titulo VG Cidades",
           filtros=top_n("Cidade", 20), cor=NAVY),
    barras_empilhadas(388, 162, 442, 546, "Fornecedor",
                      ["Valor Dentro do Acordo", "Valor Sem Acordo"],
                      "Top 20 fornecedores", tit_medida="Titulo VG Fornecedores",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Fornecedor", 20),
                      apelidos=APELIDOS, total="Valor Total"),
    barras_empilhadas(838, 162, 442, 546, "Grupo Item",
                      ["Valor Dentro do Acordo", "Valor Sem Acordo"],
                      "Top 20 itens", tit_medida="Titulo VG Grupos de Item",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Grupo Item", 20),
                      apelidos=APELIDOS, total="Valor Total"),
]

p2 = [texto(0, 0, 860, 44, "Sem acordo", 15),
      card(868, 0, 412, 44, "Janela 30d", fonte=10, sem_rotulo=True)]
p2 += [faixa(44, "Situação atual — últimos 30 dias")]
p2 += faixa_cards(["Valor Sem Acordo 30d", "% Sem Acordo 30d"],
                  y=76, destaque="% Sem Acordo 30d", larg=460)
p2 += [faixa(162, "Diagnóstico histórico — 01/2025 em diante, meses fechados")]
FECHADO = lambda quem: filtro_coluna("Mes Fechado", quem)
p2 += [
    colunas_(0, 198, 836, 198, "Ano-Mes", "Valor Sem Acordo",
             "Evolução mensal do valor sem acordo", cat_asc=True,
             filtros=FECHADO("mensal")),
    barras(844, 198, 436, 198, "Motivo Sem Acordo", "Valor Sem Acordo",
           "Em qual dimensão faltou referência", filtros=FECHADO("motivo")),
    barras(844, 400, 436, 308, "Grupo Modelo", "Valor Sem Acordo",
           "Sem acordo por grupo de modelo", filtros=FECHADO("modelo")),
    barras(0, 400, 414, 308, "Fornecedor", "Valor Sem Acordo",
           "Top 20 fornecedores", tit_medida="Titulo SA Fornecedores",
           filtros=combinar(top_n("Fornecedor", 20), FECHADO("fornecedor"))),
    barras(422, 400, 414, 308, "Grupo Item", "Valor Sem Acordo",
           "Top 20 itens", tit_medida="Titulo SA Grupos de Item",
           filtros=combinar(top_n("Grupo Item", 20), FECHADO("grupoitem"))),
]

p3 = [texto(0, 0, 620, TOPO_H, "Fuga de contrato", 15),
      filtro(640, 0, 316, TOPO_H, "Fornecedor"),
      filtro(964, 0, 316, TOPO_H, "Grupo Item", "Grupo de item")]
p3 += faixa_cards(["Janela 365d", "Valor Total 365d", "Valor Sem Acordo 365d",
                   "Valor em Fuga 365d", "% da Fuga sobre o Sem Acordo 365d"],
                  fontes={"Janela 365d": 11},
                  destaque="% da Fuga sobre o Sem Acordo 365d")
p3 += [faixa(144, "Cartões e rankings: 365 dias corridos. Gráfico mensal: 12 "
                  "meses fechados — as colunas não somam ao cartão.")]
p3 += [
    colunas_(0, 180, 836, 212, "Ano-Mes", "Valor em Fuga",
             "Fuga de contrato por mês — 12 meses fechados", cat_asc=True,
             filtros=filtro_coluna("Ultimos 12 meses fechados")),
    barras(844, 180, 436, 528, "Cidade", "Valor em Fuga 365d",
           "Top 20 cidades", tit_medida="Titulo Fuga Cidades",
           filtros=top_n("Cidade", 20)),
    barras(0, 400, 414, 308, "Fornecedor", "Valor em Fuga 365d",
           "Top 20 fornecedores", tit_medida="Titulo Fuga Fornecedores",
           filtros=top_n("Fornecedor", 20)),
    barras(422, 400, 414, 308, "Grupo Item", "Valor em Fuga 365d",
           "Top 20 grupos de item", tit_medida="Titulo Fuga Grupos de Item",
           filtros=top_n("Grupo Item", 20)),
]

p4 = [texto(0, 0, 620, TOPO_H, "Conformidade de preço", 15),
      filtro(640, 0, 316, TOPO_H, "Fornecedor"),
      filtro(964, 0, 316, TOPO_H, "Grupo Item", "Grupo de item")]
p4 += faixa_cards(["Janela 30d", "Valor Total 30d", "Valor Dentro do Acordo 30d",
                   "% Acima", "Excedente Acima 30d"], fontes={"Janela 30d": 11},
                  destaque="Excedente Acima 30d")
p4 += [
    barras(0, 148, 420, 260, "Status", "Valor Dentro do Acordo",
           "Valor por conformidade de preço", cor=NAVY),
    barras(428, 148, 420, 260, "Fornecedor", "Excedente Acima 30d",
           "Excedente pago por fornecedor", filtros=top_n("Fornecedor", 20)),
    barras(856, 148, 424, 260, "Grupo Item", "Excedente Acima 30d",
           "Excedente pago por grupo de item", filtros=top_n("Grupo Item", 20)),
    tabela(0, 416, 1280, 292,
           ["OS", "Fornecedor", "Item", "Excedente Acima 30d", "Qtd",
            "Preco OS", "Preco Acordo", "Cidade"],
           "Compras acima do acordo — maiores excedentes",
           medidas=("Excedente Acima 30d",),
           filtros=filtro_medida_maior("Excedente Acima 30d", 0),
           ordem=("Excedente Acima 30d", True),
           apelidos={"Excedente Acima 30d": "Excedente R$",
                     "Preco OS": "Preço cobrado",
                     "Preco Acordo": "Preço acordado"}),
]

FILTROS_ESQ = ["Ano-Mes", "Cidade", "Fornecedor", "Grupo Modelo", "Modelo", "Criador"]
FILTROS_DIR = ["Grupo Item", "Item", "Status", "STATUS_ACORDO", "Tinha acordo?", "Motivo Sem Acordo"]
ROTULO_FILTRO = {"STATUS_ACORDO": "Dentro ou fora do acordo",
                 "Status": "Status do preço",
                 "Criador": "Criador da OS",
                 "Ano-Mes": "Ano-Mês",
                 "Tinha acordo?": "Tinha acordo disponível?",
                 "Motivo Sem Acordo": "Motivo de não ter acordo"}
p7 = [texto(0, 0, W, TOPO_H, "Detalhe", 13)]
for i, dim in enumerate(FILTROS_ESQ):
    p7.append(filtro(0, 60 + i*64, 206, 56, dim, ROTULO_FILTRO.get(dim)))
for i, dim in enumerate(FILTROS_DIR):
    p7.append(filtro(214, 60 + i*64, 206, 56, dim, ROTULO_FILTRO.get(dim)))
BOOKMARK_RESET = "2eaefe1f7ed0f9e80d18"
p7.append(botao_bookmark(0, 444, 420, 32, "Limpar filtros", BOOKMARK_RESET))
p7 += [tabela(428, 60, 852, 648,
              ["Data", "OS", "Fornecedor", "Item", "Excedente Acima 30d",
               "Qtd", "Preco OS", "Valor Total", "Preco Acordo Vigente",
               "Cidade", "Modelo", "Grupo Modelo", "Grupo Item", "Status",
               "STATUS_ACORDO", "Tinha acordo?", "Motivo Sem Acordo", "Criador"],
              "Linhas do painel — excedente e preço acordado só na janela de 30 dias",
              medidas=("Preco Acordo Vigente", "Excedente Acima 30d", "Valor Total"),
              ordem=("Excedente Acima 30d", True),
              apelidos={"Preco OS": "Preço OS", "Mes Nome": "Mês",
                        "Preco Acordo Vigente": "Preço acordo (30d)",
                        "Excedente Acima 30d": "Excedente R$ (30d)",
                        "STATUS_ACORDO": "Dentro ou fora do acordo",
                        "Status": "Status do preço",
                        "Criador": "Criador da OS",
                        "Tinha acordo?": "Tinha acordo disponível?",
                        "Motivo Sem Acordo": "Motivo de não ter acordo",
                        "Valor Total": "Valor pago"})]

paginas = [pagina("Visão Geral", p1),
           pagina("Sem acordo", p2),
           pagina("Fuga de contrato", p3),
           pagina("Conformidade de preço", p4, filtros=filtro_janela("Ultimos 30 dias")),
           pagina("Detalhe", p7)]

n_pg, n_vis = escrever("out/SupplyVisionPainel.Report/definition", paginas,
                       tema="LocFrotas_SupplyVision.json")
print("paginas:", n_pg, "| visuais:", n_vis)
