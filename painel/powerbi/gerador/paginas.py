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
    "Valor Total 30d":                     "Gasto total — 30d",
    "Valor Total 365d":                    "Gasto total — 365d",
    "Valor Sem Acordo 30d":                "Sem acordo — 30d",
    "Valor Sem Acordo 365d":               "Sem acordo — 365d",
    "Valor em Fuga 365d":                  "Fuga de contrato — 365d",
    "% da Fuga sobre o Sem Acordo 365d":   "% do sem acordo que era fuga",
}


def faixa_cards(medidas, y=CARD_Y, fontes=None, destaque=None, larg=None):
    """Cartoes em faixa. Sem larg=, dividem a largura da pagina.

    Com dois cartoes a divisao dava 636px para um numero de oito caracteres --
    o print mostrava dois retangulos quase vazios. larg= fixa a largura e os
    encosta na esquerda.
    """
    # Sem larg=, dividem a largura da pagina exatamente. larg= fixo e para
    # faixas de dois ou tres cartoes, onde dividir a pagina deixa um retangulo
    # quase vazio. Com cinco cartoes, larg=254 somava 1302 e a quinta caixa saia
    # 22px fora da pagina -- medido em 13/08/2026 pela checagem geometrica.
    n = len(medidas); w = larg or (W - (n-1)*8) // n
    assert (n - 1) * 8 + n * w <= W, f"faixa de {n} cartoes de {w}px estoura {W}px"
    return [card(i*(w+8), y, w, CARD_H, m, fonte=(fontes or {}).get(m),
                 destaque=(m == destaque), rotulo=ROTULOS.get(m))
            for i, m in enumerate(medidas)]

# 18px cortava o texto de 9pt e 26px ainda deixava um indicador de rolagem
# cinza no canto da caixa. A caixa de texto do Power BI reserva padding proprio
# em cima e embaixo, entao a altura util fica bem abaixo da altura declarada.
FAIXA_H = 32


def faixa(y, conteudo, x=0, w=W):
    """Cabecalho fino de secao, sem fundo e sem borda."""
    return texto(x, y, w, FAIXA_H, conteudo, 9, negrito=False, cor=MUDO,
                 chapa=False)


# Mesmo motivo do tema: faixa() escreve em 9pt, e 3,06:1 nao serve para texto
# pequeno. CINZA acima continua #8A94A6 -- e cor de serie, area preenchida.
MUDO = "#667085"


def pagina(nome, visuais, filtros=None):
    p = {"name": guid("pg/"+nome), "displayName": nome, "visualContainers": visuais}
    if filtros:
        p["filterConfig"] = filtros
    inter = interacoes(visuais)
    if inter:
        p["visualInteractions"] = inter
    return p

# ═══ 1. Visao Geral ══════════════════════════════════════════════
# Sem segmentadores e sem serie temporal: a aba responde "onde esta o dinheiro",
# nao "como evoluiu". Os dois segmentadores no topo cortavam por Ano-Mes e
# STATUS_ACORDO uma pagina que existe para ser o retrato do total, e o cartao
# "% Acima 30d" trazia para ca um numero que e o assunto da aba de conformidade.
#
# Com o grafico mensal fora, os quatro rankings ficam com 560px de altura --
# 28px por barra no top 20, o dobro do que tinham.
# O cartao de frescor divide a linha do titulo. "Refresh concluido" e "dado
# atualizado" sao controles diferentes: se o pipeline falhar e o parquet anterior
# ficar no lugar, o Servico atualiza contra ele e o painel nao muda de aparencia.
# Sem esta linha a descoberta vem pela pessoa que decidiu com dado de tres
# semanas -- o mesmo modo de falha silencioso do gateway pessoal.
p1 = [texto(0, 0, 860, 40, "Supply Vision", 15),
      card(868, 0, 412, 40, "Atualizacao", fonte=10)]
# O cartao de fuga usa a medida de 365 dias, nao a historica. Mostrar R$ 2,6 mi
# de fuga no historico contradiz a propria regra do painel: sem vigencia no
# acordo, a fuga historica e justamente a leitura que a metodologia considera
# insegura. Na janela sao R$ 1,8 mi, e esse e o numero acionavel.
p1 += faixa_cards(["Valor Total", "Valor Sem Acordo", "% Sem Acordo",
                   "Valor em Fuga 365d"], y=44, destaque="% Sem Acordo", larg=306)
