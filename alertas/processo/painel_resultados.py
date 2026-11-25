"""Painel de resultados: pipeline paralelo de análise sobre o recorte histórico.

Roda ao lado do recorte atual, sem alterá-lo. Três camadas:
1. a base do recorte (linhas com e sem acordo), como sai de processar();
2. a limpeza: nenhuma linha é apagada, cada descarte ganha um motivo;
3. os indicadores, calculados só sobre as linhas mantidas.

O histórico de manutenção sempre traz erros de lançamento (unidade, preço,
duplicidade); por isso os indicadores usam medianas e a limpeza estatística.
"""
import os
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import xlsxwriter

import sv_paths
from contrato_comparacao import STATUS_COM_ACORDO, _normcnpj
from parametros import normalizar

FONTE = "Arial"
MOTIVO_COLUNA = "Motivo descarte"
MOTIVO_DESVIO = "Preço fora da faixa robusta do item (mediana ± 3,5 MAD)"
MOTIVO_DUPLICADA = "Linha duplicada na mesma OS"
MOTIVO_QUANTIDADE = "Quantidade atípica para o item"
ALERTA_COLUNA = "Alerta"
ALERTA_UNIDADE = "Preço ~2× ou ~½ da mediana: possível erro de unidade"
MIN_GRUPO = 10
LIMITE_Z = 3.5
MIN_REFERENCIA = 3
TOP_ITENS = 20
CORTE_VIGENCIA = pd.Timestamp(sv_paths.CORTE_VIGENCIA_ACORDOS)
CHAVE_ITEM = ["Item", "Modelo"]


# ── Camada 2: limpeza ─────────────────────────────────────────────────────

def preparar(df):
    """Linhas elegíveis do recorte com tipos garantidos para o cálculo."""
    elegiveis = STATUS_COM_ACORDO | {"SEM ACORDO"}
    dados = df[df["Status"].isin(elegiveis)].copy().reset_index(drop=True)
    dados["Com acordo"] = np.where(dados["Status"] == "SEM ACORDO", "NÃO", "SIM")
    dados["Data"] = pd.to_datetime(dados["Data"], dayfirst=True, errors="coerce")
    for coluna in ("Qtd", "Preco OS", "Preco Total OS", "Diferenca Total",
                   "Dif. p/ Menor Acordo", "Preco Acordo"):
        if coluna in dados.columns:
            dados[coluna] = pd.to_numeric(dados[coluna], errors="coerce")
    return dados


def _escala_robusta(serie):
    """MAD normalizado; com metade ou mais dos preços iguais, cai para o desvio
    médio absoluto (Iglewicz e Hoaglin), para não marcar qualquer diferença."""
    mediana = serie.median()
    mad = (serie - mediana).abs().median() * 1.4826
    if mad > 0:
        return mad
    return (serie - mediana).abs().mean() * 1.2533


def _referencia_por_grupo(base, coluna):
    """Mediana e escala por item, modelo e UF; sem compras suficientes na UF,
    usa item e modelo no país. Assim um preço normal de uma região não é
    descartado por destoar da média nacional."""
    def estatisticas(chave):
        grupo = base.groupby(chave)[coluna]
        return (grupo.transform("median"), grupo.transform(_escala_robusta),
                grupo.transform("size"))
    med_uf, esc_uf, n_uf = estatisticas(CHAVE_ITEM + ["UF"])
    med_br, esc_br, n_br = estatisticas(CHAVE_ITEM)
    usa_uf = n_uf >= MIN_GRUPO
    return (med_uf.where(usa_uf, med_br), esc_uf.where(usa_uf, esc_br),
            n_uf.where(usa_uf, n_br))


