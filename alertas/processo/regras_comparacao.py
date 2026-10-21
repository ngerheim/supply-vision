"""Cruzamento das compras, classificação e referências de preço."""

import numpy as np
import pandas as pd
from parametros import MODELOS, SINONIMOS, normalizar as _norm
from qualidade_acordos import _validar_parametros
from vigencia_acordos import (CORTE_VIGENCIA_ACORDOS, _data_vigencia,
                             _preparar_vigencia, _acordos_vigentes_em)
from contrato_comparacao import (
    CHAVE_ACORDO, STATUS_AMBIGUO, STATUS_PRECO_INVALIDO, STATUS_DATA_INVALIDA,
    STATUS_QUANTIDADE_INVALIDA, STATUS_PRECO_COMPRA_INVALIDO, STATUS_DIMENSAO_PENDENTE,
    MOTIVO_NAO_COMPARAVEL, MOTIVO_FORNECEDOR, MOTIVO_CIDADE, MOTIVO_MODELO,
    MOTIVO_ITEM_MAPEAR, MOTIVO_ITEM, MOTIVO_AMBIGUO, MOTIVO_PRECO_INVALIDO,
    MOTIVO_DATA_INVALIDA, MOTIVO_PRECO_COMPRA_INVALIDO, MOTIVO_QUANTIDADE_INVALIDA,
)


def _motivo_sem_acordo(m, df_acordo, sem_ac):
    """Diz por que cada linha caiu em SEM ACORDO.

    O cruzamento é por CNPJ + cidade + modelo + item, tudo por igualdade
    exata. Quando não casa, "SEM ACORDO" sozinho não distingue duas coisas
    muito diferentes: fornecedor que de fato não tem acordo (retrato da
    carteira, nada a fazer no sistema) e nome fora do padrão (falha nossa de
    de-para, recuperável). Esta coluna separa os dois.

    A ordem é hierárquica e para no primeiro motivo que se aplica, do mais
    fundamental para o mais específico: se o fornecedor não tem acordo nenhum,
    não importa que o nome do item também esteja fora do padrão — arrumar o
    nome não resolveria nada.

    Distinção que mais importa na prática:
      - "Possível item a mapear": fornecedor, cidade e modelo casam, e o
        nome procurado não existe em nenhum acordo da planilha. Indício de
        sinônimo faltando, não prova: pode também não haver equivalente.
        Vai para a fila de revisão do de-para.
      - "Item sem acordo": o nome existe em outros acordos, mas não no acordo
        deste fornecedor. Não é erro de sistema, é cobertura de acordo —
        decisão comercial de negociar o item ou aceitar como fora de acordo.
    """
    set_forn = set(df_acordo["_fornec_norm"])
    set_fc   = set(zip(df_acordo["_fornec_norm"], df_acordo["_cidade_norm"]))
    set_fcm  = set(zip(df_acordo["_fornec_norm"], df_acordo["_cidade_norm"],
                       df_acordo["_modelo_norm"]))
    set_peca = set(df_acordo["_peca_norm"])

    motivos = []
    for tem_acordo, nao_comp, forn, cid, mod, peca in zip(
            ~sem_ac, m["_sin_none"], m["_fornec_norm"], m["_cidade_norm"],
            m["_modelo_ac"], m["_peca_busca"]):
        if tem_acordo:                          motivos.append("")
        elif nao_comp:                          motivos.append(MOTIVO_NAO_COMPARAVEL)
        elif forn not in set_forn:              motivos.append(MOTIVO_FORNECEDOR)
        elif (forn, cid) not in set_fc:         motivos.append(MOTIVO_CIDADE)
        elif (forn, cid, mod) not in set_fcm:   motivos.append(MOTIVO_MODELO)
        elif peca not in set_peca:              motivos.append(MOTIVO_ITEM_MAPEAR)
        else:                                   motivos.append(MOTIVO_ITEM)
    return pd.Series(motivos, index=m.index)