# Um subtitulo para os quatro rankings, em vez de repetir "(historico)" em cada
# titulo. Os titulos ficam curtos o suficiente para nao truncar em 314px.
# Subtitulo curto: o texto longo forcava quebra de linha dentro da faixa.
p1 += [faixa(126, "Gasto total por dimensão — histórico desde 01/2025")]
# Quatro colunas de 314px com a mesma altura. Antes, "grupos de item" tinha
# 340px para vinte barras e mostrava treze com barra de rolagem -- um top 20 que
# esconde sete nao e um top 20. Com o rotulo de dado fora, 314px de largura
# comportam mais texto de categoria do que os 414px comportavam com rotulo.
p1 += [
    barras(0, 162, 314, 546, "Cidade", "Valor Total",
           "Cidades — top 20", tit_medida="Titulo VG Cidades",
           filtros=top_n("Cidade", 20), cor=NAVY),
    # total= ranqueia pela ALTURA DA BARRA. Sem ele o top 20 saia por "Dentro do
    # Acordo" -- e nao era so a ordem: o VisualTopN usa a mesma ordenacao, entao
    # um fornecedor de R$ 500 mil integralmente SEM acordo podia ficar fora da
    # lista. Justo o fornecedor que esta pagina existe para expor, e o titulo
    # ainda declarava cobertura sobre o total.
    barras_empilhadas(322, 162, 314, 546, "Fornecedor",
                      ["Valor Dentro do Acordo", "Valor Sem Acordo"],
                      "Fornecedores — top 20", tit_medida="Titulo VG Fornecedores",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Fornecedor", 20),
                      apelidos=APELIDOS, total="Valor Total"),
    barras_empilhadas(644, 162, 314, 546, "Grupo Item",
                      ["Valor Dentro do Acordo", "Valor Sem Acordo"],
                      "Itens — top 20", tit_medida="Titulo VG Grupos de Item",
                      cores=CORES_DENTRO_FORA, filtros=top_n("Grupo Item", 20),
                      apelidos=APELIDOS, total="Valor Total"),
    # Oito grupos apos os filtros do Supply Vision, entao nao ha top N a aplicar
    # e a cobertura e 100% por construcao. A CONTAGEM, porem, vem da base: se um
    # nono grupo entrar, "todos os 8" passa a mentir sem nada quebrar.
    barras(966, 162, 314, 546, "Grupo Modelo", "Valor Total",
           "Grupos de modelo", tit_medida="Titulo VG Grupos de Modelo", cor=NAVY),
]

# ═══ 2. Fora do Acordo ═══════════════════════════════════════════
p2 = [texto(0, 0, W, 40, "Sem acordo", 15)]
# Cartoes na janela de 30 dias. Os do total historico sao identicos aos da
# Visao Geral -- dois cartoes repetindo numero nao informam nada. Em 30 dias
# passam a responder "e agora, esta melhorando?".
# A pagina mistura dois periodos de proposito: os cartoes dizem como esta agora,
# os graficos dizem a estrutura do problema no historico. Sem rotular as duas
# zonas, o leitor supoe que o grafico detalha o cartao -- e nao detalha.
#
# Os rotulos sao cabecalhos finos ACIMA de cada secao, nao caixas ao lado: na
# primeira tentativa eu os coloquei como visuais soltos, e o de diagnostico caiu
# sobre os cartoes (y=112 contra cartoes terminando em 140) enquanto o de
# situacao atual virou um cartao vazio flutuando a direita.
p2 += [faixa(40, "Situação atual — últimos 30 dias")]
p2 += faixa_cards(["Janela 30d", "Valor Sem Acordo 30d", "% Sem Acordo 30d"],
                  y=76, fontes={"Janela 30d": 11}, destaque="% Sem Acordo 30d",
                  larg=306)