def limpar(dados):
    """Marca descartes sem apagar linhas; a primeira regra que pega vale.

    Mediana e MAD em vez de média e desvio padrão: os próprios erros inflam o
    desvio padrão e escondem outros erros; a mediana não se deixa levar."""
    dados = dados.copy()
    dados[MOTIVO_COLUNA] = ""
    dados[ALERTA_COLUNA] = ""
    chave = ["OS", "Fornecedor", "Item", "Preco OS", "Qtd"]
    duplicada = dados.duplicated(chave, keep="first")
    dados.loc[duplicada, MOTIVO_COLUNA] = MOTIVO_DUPLICADA

    base = dados[~duplicada]
    qtd = base.groupby(CHAVE_ITEM)["Qtd"]
    tamanho_qtd = qtd.transform("size")
    limite_qtd = pd.concat([qtd.transform("median") * 3, qtd.transform(lambda s: s.quantile(0.99))],
                           axis=1).max(axis=1)
    atipica = (tamanho_qtd >= MIN_GRUPO) & (base["Qtd"] > limite_qtd)
    dados.loc[atipica[atipica].index, MOTIVO_COLUNA] = MOTIVO_QUANTIDADE

    base = base[~atipica]
    mediana, escala, tamanho = _referencia_por_grupo(base, "Preco OS")
    z = (base["Preco OS"] - mediana).abs() / escala.where(escala > 0)
    fora = (tamanho >= MIN_GRUPO) & (z > LIMITE_Z)
    dados.loc[fora[fora].index, MOTIVO_COLUNA] = MOTIVO_DESVIO

    razao = base["Preco OS"] / mediana
    unidade = (tamanho >= MIN_GRUPO) & ~fora & (razao.between(1.85, 2.15) | razao.between(0.45, 0.55))
    dados.loc[unidade[unidade].index, ALERTA_COLUNA] = ALERTA_UNIDADE
    return dados


def mantidas(dados):
    return dados[dados[MOTIVO_COLUNA] == ""]


# ── Camada 3: indicadores ─────────────────────────────────────────────────

def desde_corte(df):
    """Indicadores que dependem de acordo só contam desde o controle de vigência:
    antes dele a carteira atual era aplicada retroativamente."""
    return df[df["Data"] >= CORTE_VIGENCIA]


def ultimos_12_meses(df):
    return df[df["Data"] > df["Data"].max() - pd.DateOffset(years=1)]


def _mes(serie):
    return serie.dt.to_period("M")


def _gasto(df):
    return float(df["Preco Total OS"].sum())


def indice_preco(limpo):
    """Cesta fixa (quantidade do período) a preço mediano do mês vs. do 1º ano."""
    if limpo.empty:
        return pd.DataFrame(columns=["Mês", "Índice", "Cobertura do gasto"])
    inicio = limpo["Data"].min()
    base_periodo = limpo[limpo["Data"] < inicio + pd.DateOffset(years=1)]
    base = base_periodo.groupby(CHAVE_ITEM)["Preco OS"].median().rename("base")
    pesos = limpo.groupby(CHAVE_ITEM)["Qtd"].sum().rename("q")
    linhas = []
    for mes, grupo in limpo.groupby(_mes(limpo["Data"])):
        atual = grupo.groupby(CHAVE_ITEM)["Preco OS"].median().rename("atual")
        cesta = pd.concat([atual, base, pesos], axis=1, join="inner").dropna()
        if cesta.empty:
            continue
        valor = (cesta["atual"] * cesta["q"]).sum() / (cesta["base"] * cesta["q"]).sum() * 100
        cobertos = grupo.set_index(CHAVE_ITEM).index.isin(cesta.index)
        linhas.append({"Mês": str(mes), "Índice": round(valor, 1),
                       "Cobertura do gasto": _gasto(grupo[cobertos]) / max(_gasto(grupo), 1)})
    return pd.DataFrame(linhas)


def medianas_top(limpo):
    """Mediana mensal dos itens de maior gasto (critério do diretor)."""
    top = limpo.groupby(CHAVE_ITEM)["Preco Total OS"].sum().nlargest(TOP_ITENS).index
    sel = limpo[limpo.set_index(CHAVE_ITEM).index.isin(top)]
    tabela = sel.pivot_table(index=CHAVE_ITEM, columns=_mes(sel["Data"]).astype(str),
                             values="Preco OS", aggfunc="median")
    if tabela.empty:
        return tabela.reset_index()
    primeiro = tabela.apply(lambda linha: linha.dropna().iloc[0], axis=1)
    ultimo = tabela.apply(lambda linha: linha.dropna().iloc[-1], axis=1)
    tabela["Variação 1º → último mês"] = ultimo / primeiro - 1
    tabela["Gasto no período"] = sel.groupby(CHAVE_ITEM)["Preco Total OS"].sum()
    return tabela.sort_values("Gasto no período", ascending=False).reset_index()


