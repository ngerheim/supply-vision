"""Datas civis e seleção dos acordos vigentes para a compra."""

import pandas as pd
import sv_paths


CORTE_VIGENCIA_ACORDOS = pd.Timestamp(sv_paths.CORTE_VIGENCIA_ACORDOS)



def _data_vigencia(valores):
    # ISO tem ano primeiro; dayfirst so se aplica ao formato brasileiro.
    texto = valores.astype("string").str.strip()
    # Vigencia usa a data civil informada, inclusive em ISO com fuso.
    # Deslocar para UTC poderia mudar o dia de abertura da compra.
    texto = texto.str.replace(r"(Z|[+-]\d{2}:?\d{2})$", "", regex=True)
    iso = texto.str.match(r"^\d{4}-\d{2}-\d{2}(?:$|[ T])", na=False)
    # Excel pode devolver datetime; ISO explicito impede trocar mes por dia.
    resultado = pd.to_datetime(texto.where(iso), format="ISO8601", errors="coerce")
    # Formato brasileiro aceita hora opcional (HH:MM ou HH:MM:SS) depois da data.
    br = texto.where(~iso).str.strip()
    brasileiro = pd.to_datetime(br, format="%d/%m/%Y", errors="coerce")
    for formato in ("%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S"):
        brasileiro = brasileiro.fillna(pd.to_datetime(br, format=formato, errors="coerce"))
    return resultado.fillna(brasileiro).dt.normalize()



def _preparar_vigencia(df_acordo):
    """Converte inicio, fim e situacao uma vez so; processar() usa o resultado
    para cada data de compra, em vez de reconverter as colunas a cada data."""
    inicio = _data_vigencia(df_acordo["INICIO_VIGENCIA"])
    inicio_preenchido = df_acordo["INICIO_VIGENCIA"].astype("string").str.strip().fillna("") != ""
    inicio_invalido = inicio_preenchido & inicio.isna()
    if inicio_invalido.any():
        print(f"AVISO: {int(inicio_invalido.sum())} condição(ões) com início de vigência ilegível; corrigir a data no Portal.")
    fim = _data_vigencia(df_acordo["FIM_VIGENCIA"])
    status = df_acordo["STATUS_ACORDO"].fillna("").astype(str).str.strip().str.lower()
    preenchido = df_acordo["FIM_VIGENCIA"].astype("string").str.strip().fillna("") != ""
    fim_invalido = preenchido & fim.isna()
    if fim_invalido.any():
        print(f"AVISO: {int(fim_invalido.sum())} condição(ões) com fim de vigência ilegível ficaram fora da comparação; corrigir a data no Portal.")
    status = status.where(~fim_invalido, "fim_invalido")
    return inicio, fim, status



def _acordos_vigentes_em(df_acordo, data_compra, vigencia=None):
    inicio, fim, status = vigencia if vigencia is not None else _preparar_vigencia(df_acordo)
    return df_acordo[(status == "active") & inicio.notna() & (inicio <= data_compra) &
                     (fim.isna() | (fim >= data_compra))]

