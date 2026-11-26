"""Leitura e normalização da base Qlik e dos acordos do Portal."""

import json
import sys
import time
import urllib.error
import urllib.request
import numpy as np
import pandas as pd
import sv_paths
import contrato_base
import portal_conexao
from parametros import (FORNECEDORES_EXCLUIR, GRUPOS_EXCLUIR, ITENS_EXCLUIR,
                        MODELOS_EXCLUIR, normalizar as _norm)
from contrato_comparacao import STATUS_PRECO_INVALIDO, _normcnpj


BASE_PATH   = str(sv_paths.BASE_PATH)
PORTAL_URL = str(sv_paths.PORTAL_URL)
PORTAL_API_TOKEN = str(sv_paths.PORTAL_API_TOKEN)
ACORDO_TENTATIVAS  = 5
ACORDO_INTERVALO_S = 15



def _validar_colunas(df, obrigatorias, origem):
    """Falha ALTO e claro se a origem mudou de layout (coluna renomeada/removida).
    Sem isso, o erro seria um KeyError opaco no meio do processamento."""
    faltando = [c for c in obrigatorias if c not in df.columns]
    if faltando:
        print(f"ERRO: colunas obrigatórias ausentes em {origem}: {', '.join(faltando)}")
        print(f"      Colunas presentes: {', '.join(df.columns)}")
        print("      A origem mudou de layout? Conferir contrato_base.COLUNAS.")
        sys.exit(1)



# Filtros do Universo, na ordem em que valem: a linha leva o motivo do primeiro
# que a pega (o mesmo resultado de aplicar um depois do outro).
FILTROS_UNIVERSO = ("Grupo Despesa", "Modelo excluído", "Fornecedor excluído", "Sem CNPJ",
                    "Item excluído", "Sem valor")
# Base crua do último carregamento com o motivo de cada linha; o painel usa
# para o "Baixar base" sem ler o arquivo de novo.
ULTIMA_BASE_CRUA = None


def ler_base_crua(path):
    df = pd.read_excel(path, dtype=str).rename(columns=lambda c: c.strip())
    _validar_colunas(df, contrato_base.COLUNAS, "base.xlsx (Qlik)")
    df["_desc_norm"]   = df["Descrição"].apply(_norm)
    df["_cidade_norm"] = df["Forncedor por Cidade"].apply(_norm)
    df["_fornec_norm"] = df["Fornecedor CNPJ"].apply(_normcnpj)
    df["Valor Unitario"] = pd.to_numeric(df["Valor Unitario"], errors="coerce")
    return df


def motivos_universo(df):
    """Motivo de exclusão de cada linha ("" = entra no Universo)."""
    # Listas de exclusão comparadas na forma normalizada dos dois lados, como
    # ITENS: acento, caixa ou espaço a mais não podem deixar a linha passar.
    def _excluir(coluna, lista):
        alvo = {_norm(i) for i in lista} - {""}
        return df[coluna].apply(_norm).isin(alvo)

    mascaras = (
        _excluir("Grupo Despesa", GRUPOS_EXCLUIR),
        _excluir("Modelo", MODELOS_EXCLUIR),
        _excluir("Fornecedor", FORNECEDORES_EXCLUIR),
        df["_fornec_norm"] == "",
        df["_desc_norm"].isin({_norm(i) for i in ITENS_EXCLUIR}),
        df["Valor Unitario"] == 0,
    )
    motivo = pd.Series("", index=df.index, dtype=object)
    for nome, mascara in zip(FILTROS_UNIVERSO, mascaras):
        motivo[(motivo == "") & mascara.to_numpy()] = nome
    return motivo


def carregar_base(path):
    global ULTIMA_BASE_CRUA
    df = ler_base_crua(path)
    motivo = motivos_universo(df)
    restantes = len(df)
    for nome in FILTROS_UNIVERSO:
        n = int((motivo == nome).sum())
        if n:
            print(f"  Filtro {nome}: {n:,} linhas removidas ({restantes:,} → {restantes - n:,})")
            restantes -= n
    ULTIMA_BASE_CRUA = df.assign(_motivo_universo=motivo)
    return df[motivo == ""].reset_index(drop=True)



def _preparar_acordos(df):
    df = df.copy()
    df.columns = df.columns.str.strip().str.upper()
    _validar_colunas(df, ["MODELO", "PECA_SERVICO", "CIDADE", "CNPJ",
                          "PRECO", "FORNECEDOR"], "banco de acordos do Portal")
    df["_modelo_norm"] = df["MODELO"].apply(_norm)
    df["_peca_norm"]   = df["PECA_SERVICO"].apply(_norm)
    df["_cidade_norm"] = df["CIDADE"].apply(_norm)
    df["_fornec_norm"] = df["CNPJ"].apply(_normcnpj)
    df["_preco_original"] = df["PRECO"]
    precos = pd.to_numeric(df["PRECO"], errors="coerce")
    df["PRECO"] = precos.round(2)

    # Validar antes de arredondar: negativo subcentavo não pode virar cortesia.
    # O arredondamento também pode transbordar em valores extremos.
    df["_preco_valido"] = np.isfinite(precos) & (precos >= 0) & np.isfinite(df["PRECO"])
    n_inval = int((~df["_preco_valido"]).sum())
    if n_inval:
        print(f"AVISO: {n_inval} condição(ões) do Portal com preço inválido "
              f"(vazio, não numérico ou negativo). As compras que casarem com "
              f"elas saem como '{STATUS_PRECO_INVALIDO}', não como sem acordo.")
    return df



def carregar_acordos_portal(url=PORTAL_URL, token=PORTAL_API_TOKEN):
    """Obtém a tabela vigente diretamente do banco mantido pelo Portal."""
    if not url or not token:
        raise RuntimeError("PORTAL_URL e PORTAL_API_TOKEN precisam estar configurados para carregar os acordos")
    url = portal_conexao.endereco_interno(url, str(getattr(sv_paths, 'PORTAL_INTERNAL_URL', '')))
    endpoint = f"{url}/api/internal/agreements"
    ultimo_erro = None
    for tentativa in range(1, ACORDO_TENTATIVAS + 1):
        try:
            requisicao = urllib.request.Request(
                endpoint, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}
            )
            with portal_conexao.abrir(requisicao, timeout=60) as resposta:
                payload = json.loads(resposta.read().decode("utf-8"))
            df = pd.DataFrame(payload.get("agreements", []))
            if df.empty:
                raise RuntimeError("o Portal devolveu uma tabela de acordos vazia")
            df.columns = df.columns.str.strip().str.upper()
            _validar_colunas(df, ["MODELO", "PECA_SERVICO", "CIDADE", "CNPJ", "PRECO",
                                  "FORNECEDOR", "INICIO_VIGENCIA", "FIM_VIGENCIA", "STATUS_ACORDO"],
                             "banco de acordos do Portal")
            return _preparar_acordos(df)
        except (OSError, ValueError, KeyError, RuntimeError, urllib.error.URLError) as erro:
            ultimo_erro = erro
            if isinstance(erro, urllib.error.HTTPError) and not portal_conexao.repetir_http(erro.code):
                break
            if tentativa < ACORDO_TENTATIVAS:
                print(f"AVISO: banco de acordos do Portal indisponível — tentativa "
                      f"{tentativa}/{ACORDO_TENTATIVAS}; aguardando {ACORDO_INTERVALO_S}s...")
                time.sleep(ACORDO_INTERVALO_S)
    raise RuntimeError(f"não foi possível carregar os acordos do Portal: {ultimo_erro}") from ultimo_erro