def custo_evitado(limpo):
    """Acordo vs. mercado sem acordo na mesma cidade, item, modelo e mês."""
    # Referência de mercado = todo o período desde o corte (não só o mês):
    # mês a mês sobram poucas compras sem acordo comparáveis por cidade.
    chave = CHAVE_ITEM + ["Cidade"]
    df = desde_corte(limpo)
    df = df.assign(_mes=_mes(df["Data"]))
    sem = df[df["Com acordo"] == "NÃO"].groupby(chave)["Preco OS"].agg(["median", "size"])
    sem = sem[sem["size"] >= MIN_REFERENCIA]["median"].rename("mercado")
    com = df[df["Com acordo"] == "SIM"].join(sem, on=chave, how="inner")
    com["Custo evitado"] = (com["mercado"] - com["Preco OS"]) * com["Qtd"]
    resumo = com.groupby("_mes").agg(**{
        "Gasto com acordo comparável": ("Preco Total OS", "sum"),
        "Custo evitado": ("Custo evitado", "sum"),
    }).reset_index().rename(columns={"_mes": "Mês"})
    resumo["Mês"] = resumo["Mês"].astype(str)
    resumo["% sobre o gasto comparável"] = resumo["Custo evitado"] / resumo["Gasto com acordo comparável"]
    return resumo


def acordos(limpo):
    """Cobertura e conformidade, só desde o controle de vigência."""
    df = desde_corte(limpo)
    linhas = []
    for mes, grupo in df.groupby(_mes(df["Data"])):
        com = grupo[grupo["Com acordo"] == "SIM"]
        acima = com[com["Status"] == "ACIMA DO ACORDO"]
        linhas.append({
            "Mês": str(mes),
            "Gasto total": _gasto(grupo),
            "% do gasto com acordo": _gasto(com) / max(_gasto(grupo), 1),
            "Conformidade (não acima)": 1 - len(acima) / max(len(com), 1),
            "Linhas acima do acordo": len(acima),
            "Valor pago acima do acordo": float(acima["Diferenca Total"].clip(lower=0).sum()),
        })
    return pd.DataFrame(linhas)


def direcionamento(limpo, coluna):
    """R$ pagos acima do menor acordo disponível, por cidade ou agendador."""
    limpo = desde_corte(limpo)
    fora = limpo[(limpo["Tinha acordo?"] == "SIM") & (limpo["Com acordo"] == "NÃO")]
    fora = fora.assign(_perda=fora["Dif. p/ Menor Acordo"].clip(lower=0))
    total = limpo.groupby(coluna)["Preco Total OS"].sum().rename("Gasto total")
    res = fora.groupby(coluna).agg(**{
        "Gasto fora do acordo disponível": ("Preco Total OS", "sum"),
        "Pago acima do menor acordo": ("_perda", "sum"),
        "OS": ("OS", "nunique"),
    }).join(total).sort_values("Pago acima do menor acordo", ascending=False)
    res["% acumulado da perda"] = res["Pago acima do menor acordo"].cumsum() / max(res["Pago acima do menor acordo"].sum(), 1)
    return res.reset_index()


def fornecedores_fora_da_curva(limpo):
    """Preço médio de cada fornecedor relativo à mediana do item na UF."""
    chave = CHAVE_ITEM + ["UF"]
    limpo = ultimos_12_meses(limpo)
    ref = limpo.groupby(chave)["Preco OS"].transform("median")
    df = limpo.assign(_razao=limpo["Preco OS"] / ref, _acima=limpo["Preco OS"] > ref * 1.3)
    res = df.groupby(["Fornecedor", "Cidade", "UF"]).agg(**{
        "Gasto": ("Preco Total OS", "sum"),
        "OS": ("OS", "nunique"),
        "Preço vs. mediana da UF": ("_razao", "median"),
        "Linhas 30% acima da UF": ("_acima", "sum"),
        "% com acordo": ("Com acordo", lambda s: (s == "SIM").mean()),
    })
    res = res[res["OS"] >= 5]
    return res.sort_values(["Preço vs. mediana da UF", "Gasto"], ascending=False).reset_index()


def itens_sem_acordo(limpo):
    """Itens de maior gasto sem nenhum acordo na cidade: falta de cobertura."""
    limpo = ultimos_12_meses(limpo)
    sem = limpo[limpo["Tinha acordo?"] == "NAO"]
    return (sem.groupby(CHAVE_ITEM).agg(**{
        "Gasto sem acordo na cidade": ("Preco Total OS", "sum"),
        "OS": ("OS", "nunique"),
        "Cidades": ("Cidade", "nunique"),
        "Mediana paga": ("Preco OS", "median"),
    }).sort_values("Gasto sem acordo na cidade", ascending=False).head(50).reset_index())


