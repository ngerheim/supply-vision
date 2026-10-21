"""Validação dos parâmetros e pendências dos acordos por vigência."""

import heapq
import numpy as np
import pandas as pd
from parametros import SINONIMOS, normalizar as _norm
from contrato_comparacao import CHAVE_ACORDO, STATUS_AMBIGUO, STATUS_PRECO_INVALIDO
from vigencia_acordos import CORTE_VIGENCIA_ACORDOS, _preparar_vigencia


MIN_LINHAS_DESTINO = 10



def _validar_parametros(df_acordo):
    """Guarda-corpo dos sinônimos contra os acordos do Portal.

    O merge com o acordo é por igualdade exata de string. Se um DESTINO de
    sinônimo não existe nos acordos do Portal, a linha nunca casa e cai em
    SEM ACORDO sem nenhum sinal — o percentual sobe e parece comportamento de
    compra.

    As checagens só avisam (não derrubam o pipeline):
      1) destino inexistente no Portal -> sinônimo morto;
      2) chave mais frequente que o destino   -> sinônimo INVERTIDO, isto é,
         está reescrevendo o nome canônico (centenas de linhas de acordo) para
         uma variante rara. Pior que não ter sinônimo nenhum.
    """
    freq   = df_acordo["_peca_norm"].value_counts()
    pecas  = set(freq.index)
    mortos, invertidos = [], []

    for chave, destino in SINONIMOS.items():
        if destino is None:
            continue
        k, v = _norm(chave), _norm(destino)
        if v not in pecas:
            mortos.append((chave, destino))
        elif freq.get(k, 0) > freq.get(v, 0):
            invertidos.append((chave, freq.get(k, 0), destino, freq.get(v, 0)))

    if mortos:
        print(f"AVISO: {len(mortos)} sinônimo(s) com destino inexistente nos acordos do Portal "
              "(a linha nunca casará):")
        for chave, destino in sorted(mortos)[:20]:
            print(f"       {chave!r} -> {destino!r}")
        if len(mortos) > 20:
            print(f"       (+{len(mortos) - 20} não listados)")

    if invertidos:
        print(f"ALERTA: {len(invertidos)} sinônimo(s) INVERTIDO(s) — a chave é mais comum no "
              "acordo que o destino; provável sobrescrita do de_para/itens.csv:")
        for chave, nk, destino, nv in sorted(invertidos, key=lambda t: -t[1]):
            print(f"       {chave!r} ({nk} linhas) -> {destino!r} ({nv} linhas)")

    def _tokens(p):
        return frozenset(t for t in p.split() if t not in {"DE", "DO", "DA"})

    equivalentes = {}
    for peca in pecas:
        equivalentes.setdefault(_tokens(peca), []).append(peca)

    raros = []
    for chave, destino in SINONIMOS.items():
        if destino is None:
            continue
        v  = _norm(destino)
        nv = freq.get(v, 0)
        if not 0 < nv < MIN_LINHAS_DESTINO:
            continue
        for alvo in equivalentes.get(_tokens(v), []):
            if alvo != v and freq[alvo] >= nv * 10:
                raros.append((chave, destino, nv, alvo, freq[alvo]))

    if raros:
        print(f"AVISO: {len(raros)} sinônimo(s) apontando para variante RARA do nome, "
              "havendo nome equivalente muito mais comum no acordo:")
        for chave, destino, nv, alvo, na in sorted(raros, key=lambda t: -t[4]):
            print(f"       {chave!r} -> {destino!r} ({nv} linhas); usar {alvo!r} ({na} linhas)")


    _, _, dup, _ = _qualidade_por_vigencia(df_acordo)
    if len(dup):
        print(f"AVISO: {len(dup)} chave(s) do acordo com PREÇO DIVERGENTE — as "
              f"compras na sobreposição saem como '{STATUS_AMBIGUO}' e ficam "
              f"fora dos indicadores; corrigir no Portal:")
        for chave, r in dup.head(20).iterrows():
            _, cid, mod, peca = chave[:4]
            print(f"       {cid} | {mod} | {peca}: R$ {r['min']:,.2f} vs R$ {r['max']:,.2f}")
        if len(dup) > 20:
            print(f"       (+{len(dup) - 20} não listadas)")

    if not (mortos or invertidos or raros or len(dup)):
        print("  Parâmetros de universo: sem inconsistências contra os acordos do Portal.")