_UF_NOMES = dict(zip(
    "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(),
    "ACRE|ALAGOAS|AMAPA|AMAZONAS|BAHIA|CEARA|DISTRITO FEDERAL|ESPIRITO SANTO|GOIAS|MARANHAO|MATO GROSSO|MATO GROSSO DO SUL|MINAS GERAIS|PARA|PARAIBA|PARANA|PERNAMBUCO|PIAUI|RIO DE JANEIRO|RIO GRANDE DO NORTE|RIO GRANDE DO SUL|RONDONIA|RORAIMA|SANTA CATARINA|SAO PAULO|SERGIPE|TOCANTINS".split("|")))
_UF_POR_NOME = {nome: sigla for sigla, nome in _UF_NOMES.items()}



def _uf(valor):
    if pd.isna(valor):
        return ""
    texto = _norm(valor)
    sigla = _UF_POR_NOME.get(texto, texto)
    return sigla if sigla in _UF_NOMES else ""



def _processar_periodo(df_base, df_acordo):
    # Regra da operacao: medida nao participa da comparacao nem da referencia.
    if "UF" not in df_acordo.columns or df_base.empty:
        return _processar_periodo_compativel(df_base, df_acordo)
    if not {"Fornecedor por Estado", "UF"}.intersection(df_base.columns):
        raise ValueError("Base do Qlik sem coluna de UF (Fornecedor por Estado ou UF), obrigatória para comparar acordos por estado.")
    base = df_base.copy()
    valores = base.get("Fornecedor por Estado", base.get("UF", pd.Series("", index=base.index)))
    base["_comparacao_uf"] = valores.apply(_uf)
    ufs_acordo = df_acordo["UF"].apply(_uf)
    partes = []
    for uf, grupo in base.groupby("_comparacao_uf", sort=False):
        universo = df_acordo[ufs_acordo == uf] if uf else df_acordo.iloc[:0]
        resultado = _processar_periodo_compativel(grupo, universo)
        resultado.index = grupo.index
        if not uf:
            mascara = resultado["Status"] != STATUS_DATA_INVALIDA
            resultado.loc[mascara, "Status"] = STATUS_DIMENSAO_PENDENTE
            resultado.loc[mascara, "Motivo Sem Acordo"] = "Informe uma UF válida da compra para comparar preços"
            resultado.loc[mascara, ["Preco Acordo", "Preco Total Acordo", "Diferenca Unit.", "Diferenca Total", "Menor Preco Acordo", "Dif. p/ Menor Acordo"]] = np.nan
            resultado.loc[mascara, ["Tinha acordo?", "Fornecedor do Acordo"]] = ""
        resultado["UF"] = uf
        partes.append(resultado)
    return pd.concat(partes).reindex(df_base.index)