def volume(limpo):
    """Volume e mix: separa aumento de gasto por volume de aumento por preço."""
    linhas = []
    for mes, grupo in limpo.groupby(_mes(limpo["Data"])):
        os_n = grupo["OS"].nunique()
        linhas.append({"Mês": str(mes), "OS": os_n, "Gasto": _gasto(grupo),
                       "Custo por OS": _gasto(grupo) / max(os_n, 1),
                       "Itens por OS": len(grupo) / max(os_n, 1)})
    return pd.DataFrame(linhas)


def novos_fornecedores(limpo):
    """Fornecedores com a 1ª compra nos últimos 3 meses do recorte."""
    primeiro = limpo.groupby("Fornecedor")["Data"].min()
    if limpo["Data"].min() > limpo["Data"].max() - pd.DateOffset(months=6):
        return pd.DataFrame()
    novos = primeiro[primeiro > limpo["Data"].max() - pd.DateOffset(months=3)]
    sel = limpo[limpo["Fornecedor"].isin(novos.index)]
    res = sel.groupby(["Fornecedor", "Cidade", "UF"]).agg(**{
        "Primeira OS": ("Data", "min"), "Gasto": ("Preco Total OS", "sum"),
        "OS": ("OS", "nunique"),
        "% com acordo": ("Com acordo", lambda s: (s == "SIM").mean()),
    })
    return res.sort_values("Gasto", ascending=False).reset_index()


def saude_carteira(limpo, df_acordo):
    """Condições de acordo usadas nos últimos 12 meses do recorte."""
    if df_acordo is None or df_acordo.empty or "_fornec_norm" not in df_acordo.columns:
        return pd.DataFrame()
    fim = limpo["Data"].max()
    recente = limpo[(limpo["Data"] > fim - pd.DateOffset(years=1)) & (limpo["Com acordo"] == "SIM")]
    usadas = set(zip(recente["CNPJ"].map(_normcnpj),
                     recente["Cidade"].map(normalizar), recente["Modelo"].map(normalizar),
                     recente["Item"].map(normalizar)))
    ativos = df_acordo[df_acordo["STATUS_ACORDO"].fillna("").astype(str).str.lower() == "active"]
    chaves = set(zip(ativos["_fornec_norm"], ativos["_cidade_norm"], ativos["_modelo_norm"], ativos["_peca_norm"]))
    usadas_carteira = chaves & usadas
    return pd.DataFrame([
        {"Indicador": "Condições de acordo ativas", "Valor": len(chaves)},
        {"Indicador": "Usadas nos últimos 12 meses do recorte", "Valor": len(usadas_carteira)},
        {"Indicador": "% da carteira em uso", "Valor": len(usadas_carteira) / max(len(chaves), 1)},
    ])


def qualidade(dados, df_total):
    contagem = dados[MOTIVO_COLUNA].replace("", "Mantida").value_counts()
    linhas = [{"Situação": k, "Linhas": int(v),
               "Valor": _gasto(dados[dados[MOTIVO_COLUNA].replace("", "Mantida") == k])}
              for k, v in contagem.items()]
    alerta = mantidas(dados)[mantidas(dados)[ALERTA_COLUNA] != ""]
    if len(alerta):
        linhas.append({"Situação": f"Mantida com alerta: {ALERTA_UNIDADE}", "Linhas": len(alerta),
                       "Valor": _gasto(alerta)})
    fora = df_total[~df_total["Status"].isin(STATUS_COM_ACORDO | {"SEM ACORDO"})]
    for status, n in fora["Status"].value_counts().items():
        linhas.append({"Situação": f"Quarentena do motor: {status}", "Linhas": int(n), "Valor": np.nan})
    return pd.DataFrame(linhas)