p2 += [faixa(162, "Diagnóstico histórico — 01/2025 em diante, meses fechados")]
# "Meses fechados" era promessa do cabecalho e regra de UM visual so: apenas o
# grafico mensal filtrava Mes Fechado. Os outros quatro somavam o mes corrente --
# em 13/08/2026, doze dias de agosto dentro de um bloco anunciado como fechado.
# Nao da para resolver com filtro de PAGINA: os cartoes desta pagina sao de 30
# dias e a janela deles inclui o mes corrente de proposito. Um Mes Fechado de
# pagina se intersectaria com a janela dos cartoes e derrubaria justamente a
# leitura "e agora, esta melhorando?".
FECHADO = lambda quem: filtro_coluna("Mes Fechado", quem)
p2 += [
    colunas_(0, 198, 836, 198, "Ano-Mes", "Valor Sem Acordo",
             "Valor sem acordo por mês", cat_asc=True, filtros=FECHADO("mensal")),
    barras(844, 198, 436, 198, "Motivo Sem Acordo", "Valor Sem Acordo",
           "Em qual dimensão faltou referência", filtros=FECHADO("motivo")),
    barras(844, 400, 436, 308, "Grupo Modelo", "Valor Sem Acordo",
           "Sem acordo por grupo de modelo", filtros=FECHADO("modelo")),
    barras(0, 400, 414, 308, "Fornecedor", "Valor Sem Acordo",
           "Fornecedores — top 20", tit_medida="Titulo SA Fornecedores",
           filtros=combinar(top_n("Fornecedor", 20), FECHADO("fornecedor"))),
    barras(422, 400, 414, 308, "Grupo Item", "Valor Sem Acordo",
           "Itens — top 20", tit_medida="Titulo SA Grupos de Item",
           filtros=combinar(top_n("Grupo Item", 20), FECHADO("grupoitem"))),
]

# ═══ 3. Fuga de Contrato (365 dias) ══════════════════════════════
# Restrita a um ano deslizante: sem vigencia na ACORDOS.xlsx, uma compra de
# 2025 que hoje casa com um acordo pode nao ter tido acordo naquela data. Um
# ano limita o quanto o catalogo mudou entre a OS e a tabela atual.
# Na janela: R$ 1,77 mi em 10.986 linhas, e a fuga se concentra em 38 cidades.
p3 = [texto(0, 0, 620, TOPO_H, "Fuga de contrato", 15),
      filtro(640, 0, 316, TOPO_H, "Fornecedor"),
      filtro(964, 0, 316, TOPO_H, "Grupo Item", "Grupo de item")]
# O gasto total da janela entra ao lado da fuga: sem ele o leitor compara
# R$ 1,8 mi de fuga com os R$ 17,1 mi do historico e conclui 10%, quando dentro
# da janela e outro numero.
# Funil na ordem da decisao: gasto -> fora do acordo -> tinha acordo e nao foi
# usado -> que fracao do fora isso representa. O percentual antigo dividia pelo
# gasto total (16,2%), o que responde outra pergunta: sobre o fora sao 22,7%.
p3 += faixa_cards(["Janela 365d", "Valor Total 365d", "Valor Sem Acordo 365d",
                   "Valor em Fuga 365d", "% da Fuga sobre o Sem Acordo 365d"],
                  fontes={"Janela 365d": 11},
                  destaque="% da Fuga sobre o Sem Acordo 365d")
# Os cartoes cobrem 365 dias corridos; o grafico abaixo, 12 meses fechados. Sao
# recortes diferentes de proposito -- meia coluna nas pontas nao se le -- mas
# somar as doze colunas nao devolve o valor do cartao. Medido em 13/08/2026:
# R$ 1,78 mi em 365 dias contra R$ 1,73 mi em 12 meses fechados, 2,5% de
# diferenca. O aviso fica escrito porque a diferenca e pequena o suficiente para
# alguem achar que e erro de arredondamento, e nao e.
p3 += [faixa(144, "Cartões e rankings: 365 dias corridos (ver janela acima). "
                  "Gráfico abaixo: 12 meses fechados — recortes diferentes, as "
                  "colunas não somam ao cartão.")]