def _processar_periodo_compativel(df_base, df_acordo):
    df = df_base.copy()
    df["_modelo_ac"]  = df["Modelo"].apply(_norm).map(MODELOS).fillna(df["Modelo"]).apply(_norm)
    sin_map  = {k: v for k, v in SINONIMOS.items() if v is not None}
    sin_none = {k for k, v in SINONIMOS.items() if v is None}
    df["_peca_busca"] = df["_desc_norm"].map(sin_map).fillna(df["_desc_norm"]).apply(_norm)
    df["_sin_none"]   = df["_desc_norm"].isin(sin_none)

    ac_valido = df_acordo[df_acordo["_preco_valido"]]

    n_precos = ac_valido.groupby(CHAVE_ACORDO)["PRECO"].nunique()
    chaves_ambiguas = set(n_precos[n_precos > 1].index)
    chaves_com_preco = set(map(tuple, ac_valido[CHAVE_ACORDO].values))
    chaves_sem_preco = set(map(tuple, df_acordo[CHAVE_ACORDO].values)) - chaves_com_preco

    ac = (ac_valido.sort_values("PRECO")
                   .drop_duplicates(subset=CHAVE_ACORDO, keep="first"))

    m  = df.merge(
        ac[CHAVE_ACORDO + ["PECA_SERVICO", "PRECO"]],
        left_on=["_fornec_norm","_cidade_norm","_modelo_ac","_peca_busca"],
        right_on=CHAVE_ACORDO,
        how="left", suffixes=("","_ac"))
    m.loc[m["_sin_none"], ["PRECO","PECA_SERVICO"]] = [np.nan, ""]

    chave_linha = list(zip(m["_fornec_norm"], m["_cidade_norm"],
                           m["_modelo_ac"], m["_peca_busca"]))
    e_ambigua   = pd.Series([c in chaves_ambiguas for c in chave_linha], index=m.index)
    e_sem_preco = pd.Series([c in chaves_sem_preco for c in chave_linha], index=m.index)
    e_ambigua   &= ~m["_sin_none"]
    e_sem_preco &= ~m["_sin_none"]
    # Sem data de abertura valida nao ha como saber qual regra de vigencia vale
    # para a compra. Ela vai para a quarentena, contada no resumo, em vez de
    # ser comparada como se fosse anterior ao corte.
    e_data_invalida = _data_vigencia(m["Data Abertura"]).isna()
    if e_ambigua.any():
        print(f"AVISO: {int(e_ambigua.sum())} compra(s) com acordo ambíguo; antes do corte a comparação usa todos os preços ativos, sem reconstruir vigência histórica.")
    e_ambigua   &= ~e_data_invalida
    e_sem_preco &= ~e_data_invalida

    po = pd.to_numeric(m["Valor Unitario"], errors="coerce")
    e_preco_compra_invalido = ~np.isfinite(po) | (po < 0)
    po = po.where(~e_preco_compra_invalido)
    qtd = pd.to_numeric(m["OS Quantidade"], errors="coerce")
    e_quantidade_invalida = (~np.isfinite(qtd) | (qtd <= 0))
    qtd = qtd.where(~e_quantidade_invalida)

    quarentena = e_ambigua | e_sem_preco | e_data_invalida | e_quantidade_invalida | e_preco_compra_invalido
    pa = m["PRECO"].where(~quarentena)

    com_ac = pa.notna() & ~quarentena
    sem_ac = ~com_ac & ~quarentena
    motivo = _motivo_sem_acordo(m, df_acordo, sem_ac)
    motivo[e_ambigua]   = MOTIVO_AMBIGUO
    motivo[e_sem_preco] = MOTIVO_PRECO_INVALIDO
    motivo[e_preco_compra_invalido] = MOTIVO_PRECO_COMPRA_INVALIDO
    motivo[e_quantidade_invalida] = MOTIVO_QUANTIDADE_INVALIDA
    motivo[e_data_invalida] = MOTIVO_DATA_INVALIDA

    dif_unit  = pd.Series(np.nan, index=m.index)
    dif_unit[com_ac] = (po[com_ac] - pa[com_ac]).round(2)

    status = pd.Series("", index=m.index)
    status[sem_ac]                   = "SEM ACORDO"
    status[com_ac & (dif_unit == 0)] = "CONFORME"
    status[com_ac & (dif_unit  > 0)] = "ACIMA DO ACORDO"
    status[com_ac & (dif_unit  < 0)] = "ABAIXO DO ACORDO"
    status[e_ambigua]                = STATUS_AMBIGUO
    status[e_sem_preco]              = STATUS_PRECO_INVALIDO
    status[e_preco_compra_invalido] = STATUS_PRECO_COMPRA_INVALIDO
    status[e_quantidade_invalida]     = STATUS_QUANTIDADE_INVALIDA
    status[e_data_invalida]          = STATUS_DATA_INVALIDA
    dif_unit[status == "CONFORME"]   = 0.0

    preco_total        = (po * qtd).round(2)
    preco_total_acordo = (pa * qtd).round(2)
    dif_total          = (preco_total - preco_total_acordo).round(2)
    dt                 = _data_vigencia(m["Data Abertura"])

    os_col = pd.to_numeric(m.get("Codigo OS", pd.Series("", index=m.index)),
                           errors="coerce")

    ac_ref = ac_valido[
        ~ac_valido[CHAVE_ACORDO].apply(tuple, axis=1).isin(chaves_ambiguas)
    ]
    ref = (ac_ref
                    .sort_values("PRECO")
                    .drop_duplicates(subset=["_cidade_norm","_modelo_norm","_peca_norm"], keep="first"))
    k_ref      = ref["_cidade_norm"] + "|" + ref["_modelo_norm"] + "|" + ref["_peca_norm"]
    preco_map  = dict(zip(k_ref, ref["PRECO"]))
    fornec_map = dict(zip(k_ref, ref["FORNECEDOR"]))
    k_base     = m["_cidade_norm"] + "|" + m["_modelo_ac"] + "|" + m["_peca_busca"]
    preco_ref  = k_base.map(preco_map)
    fornec_ref = k_base.map(fornec_map)
    preco_ref[m["_sin_none"]]  = np.nan
    fornec_ref[m["_sin_none"]] = np.nan
    preco_ref[quarentena] = np.nan
    fornec_ref[quarentena] = np.nan

    tinha_acordo     = pd.Series(np.where(preco_ref.notna(), "SIM", "NAO"), index=m.index)
    tinha_acordo[quarentena] = ""
    dif_referencia = (preco_total - preco_ref * qtd).round(2)
    dif_referencia[preco_ref.isna()] = np.nan

    modelos_exibicao = m["Modelo"].apply(_norm).map(MODELOS).fillna(m["Modelo"])
    itens_exibicao = m["_desc_norm"].map(SINONIMOS)
    itens_exibicao = itens_exibicao.where(itens_exibicao.notna(), m["Descrição"])

    return pd.DataFrame({
        "Grupo Despesa":      m.get("Grupo Despesa", ""),
        "Data":               dt.dt.date,
        "OS":                 os_col,
        "Criador":            m.get("Criado Por", ""),
        "Cidade":             m["Forncedor por Cidade"],
        "Fornecedor":         m["Fornecedor"],
        "Modelo":             modelos_exibicao,
        "Item":               itens_exibicao,
        "Motivo Sem Acordo":  motivo,
        "Qtd":                qtd,
        "Preco OS":           po,
        "Preco Acordo":       pa,
        "Preco Total OS":     preco_total,
        "Preco Total Acordo": preco_total_acordo,
        "Diferenca Unit.":    dif_unit,
        "Diferenca Total":    dif_total,
        "Status":             status,
        "CNPJ":               m["_fornec_norm"],
        "Peca Acordo":        m["PECA_SERVICO"].fillna(""),
        "Tinha acordo?":           tinha_acordo,
        "Menor Preco Acordo":      preco_ref,
        "Fornecedor do Acordo":    fornec_ref.fillna(""),
        "Dif. p/ Menor Acordo":    dif_referencia,
    })