def resumo(ind):
    """Os números do painel: último mês fechado, anterior e tendência de 3 meses."""
    def ponto(tabela, coluna, nome, formato):
        if tabela.empty or coluna not in tabela:
            return []
        serie = tabela.set_index("Mês")[coluna].dropna()
        if serie.empty:
            return []
        ult = serie.iloc[-1]
        ant = serie.iloc[-2] if len(serie) > 1 else np.nan
        tres = serie.iloc[-3:].mean()
        return [{"Instrumento": nome, "Último mês": serie.index[-1], "Valor": ult,
                 "Mês anterior": ant, "Média 3 meses": tres, "Formato": formato}]
    linhas = []
    linhas += ponto(ind["Índice de preço"], "Índice", "Índice de preço (1º ano = 100)", "num")
    linhas += ponto(ind["Acordos"], "% do gasto com acordo", "% do gasto com acordo", "pct")
    linhas += ponto(ind["Acordos"], "Conformidade (não acima)", "Conformidade", "pct")
    linhas += ponto(ind["Acordos"], "Valor pago acima do acordo", "Pago acima do acordo", "money")
    linhas += ponto(ind["Custo evitado"], "Custo evitado", "Custo evitado (acordo vs. mercado)", "money")
    linhas += ponto(ind["Volume"], "Custo por OS", "Custo por OS", "money")
    linhas += ponto(ind["Volume"], "OS", "Quantidade de OS", "num")
    return pd.DataFrame(linhas)


def calcular(df, df_acordo=None):
    dados = limpar(preparar(df))
    limpo = mantidas(dados)
    ind = {
        "Índice de preço": indice_preco(limpo),
        "Medianas top 20": medianas_top(limpo),
        "Custo evitado": custo_evitado(limpo),
        "Acordos": acordos(limpo),
        "Direcionamento cidade": direcionamento(limpo, "Cidade"),
        "Direcionamento agendador": direcionamento(limpo, "Criador"),
        "Fornecedores fora da curva": fornecedores_fora_da_curva(limpo),
        "Itens sem acordo": itens_sem_acordo(limpo),
        "Volume e mix": volume(limpo),
        "Novos fornecedores": novos_fornecedores(limpo),
        "Saúde da carteira": saude_carteira(limpo, df_acordo),
        "Qualidade dos dados": qualidade(dados, df),
    }
    ind["Volume"] = ind["Volume e mix"]
    ind["Resumo"] = resumo(ind)
    del ind["Volume"]
    return dados, ind


# ── Saída ──────────────────────────────────────────────────────────────────

NOTAS = {
    "Resumo": "Último mês do recorte pode estar incompleto. Indicadores de acordo contam desde o controle de vigência.",
    "Índice de preço": "Mesma cesta de itens (quantidade do período) a preço mediano do mês, dividido pelo preço mediano do 1º ano do recorte.",
    "Medianas top 20": "Mediana do preço unitário por mês dos 20 itens e modelos de maior gasto.",
    "Custo evitado": "Desde o controle de vigência. Para cada compra com acordo: (mediana das compras sem acordo na mesma cidade, item e modelo − preço pago) × quantidade. Só onde há 3+ compras sem acordo de referência. Negativo = acordo acima do mercado local.",
    "Acordos": "Desde o controle de vigência. Conformidade = linhas com acordo que não ficaram acima do preço acordado.",
    "Direcionamento cidade": "Desde o controle de vigência. Compras em oficina sem acordo onde havia acordo para o item na cidade; perda = diferença para o menor acordo.",
    "Direcionamento agendador": "Mesma conta, por quem abriu a OS.",
    "Fornecedores fora da curva": "Últimos 12 meses. Mediana do preço do fornecedor dividida pela mediana do item e modelo na UF. Só fornecedores com 5+ OS.",
    "Itens sem acordo": "Últimos 12 meses. Itens e modelos sem nenhum acordo na cidade da compra: falta de cobertura.",
    "Volume e mix": "Separa aumento de gasto por volume (OS, itens por OS) de aumento por preço.",
    "Novos fornecedores": "Primeira compra nos últimos 3 meses do recorte (recorte de pelo menos 6 meses).",
    "Saúde da carteira": "Condições de acordo ativas com ao menos uma compra casada nos últimos 12 meses do recorte.",
    "Qualidade dos dados": "Descartes da limpeza (duplicada, quantidade atípica, preço fora da faixa robusta por item, modelo e UF), alertas de possível erro de unidade (mantidos nas contas) e quarentena do motor.",
}
PERCENTUAIS = ("%", "Conformidade", "Cobertura", "Variação")
DINHEIRO = ("Gasto", "Valor", "Custo", "Pago", "Mediana", "Preço acordo")