p3 += [
    # Doze meses fechados em vez de "tudo na janela de 365 dias": a janela
    # comeca no meio de agosto/2025 e termina no meio de agosto/2026, entao as
    # duas colunas das pontas apareciam pela metade e a serie parecia subir e
    # depois cair.
    colunas_(0, 180, 836, 212, "Ano-Mes", "Valor em Fuga",
             "Fuga de contrato por mês — 12 meses fechados", cat_asc=True,
             filtros=filtro_coluna("Ultimos 12 meses fechados")),
    # Medidas com janela embutida, nao a base [Valor em Fuga]: o filtro de pagina
    # de 365 dias saiu (ver a lista de paginas no fim do arquivo) e a janela
    # destes rankings passa a vir do DAX, como ja vinha nos cartoes.
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

# ═══ 4. Conformidade de Preco (30 dias) ══════════════════════════
# Segmentadores de pagina no lugar de campo arrastado para o painel de filtros.
# O painel abre em "Filtros neste visual": filtrar por ali move um visual so e
# deixa os cartoes parados no total. Nao e erro do leitor -- a pagina nao
# oferecia o caminho certo, entao o gesto natural caia no escopo errado.
p4 = [texto(0, 0, 620, TOPO_H, "Conformidade de preço", 15),
      filtro(640, 0, 316, TOPO_H, "Fornecedor"),
      filtro(964, 0, 316, TOPO_H, "Grupo Item", "Grupo de item")]
# "% Conforme" sai da faixa: e 100% menos acima menos abaixo, e o espaco vale
# mais para a base do calculo, que era o que faltava.
# "% Abaixo" sai da faixa. Preco abaixo do acordado ja foi classificado como
# ruido de catalogo, nao oportunidade -- nao ha o que cobrar de quem cobrou
# menos. O espaco vai para o excedente pago em reais, que e o numero que entra
# numa conversa com fornecedor.
p4 += faixa_cards(["Janela 30d", "Valor Total 30d", "Valor Dentro do Acordo 30d",
                   "% Acima", "Excedente Acima 30d"], fontes={"Janela 30d": 11},
                  destaque="Excedente Acima 30d")
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
    barras(0, 148, 420, 260, "Status", "Valor Dentro do Acordo",
           "Valor comprado por status do preço", cor=NAVY),
    # Excedente pago, nao valor comprado: sao numeros de ordem de grandeza
    # diferente e antes tinham nomes parecidos.
    barras(428, 148, 420, 260, "Fornecedor", "Excedente Acima 30d",
           "Excedente pago por fornecedor", filtros=top_n("Fornecedor", 20)),
    barras(856, 148, 424, 260, "Grupo Item", "Excedente Acima 30d",
           "Excedente pago por grupo de item", filtros=top_n("Grupo Item", 20)),
    # A prova da cobranca e preco cobrado x preco acordado x quantidade x
    # diferenca. Antes essas quatro colunas ficavam fora da area visivel, atras
    # de Cidade e Grupo Item, e a tabela abria ordenada por data -- comecava
    # pela linha mais antiga em vez da mais caras.
    # Diferenca imediatamente depois do item: e a coluna que decide se vale
    # abrir a conversa, e ficava atras de Qtd e dos dois precos. Data sai --
    # a pagina inteira e a janela de 30 dias, entao a data nao qualifica nada.
    # Tabela na largura inteira. Em 636px as sete colunas nao cabiam e preco
    # cobrado, preco acordado e diferenca ficavam atras da rolagem horizontal --
    # exatamente as tres que sustentam a cobranca.
    tabela(0, 416, 1280, 292,
           ["OS", "Fornecedor", "Item", "Excedente Acima 30d", "Qtd",
            "Preco OS", "Preco Acordo", "Cidade"],
           "Linhas acima do acordo, do maior excedente para o menor",
           medidas=("Excedente Acima 30d",),
           # Ordenar por excedente decrescente NAO filtra: OS, Fornecedor, Item e
           # Cidade tem valor em qualquer linha da janela, entao a linha aparecia
           # com o excedente em branco. A tabela mostrava toda a janela de 30 dias
           # sob um titulo que promete "linhas acima do acordo" -- quem contava
           # linhas contava linhas que nao estavam acima de acordo nenhum.
           filtros=filtro_medida_maior("Excedente Acima 30d", 0),
           ordem=("Excedente Acima 30d", True),
           apelidos={"Excedente Acima 30d": "Excedente R$",
                     "Preco OS": "Preço cobrado",
                     "Preco Acordo": "Preço acordado"}),
]