def processar(df_base, df_acordo):
    """Cruza cada compra com o universo de acordos válido para sua data.

    Compras anteriores a CORTE_VIGENCIA_ACORDOS usam todos os acordos ativos da
    tabela atual, conforme a regra de transição. Da data de corte em diante,
    situação e intervalo de vigência passam a ser respeitados.
    """
    _validar_parametros(df_acordo)
    if df_base.empty:
        return _processar_periodo(df_base, df_acordo)
    campos_vigencia = {"INICIO_VIGENCIA", "FIM_VIGENCIA", "STATUS_ACORDO"}
    if not campos_vigencia.issubset(df_acordo.columns):
        return _processar_periodo(df_base, df_acordo)

    datas = _data_vigencia(df_base["Data Abertura"])
    partes = []
    # Compra sem data valida nao e "anterior ao corte": ela segue com a tabela
    # inteira so para passar pelo _processar_periodo, que a poe em quarentena.
    invalidas = datas.isna()
    anteriores = datas.notna() & (datas < CORTE_VIGENCIA_ACORDOS)
    vigencia = _preparar_vigencia(df_acordo)
    # Antes do corte vale a tabela atual inteira, mas só acordos ativos:
    # suspenso ou encerrado não pode servir de referência em data nenhuma.
    ativos = df_acordo[df_acordo["STATUS_ACORDO"].fillna("").astype(str).str.strip().str.lower() == "active"]
    grupos = [(anteriores | invalidas, ativos)]
    for data_compra in sorted(datas[~(anteriores | invalidas)].unique()):
        data_compra = pd.Timestamp(data_compra)
        grupos.append((datas == data_compra, _acordos_vigentes_em(df_acordo, data_compra, vigencia)))
    for mascara, universo in grupos:
        indices = df_base.index[mascara]
        if not len(indices):
            continue
        resultado = _processar_periodo(df_base.loc[indices], universo)
        resultado.index = indices
        partes.append(resultado)
    return pd.concat(partes).sort_index() if partes else _processar_periodo(df_base, df_acordo)