def _formato_coluna(nome, formatos):
    if any(p in nome for p in PERCENTUAIS):
        return formatos["pct"]
    if nome.startswith("20") or any(p in nome for p in DINHEIRO):
        return formatos["money"]
    return formatos["text"]


def _escrever(wb, nome, tabela, formatos):
    ws = wb.add_worksheet(nome[:31])
    ws.write(0, 0, NOTAS.get(nome, ""), formatos["nota"])
    if tabela is None or tabela.empty:
        ws.write(2, 0, "Sem dados suficientes no período.", formatos["text"])
        return
    tabela = tabela.reset_index(drop=True)
    colunas = [str(c) for c in tabela.columns]
    for c, nome_col in enumerate(colunas):
        ws.write(2, c, nome_col, formatos["cab"])
        fmt = _formato_coluna(nome_col, formatos)
        largura = min(max(len(nome_col), 10) + 2, 45)
        ws.set_column(c, c, largura)
        for r, valor in enumerate(tabela.iloc[:, c].tolist(), 3):
            if isinstance(valor, float) and np.isnan(valor):
                continue
            if isinstance(valor, pd.Timestamp):
                ws.write_datetime(r, c, valor.to_pydatetime(), formatos["data"])
            elif isinstance(valor, (int, float, np.integer, np.floating)):
                ws.write_number(r, c, float(valor), fmt)
            else:
                ws.write(r, c, str(valor), formatos["text"])
    ws.freeze_panes(3, 0)


def _escrever_resumo(wb, tabela, formatos, periodo):
    ws = wb.add_worksheet("Resumo")
    ws.write(0, 0, f"Recorte {periodo}. " + NOTAS["Resumo"], formatos["nota"])
    cab = ["Instrumento", "Último mês", "Valor", "Mês anterior", "Média 3 meses"]
    for c, nome in enumerate(cab):
        ws.write(2, c, nome, formatos["cab"])
    ws.set_column(0, 0, 38)
    ws.set_column(1, 4, 16)
    for r, linha in enumerate(tabela.to_dict("records"), 3):
        fmt = formatos[linha["Formato"]]
        ws.write(r, 0, linha["Instrumento"], formatos["text"])
        ws.write(r, 1, linha["Último mês"], formatos["text"])
        for c, chave in enumerate(["Valor", "Mês anterior", "Média 3 meses"], 2):
            valor = linha[chave]
            if not (isinstance(valor, float) and np.isnan(valor)):
                ws.write_number(r, c, float(valor), fmt)


COLUNAS_BASE_POWERBI = [
    "Data", "OS", "Criador", "Cidade", "UF", "Fornecedor", "CNPJ", "Modelo", "Item", "Qtd",
    "Preco OS", "Preco Total OS", "Preco Acordo", "Diferenca Total", "Status", "Com acordo",
    "Tinha acordo?", "Dif. p/ Menor Acordo", "Fornecedor do Acordo", MOTIVO_COLUNA, ALERTA_COLUNA,
]


def _csv_atomico(tabela, destino):
    """Grava num temporário e troca de uma vez: o Power BI nunca lê meio arquivo."""
    temporario = destino.with_suffix(destino.suffix + ".tmp")
    tabela.to_csv(temporario, sep=";", decimal=".", index=False, encoding="utf-8-sig",
                  date_format="%Y-%m-%d")
    os.replace(temporario, destino)