def _qualidade_por_vigencia(df_acordo):
    """Conflitos só existem quando preços diferentes podem valer no mesmo dia.

    A qualidade considera os intervalos ativos a partir do corte de vigência,
    inclusive históricos. A regra de transição anterior ao corte é preservada
    no processamento de compras, sem transformar sucessão de preços em erro.
    Entradas legadas sem campos de vigência mantêm o universo anterior.
    """
    chave_qualidade = CHAVE_ACORDO + [c for c in ["UF"] if c in df_acordo.columns]
    universo = df_acordo.copy()
    if {"INICIO_VIGENCIA", "FIM_VIGENCIA", "STATUS_ACORDO"}.issubset(universo.columns):
        inicio, fim, status = _preparar_vigencia(universo)
        aplicavel = (status == "active") & inicio.notna() & (fim.isna() | ((fim >= inicio) & (fim >= CORTE_VIGENCIA_ACORDOS)))
        universo = universo[aplicavel].copy()
        universo["_qualidade_inicio"] = inicio[aplicavel].clip(lower=CORTE_VIGENCIA_ACORDOS)
        universo["_qualidade_fim"] = fim[aplicavel].fillna(pd.Timestamp.max)
    else:
        universo["_qualidade_inicio"] = pd.Timestamp.min
        universo["_qualidade_fim"] = pd.Timestamp.max
    validos = universo[universo["_preco_valido"]]
    stats = validos.groupby(chave_qualidade)["PRECO"].agg(["nunique", "min", "max"])
    ambiguas = set()
    for chave, grupo in validos.groupby(chave_qualidade):
        ativos, precos_ativos = [], {}
        for _, linha in grupo.sort_values("_qualidade_inicio").iterrows():
            inicio, fim, preco = linha["_qualidade_inicio"].value, linha["_qualidade_fim"].value, linha["PRECO"]
            # Fim inclusivo: dois acordos que incluem o mesmo dia se sobrepõem.
            while ativos and ativos[0][0] < inicio:
                _, removido = heapq.heappop(ativos)
                precos_ativos[removido] -= 1
                if precos_ativos[removido] == 0:
                    del precos_ativos[removido]
            if precos_ativos and (len(precos_ativos) > 1 or preco not in precos_ativos):
                ambiguas.add(chave)
                break
            heapq.heappush(ativos, (fim, preco))
            precos_ativos[preco] = precos_ativos.get(preco, 0) + 1
    com_preco = set(map(tuple, validos[chave_qualidade].values))
    sem_preco = set(map(tuple, universo[chave_qualidade].values)) - com_preco
    conflitos = stats.loc[stats.index.isin(ambiguas)]
    return universo, chave_qualidade, conflitos, sem_preco



def gerar_qualidade_acordos(df_acordo, path):
    """Gera pendências dos acordos com a mesma semântica de vigência do motor."""
    universo, chave_qualidade, conflitos, sem_preco = _qualidade_por_vigencia(df_acordo)
    ambiguas = set(conflitos.index)
    colunas = ["Tipo de pendência", "CNPJ normalizado", "Cidade", "Modelo",
               "Item", "Preço original", "Menor preço", "Maior preço", "Ocorrências"]
    linhas = []
    for chave, grupo in universo.groupby(chave_qualidade, dropna=False):
        tipo = STATUS_AMBIGUO if chave in ambiguas else (
            STATUS_PRECO_INVALIDO if chave in sem_preco else "")
        if not tipo:
            continue
        precos = grupo.loc[grupo["_preco_valido"], "PRECO"]
        linhas.append({
            "Tipo de pendência": tipo, "CNPJ normalizado": chave[0],
            "Cidade": chave[1], "Modelo": chave[2], "Item": chave[3],
            "Preço original": " | ".join(map(str, grupo["_preco_original"].tolist())),
            "Menor preço": precos.min() if len(precos) else np.nan,
            "Maior preço": precos.max() if len(precos) else np.nan,
            "Ocorrências": len(grupo),
        })
    # CSV nao tem tipo de celula: impede executar texto externo como formula.
    for linha in linhas:
        for coluna, valor in linha.items():
            if isinstance(valor, str) and valor.lstrip().startswith(("=", "+", "-", "@")):
                linha[coluna] = "'" + valor
    pd.DataFrame(linhas, columns=colunas).to_csv(
        path, sep=";", index=False, encoding="utf-8-sig"
    )
    print(f"  Salvo: {path}")
    return len(linhas)