# ═══ 7. Detalhe ══════════════════════════════════════════════════
# Treze segmentadores em duas colunas. Com as abas de dimensao removidas, esta
# pagina virou o lugar de consulta pontual ("o fornecedor X cumpre acordo?").
FILTROS_ESQ = ["Ano", "Mes Nome", "Cidade", "Fornecedor", "Grupo Modelo", "Modelo", "Criador"]
FILTROS_DIR = ["Grupo Item", "Item", "Status", "STATUS_ACORDO", "Tinha acordo?", "Motivo Sem Acordo"]
# Nome tecnico de coluna nao e expressao de negocio.
ROTULO_FILTRO = {"STATUS_ACORDO": "Dentro ou fora do acordo",
                 "Status": "Status do preço",
                 "Criador": "Criador da OS",
                 "Mes Nome": "Mês",
                 "Tinha acordo?": "Tinha acordo disponível?",
                 "Motivo Sem Acordo": "Motivo de não ter acordo"}
# Em modo lista a caixa precisava de ~96px; o dropdown fecha em 56 e os treze
# passam a caber em duas colunas sem sobra vazia entre eles.
p7 = [texto(0, 0, W, TOPO_H, "Detalhe", 13)]
for i, dim in enumerate(FILTROS_ESQ):
    p7.append(filtro(0, 60 + i*64, 206, 56, dim, ROTULO_FILTRO.get(dim)))
for i, dim in enumerate(FILTROS_DIR):
    p7.append(filtro(214, 60 + i*64, 206, 56, dim, ROTULO_FILTRO.get(dim)))
# Colunas na ordem da decisao: quem, o que, quanto, e so depois a classificacao.
# Antes a tabela abria por data e as colunas de dinheiro ficavam atras de sete
# colunas de dimensao, fora da area visivel.
# Preco acordado e excedente vem por MEDIDA, nao por coluna: fora da janela de
# 30 dias elas retornam vazio. A linha de 2025 continua na tabela com data,
# fornecedor, item, quantidade e preco pago -- o que falta e a diferenca contra
# um catalogo de acordos que nao existia naquela data. Ordenando pelo excedente,
# o topo da tabela e necessariamente comparavel, em vez de ser a maior deriva de
# catalogo dos ultimos dezenove meses.
#
# A medida e a MESMA do cartao da Conformidade (Excedente Acima 30d), entao o
# total desta coluna reconcilia com aquele cartao. Uma versao anterior usava uma
# medida propria com gate por IF, e o total mostrava R$ 387.898,08 contra um
# cartao de R$ 13,9 mil.
p7 += [tabela(428, 60, 852, 648,
              ["Data", "OS", "Fornecedor", "Item", "Excedente Acima 30d",
               "Qtd", "Preco OS", "Preco Acordo Vigente", "Cidade", "Modelo",
               "Grupo Modelo", "Grupo Item", "Status", "STATUS_ACORDO",
               "Tinha acordo?", "Motivo Sem Acordo", "Criador"],
              "Linhas do painel — excedente e preço acordado só na janela de 30 dias",
              medidas=("Preco Acordo Vigente", "Excedente Acima 30d"),
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

# Nome da aba com acento: ele aparece na barra de abas e no link direto para a
# pagina. Trocar depois de publicar quebra o link daquela aba -- e agora ou nunca.
paginas = [pagina("Visão Geral", p1),
           pagina("Sem acordo", p2),
           # Sem filtro de pagina de 365 dias. Ele se combinava com o filtro de
           # visual "Ultimos 12 meses fechados" do grafico mensal -- filtro de
           # pagina e de visual se INTERSECTAM, nao se substituem. A janela de 365
           # dias comeca em 13/08/2025 e os 12 meses fechados comecam em
           # 01/08/2025: a intersecao cortava os doze primeiros dias de agosto de
           # 2025, e a primeira coluna do grafico aparecia baixa por recorte, nao
           # por gasto. Era tambem a razao pela qual conferir.py media 12 meses
           # fechados (R$ 1,73 mi) contra um grafico que mostrava outro numero.
           # Agora cada visual declara a sua janela: cartoes e rankings pelas
           # medidas 365d, grafico mensal pelo filtro de 12 meses fechados.
           pagina("Fuga de contrato", p3),
           pagina("Conformidade de preço", p4, filtros=filtro_janela("Ultimos 30 dias")),
           pagina("Detalhe", p7)]

n_pg, n_vis = escrever("out/SupplyVisionPainel.Report/definition", paginas)
print("paginas:", n_pg, "| visuais:", n_vis)