def exportar_powerbi(dados, ind, inicio, pasta=None, inicio_minimo=None):
    """Base limpa e indicadores em CSV numa pasta fixa, para o Power BI.

    Só recorte que comece até o início mínimo atualiza a pasta: um recorte
    curto pedido no dia a dia não pode encolher o painel do diretor."""
    pasta = Path(pasta or sv_paths.POWERBI_DIR)
    inicio_minimo = inicio_minimo or sv_paths.POWERBI_INICIO
    if inicio is None or inicio > inicio_minimo:
        print(f"  Power BI: recorte começa depois de {inicio_minimo:%d/%m/%Y}; arquivos mantidos.")
        return None
    pasta.mkdir(parents=True, exist_ok=True)
    base = dados[[c for c in COLUNAS_BASE_POWERBI if c in dados.columns]].copy()
    base["Mantida"] = np.where(dados[MOTIVO_COLUNA] == "", "SIM", "NÃO")
    base["Desde controle de vigência"] = np.where(dados["Data"] >= CORTE_VIGENCIA, "SIM", "NÃO")
    _csv_atomico(base, pasta / "base_limpa.csv")
    nomes = {
        "Índice de preço": "indice_preco", "Custo evitado": "custo_evitado", "Acordos": "acordos_mensal",
        "Direcionamento cidade": "direcionamento_cidade", "Direcionamento agendador": "direcionamento_agendador",
        "Fornecedores fora da curva": "fornecedores_fora_curva", "Itens sem acordo": "itens_sem_acordo",
        "Volume e mix": "volume_mix", "Novos fornecedores": "novos_fornecedores",
        "Saúde da carteira": "saude_carteira", "Qualidade dos dados": "qualidade_dados",
    }
    for nome, arquivo in nomes.items():
        if nome in ind:
            _csv_atomico(ind[nome], pasta / f"{arquivo}.csv")
    top = ind.get("Medianas top 20")
    if top is not None and not top.empty:
        meses = [c for c in top.columns if str(c)[:2] == "20"]
        longo = top.melt(id_vars=CHAVE_ITEM, value_vars=meses, var_name="Mês", value_name="Mediana").dropna()
        _csv_atomico(longo, pasta / "medianas_top20.csv")
    datas = dados["Data"].dropna()
    meta = pd.DataFrame([
        {"Campo": "Início do recorte", "Valor": f"{datas.min():%Y-%m-%d}"},
        {"Campo": "Fim do recorte", "Valor": f"{datas.max():%Y-%m-%d}"},
        {"Campo": "Gerado em", "Valor": datetime.now().strftime("%Y-%m-%d %H:%M")},
        {"Campo": "Controle de vigência desde", "Valor": f"{CORTE_VIGENCIA:%Y-%m-%d}"},
        {"Campo": "Linhas na base", "Valor": str(len(dados))},
        {"Campo": "Linhas mantidas", "Valor": str(int((dados[MOTIVO_COLUNA] == "").sum()))},
    ] + [{"Campo": f"Método: {k}", "Valor": v} for k, v in NOTAS.items()])
    _csv_atomico(meta, pasta / "metadados.csv")
    print(f"  Power BI: arquivos atualizados em {pasta}")
    return pasta


def gerar_painel(df, path, df_acordo=None, inicio=None):
    """Gera o painel em Excel (e os CSV do Power BI); False se não houver linha elegível."""
    dados, ind = calcular(df, df_acordo)
    if dados.empty:
        return False
    if inicio is not None:
        try:
            exportar_powerbi(dados, ind, inicio)
        except Exception as erro:
            print(f"  AVISO: arquivos do Power BI não atualizados ({type(erro).__name__}: {erro}).")
    wb = xlsxwriter.Workbook(path, {"strings_to_formulas": False, "nan_inf_to_errors": True})
    base = {"font_name": FONTE, "font_size": 9}
    formatos = {
        "text": wb.add_format(base),
        "num": wb.add_format({**base, "num_format": "#,##0.0"}),
        "money": wb.add_format({**base, "num_format": "R$ #,##0.00"}),
        "pct": wb.add_format({**base, "num_format": "0.0%"}),
        "data": wb.add_format({**base, "num_format": "dd/mm/yyyy"}),
        "cab": wb.add_format({**base, "bold": True, "font_color": "#FFFFFF", "bg_color": "#041E42"}),
        "nota": wb.add_format({**base, "italic": True, "font_color": "#555555"}),
    }
    datas = dados["Data"].dropna()
    periodo = f"{datas.min():%d/%m/%Y} a {datas.max():%d/%m/%Y}" if len(datas) else "sem datas"
    _escrever_resumo(wb, ind.pop("Resumo"), formatos, periodo)
    for nome, tabela in ind.items():
        _escrever(wb, nome, tabela, formatos)
    colunas = ["Data", "OS", "Criador", "Cidade", "UF", "Fornecedor", "Modelo", "Item", "Qtd",
               "Preco OS", "Preco Total OS", "Com acordo", "Status", MOTIVO_COLUNA, ALERTA_COLUNA]
    _escrever(wb, "Base com limpeza", dados[[c for c in colunas if c in dados.columns]], formatos)
    wb.close()
    return True
