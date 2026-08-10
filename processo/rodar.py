"""
Motor de negócio do Supply Vision.

Carrega a base extraída do Qlik e a planilha de acordos, normaliza os dois
vocabulários, cruza por cidade + CNPJ + modelo + item e classifica cada linha.

Gera três planilhas — com acordo, sem acordo e pendências de referência — e um
CSV com a fila de qualidade da base de acordos.

Usado pelo pipeline diário e pelo recorte histórico: as duas frentes chamam
carregar_base, carregar_acordo, processar e gerar_* daqui, então classificam
identicamente.
"""
import json, os, re, sys, time, pathlib, pandas as pd, numpy as np, xlsxwriter
from datetime import datetime
from xlsxwriter.utility import xl_col_to_name
from zipfile import BadZipFile

# O console do Windows abre em cp1252, e as mensagens de progresso usam "→" e
# acentos. Executado pelo pipeline.py a codificação vinha ajustada por fora, mas
# rodar.py chamado direto (para depurar ou regerar à mão) morria com
# UnicodeEncodeError já no primeiro filtro. Cada script deve se bastar.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

import sv_paths
import contrato_base

# Parâmetros de universo — grupos, modelos, fornecedores, itens e sinônimos.
# Fonte única, compartilhada com o recorte histórico.
sys.path.insert(0, str(sv_paths.PARAMETROS_SRC))

from parametros import (FORNECEDORES_EXCLUIR, GRUPOS_EXCLUIR, ITENS_EXCLUIR,
                        MODELOS, MODELOS_EXCLUIR, SINONIMOS, normalizar)


# ═══════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO — caminhos centralizados em sv_paths.py
# ═══════════════════════════════════════════════════════════════════

BASE_PATH   = str(sv_paths.BASE_PATH)
ACORDO_PATH = str(sv_paths.ACORDO_PATH)
OUTPUT_DIR  = str(sv_paths.REPORTS)

# A ACORDOS.xlsx é editada à mão enquanto o pipeline roda: a cada salvamento
# há janelas curtas de bloqueio (PermissionError) ou de arquivo truncado
# (BadZipFile). O carregar_acordo tolera isso com retry; se o bloqueio
# persistir além da janela, falha alto (o pipeline marca erro e o watchdog
# avisa minutos depois).
ACORDO_TENTATIVAS  = 5
ACORDO_INTERVALO_S = 15

# Acima deste % de SEM ACORDO o pipeline alerta. Em operação normal o número
# fica na faixa de 60-70%; um salto brusco costuma ser parâmetro quebrado, não
# mudança de comportamento de compra.
LIMITE_ALERTA_SEM_ACORDO = 75.0

# Destino de sinônimo com menos linhas que isso no acordo é suspeito de ser
# variante de digitação, e não o nome canônico. Ver _validar_parametros().
MIN_LINHAS_DESTINO = 10

# Chave de correspondência entre a compra e o acordo.
CHAVE_ACORDO = ["_fornec_norm", "_cidade_norm", "_modelo_norm", "_peca_norm"]

# Dois estados em que existe acordo, mas ele não pode servir de referência.
# Ficam FORA dos indicadores de conformidade: comparar contra um preço que
# não se sabe se é o vigente produz não-conformidade inventada.
STATUS_AMBIGUO         = "ACORDO AMBÍGUO"
STATUS_PRECO_INVALIDO  = "ACORDO SEM PREÇO VÁLIDO"


# ═══════════════════════════════════════════════════════════════════
# LAYOUT — visual dos relatórios (cores, colunas, formatação)
# ═══════════════════════════════════════════════════════════════════

FONTE = "Arial"
BORDA = {"border": 1, "border_color": "#D9D9D9"}

HDR  = "#1F4E79"
BAND = {"A": "#4C5578",
        "B": "#52606E",
        "C": "#3F6B6B"}

CHIP = {"CONFORME":         "#C6EFCE",
        "ACIMA DO ACORDO":  "#FFC7CE",
        "ABAIXO DO ACORDO": "#BDD7EE",
        "SEM ACORDO":       "#FFE699"}
WASH = {"CONFORME":         "#EAF7EE",
        "ACIMA DO ACORDO":  "#FDEAEA",
        "ABAIXO DO ACORDO": "#EAF1FB",
        "SEM ACORDO":       "#F7F7F7"}

# Catálogo-mestre de colunas — ordem canônica
# (nome, largura, tipo, banda, oculta, quebra-de-texto)
COLUNAS = [
    ("Data",                       11, "date",  "B", False, False),
    ("OS",                         11, "int",   "B", False, False),
    ("Criador",                    18, "text",  "A", False, False),
    ("Cidade",                     15, "text",  "B", False, False),
    ("Fornecedor",                 26, "text",  "A", False, True ),
    ("Modelo",                     24, "text",  "A", False, True ),
    ("Item",                       42, "text",  "A", False, True ),
    ("Motivo Sem Acordo",          24, "text",  "C", False, False),
    ("Qtd",                         6, "qty",   "C", False, False),
    ("Preco OS",                   13, "money", "C", False, False),
    ("Preco Acordo",               14, "money", "C", False, False),
    ("Preco Total OS",             14, "money", "C", False, False),
    ("Preco Total Acordo",         16, "money", "C", False, False),
    ("Diferenca Unit.",            13, "money", "C", False, False),
    ("Diferenca Total",            15, "money", "C", False, False),
    ("Tinha acordo?",              12, "text",  "C", False, False),
    ("Menor Preco Acordo",         16, "money", "C", False, False),
    ("Fornecedor do Acordo",       26, "text",  "C", False, True ),
    ("Dif. p/ Menor Acordo",       18, "money", "C", False, False),
    ("Status",                     18, "text",  "B", False, False),
    ("CNPJ",                       16, "text",  None, True,  False),
]

SEMPRE_OCULTAR = {"Peca Acordo", "Grupo Despesa"}


# ═══════════════════════════════════════════════════════════════════
# LEITURA — carrega e filtra a base e a planilha de acordo
# ═══════════════════════════════════════════════════════════════════

# Forma canônica de comparação, a mesma usada na carga dos parâmetros. Duas
# implementações divergiriam com o tempo.
_norm = normalizar


def _normcnpj(t):
    if pd.isna(t): return ""
    d = re.sub(r"\D", "", str(t))
    return d.zfill(14) if d else ""

def _validar_colunas(df, obrigatorias, origem):
    """Falha ALTO e claro se a origem mudou de layout (coluna renomeada/removida).
    Sem isso, o erro seria um KeyError opaco no meio do processamento."""
    faltando = [c for c in obrigatorias if c not in df.columns]
    if faltando:
        print(f"ERRO: colunas obrigatórias ausentes em {origem}: {', '.join(faltando)}")
        print(f"      Colunas presentes: {', '.join(df.columns)}")
        print("      A origem mudou de layout? Conferir contrato_base.COLUNAS.")
        sys.exit(1)

def carregar_base(path):
    df = pd.read_excel(path, dtype=str).rename(columns=lambda c: c.strip())
    # As 11 do contrato, não um subconjunto. Coluna que some do Qlik precisa
    # parar o pipeline: se Grupo Despesa sumisse, o filtro de grupo — que hoje
    # tira ~13% da base — deixaria de rodar sem aviso, e o SEM ACORDO subiria
    # como se fosse comportamento do negócio.
    _validar_colunas(df, contrato_base.COLUNAS, "base.xlsx (Qlik)")
    df["_desc_norm"]   = df["Descrição"].apply(_norm)
    df["_cidade_norm"] = df["Forncedor por Cidade"].apply(_norm)
    df["_fornec_norm"] = df["Fornecedor CNPJ"].apply(_normcnpj)
    df["Valor Unitario"] = pd.to_numeric(df["Valor Unitario"], errors="coerce")

    def _filtra(df, mask, motivo):
        n0 = len(df); df = df[~mask].reset_index(drop=True)
        n = n0 - len(df)
        if n: print(f"  Filtro {motivo}: {n:,} linhas removidas ({n0:,} → {len(df):,})")
        return df

    df = _filtra(df, df["Grupo Despesa"].isin(GRUPOS_EXCLUIR),          "Grupo Despesa")
    df = _filtra(df, df["Modelo"].isin(MODELOS_EXCLUIR),                "Modelo excluído")
    df = _filtra(df, df["Fornecedor"].isin(FORNECEDORES_EXCLUIR),       "Fornecedor excluído")
    df = _filtra(df, df["_fornec_norm"] == "",                          "Sem CNPJ")
    df = _filtra(df, df["_desc_norm"].isin({_norm(i) for i in ITENS_EXCLUIR}), "Item excluído")
    df = _filtra(df, df["Valor Unitario"].isna() | (df["Valor Unitario"] == 0), "Sem valor")
    return df

def carregar_acordo(path):
    df = None
    for i in range(1, ACORDO_TENTATIVAS + 1):
        try:
            df = pd.read_excel(path, sheet_name="ACORDO", dtype=str)
            break
        except (OSError, BadZipFile) as e:
            if i == ACORDO_TENTATIVAS:
                print(f"ERRO: ACORDOS.xlsx inacessível após {ACORDO_TENTATIVAS} tentativas "
                      f"({type(e).__name__}: {e}).")
                print("      Causa típica: planilha aberta no Excel durante o salvamento.")
                raise
            print(f"AVISO: ACORDOS.xlsx indisponível ({type(e).__name__}) — "
                  f"tentativa {i}/{ACORDO_TENTATIVAS}; aguardando {ACORDO_INTERVALO_S}s...")
            time.sleep(ACORDO_INTERVALO_S)
    df.columns = df.columns.str.strip().str.upper()
    _validar_colunas(df, ["MODELO", "PECA_SERVICO", "CIDADE", "CNPJ",
                          "PRECO", "FORNECEDOR"], "ACORDOS.xlsx (aba ACORDO)")
    df["_modelo_norm"] = df["MODELO"].apply(_norm)
    df["_peca_norm"]   = df["PECA_SERVICO"].apply(_norm)
    df["_cidade_norm"] = df["CIDADE"].apply(_norm)
    df["_fornec_norm"] = df["CNPJ"].apply(_normcnpj)
    df["_preco_original"] = df["PRECO"]
    df["PRECO"]        = pd.to_numeric(df["PRECO"], errors="coerce").round(2)

    # Preço nulo, zero ou negativo não serve de referência. Marcar em vez de
    # descartar: a linha de acordo existe, e "existe acordo com preço
    # inutilizável" é situação diferente de "não existe acordo". Confundir as
    # duas mandava a compra para SEM ACORDO, escondendo um erro de cadastro
    # atrás de um número de não-conformidade.
    df["_preco_valido"] = np.isfinite(df["PRECO"]) & (df["PRECO"] > 0)
    n_inval = int((~df["_preco_valido"]).sum())
    if n_inval:
        print(f"AVISO: {n_inval} linha(s) da ACORDOS.xlsx com preço inválido "
              f"(nulo, zero ou negativo). As compras que casarem com elas saem "
              f"como '{STATUS_PRECO_INVALIDO}', não como sem acordo.")
    return df


# ═══════════════════════════════════════════════════════════════════
# PROCESSAMENTO — cruza base com acordo e calcula status/diferenças
# ═══════════════════════════════════════════════════════════════════

def _validar_parametros(df_acordo):
    """Guarda-corpo dos parâmetros de universo (SINONIMOS / MODELOS).

    O merge com o acordo é por igualdade exata de string. Se um DESTINO de
    sinônimo não existe na ACORDOS.xlsx, a linha nunca casa e cai em
    SEM ACORDO sem nenhum sinal — o percentual sobe e parece comportamento de
    compra.

    Duas checagens, ambas só avisam (não derrubam o pipeline):
      1) destino inexistente na ACORDOS.xlsx  -> sinônimo morto;
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
        print(f"AVISO: {len(mortos)} sinônimo(s) com destino inexistente na ACORDOS.xlsx "
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

    # Destino que EXISTE mas é variante rara, havendo um nome equivalente muito
    # mais comum. Não é inversão (a chave pode não existir no acordo), então a
    # checagem acima não pega. Foi o caso de 'REGULAGEM FREIO DE MAO' (3 linhas,
    # um fornecedor só) convivendo com 'REGULAGEM DE FREIO DE MAO' (314 linhas).
    #
    # Critério ESTRITO de equivalência: mesmo conjunto de palavras ignorando
    # "DE"/"DO"/"DA" e ordem. Uma primeira versão desta checagem usava
    # similaridade por difflib e acusava 10 casos, 8 deles falsos ('PINCA DE
    # FREIO TROCA' sugerindo 'DISCO DE FREIO TROCA', '0W30' sugerindo '5W30').
    # Aviso que erra mais do que acerta treina todo mundo a ignorar o log,
    # então aqui é melhor perder caso do que gerar ruído.
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


    # Chaves com preço divergente: qual acordo se aplica é indeterminado, e a
    # linha vai para quarentena — ver STATUS_AMBIGUO em processar().
    dup = (df_acordo[df_acordo["_preco_valido"]]
                    .groupby(CHAVE_ACORDO)["PRECO"]
                    .agg(["nunique", "min", "max"]))
    dup = dup[dup["nunique"] > 1]
    if len(dup):
        print(f"AVISO: {len(dup)} chave(s) do acordo com PREÇO DIVERGENTE — as "
              f"compras correspondentes saem como '{STATUS_AMBIGUO}' e ficam "
              f"fora dos indicadores; corrigir na ACORDOS.xlsx:")
        for (_, cid, mod, peca), r in dup.head(20).iterrows():
            print(f"       {cid} | {mod} | {peca}: R$ {r['min']:,.2f} vs R$ {r['max']:,.2f}")
        if len(dup) > 20:
            print(f"       (+{len(dup) - 20} não listadas)")

    if not (mortos or invertidos or raros or len(dup)):
        print("  Parâmetros de universo: sem inconsistências contra a ACORDOS.xlsx.")


MOTIVO_NAO_COMPARAVEL = "Item não comparável"
MOTIVO_FORNECEDOR     = "Fornecedor sem acordo"
MOTIVO_CIDADE         = "Cidade sem acordo"
MOTIVO_MODELO         = "Modelo sem acordo"
MOTIVO_ITEM_MAPEAR    = "Possível item a mapear"
MOTIVO_ITEM           = "Item sem acordo"

# Quarentena: há acordo, mas ele não serve de referência. Não são "sem
# acordo" — o problema está no cadastro, não na compra.
MOTIVO_AMBIGUO         = "Acordo ambíguo — preços divergentes"
MOTIVO_PRECO_INVALIDO  = "Acordo com preço inválido"

ORDEM_MOTIVOS = [MOTIVO_FORNECEDOR, MOTIVO_CIDADE, MOTIVO_MODELO,
                 MOTIVO_ITEM, MOTIVO_ITEM_MAPEAR, MOTIVO_NAO_COMPARAVEL,
                 MOTIVO_AMBIGUO, MOTIVO_PRECO_INVALIDO]


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


def processar(df_base, df_acordo):
    _validar_parametros(df_acordo)

    df = df_base.copy()
    df["_modelo_ac"]  = df["Modelo"].map(MODELOS).fillna(df["Modelo"]).apply(_norm)
    sin_map  = {k: v for k, v in SINONIMOS.items() if v is not None}
    sin_none = {k for k, v in SINONIMOS.items() if v is None}
    df["_peca_busca"] = df["_desc_norm"].map(sin_map).fillna(df["_desc_norm"]).apply(_norm)
    df["_sin_none"]   = df["_desc_norm"].isin(sin_none)

    # Só linhas com preço utilizável entram na correspondência. As demais
    # existem, e o efeito delas é tratado logo abaixo por chave.
    ac_valido = df_acordo[df_acordo["_preco_valido"]]

    # Chaves em quarentena, apuradas antes do merge:
    #   ambíguas          -> mais de um preço válido; não dá para saber qual vale
    #   sem preço válido  -> a chave existe no acordo, mas nenhum preço serve
    n_precos = ac_valido.groupby(CHAVE_ACORDO)["PRECO"].nunique()
    chaves_ambiguas = set(n_precos[n_precos > 1].index)
    chaves_com_preco = set(map(tuple, ac_valido[CHAVE_ACORDO].values))
    chaves_sem_preco = set(map(tuple, df_acordo[CHAVE_ACORDO].values)) - chaves_com_preco

    # Dedup determinístico pelo menor preço. Continua valendo para as chaves
    # NÃO ambíguas — nelas os preços são iguais, e o critério só evita que o
    # escolhido mude se a planilha for reordenada.
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

    po  = m["Valor Unitario"]
    pa  = m["PRECO"].where(~e_ambigua)     # ambígua não expõe preço de referência
    qtd = pd.to_numeric(m["OS Quantidade"], errors="coerce")

    quarentena = e_ambigua | e_sem_preco

    # "Sem valor" (preço vazio/zero) já foi filtrado em carregar_base —
    # todo po aqui é válido, então a classificação é binária: tem ou não acordo.
    com_ac = pa.notna() & ~quarentena
    sem_ac = ~com_ac & ~quarentena
    motivo = _motivo_sem_acordo(m, df_acordo, sem_ac)
    motivo[e_ambigua]   = MOTIVO_AMBIGUO
    motivo[e_sem_preco] = MOTIVO_PRECO_INVALIDO

    dif_unit  = pd.Series(np.nan, index=m.index)
    dif_unit[com_ac] = (po[com_ac] - pa[com_ac]).round(2)

    status = pd.Series("", index=m.index)
    status[sem_ac]                   = "SEM ACORDO"
    status[com_ac & (dif_unit == 0)] = "CONFORME"
    status[com_ac & (dif_unit  > 0)] = "ACIMA DO ACORDO"
    status[com_ac & (dif_unit  < 0)] = "ABAIXO DO ACORDO"
    status[e_ambigua]                = STATUS_AMBIGUO
    status[e_sem_preco]              = STATUS_PRECO_INVALIDO
    dif_unit[status == "CONFORME"]   = 0.0

    preco_total        = (po * qtd).round(2)
    preco_total_acordo = (pa * qtd).round(2)
    dif_total          = (preco_total - preco_total_acordo).round(2)
    dt                 = pd.to_datetime(m["Data Abertura"], dayfirst=True, errors="coerce")

    # Data e OS saem como valor, não como texto: o Excel precisa deles tipados
    # para ordenar, filtrar por período e somar corretamente.
    os_col = pd.to_numeric(m.get("Codigo OS", pd.Series("", index=m.index)),
                           errors="coerce")

    # ── Oportunidade de acordo (ignora o fornecedor usado): existe acordo para
    #    cidade + modelo + item com QUALQUER fornecedor? Usa o menor preço.
    # A referência alternativa só pode vir de uma chave completa confiável.
    # Se fornecedor+cidade+modelo+item é ambíguo, nenhum de seus preços prova
    # uma oportunidade válida, mesmo quando ignoramos o fornecedor da compra.
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
    preco_ref[m["_sin_none"]]  = np.nan          # item sem sinônimo válido → sem acordo possível
    fornec_ref[m["_sin_none"]] = np.nan
    preco_ref[quarentena] = np.nan
    fornec_ref[quarentena] = np.nan

    tinha_acordo     = pd.Series(np.where(preco_ref.notna(), "SIM", "NAO"), index=m.index)
    tinha_acordo[quarentena] = ""
    # Diferença contra o menor acordo disponível para a mesma cidade + modelo
    # + item. Pode ser negativa: a compra saiu abaixo da melhor referência.
    # Por isso a coluna não se chama "economia perdida" — nesse caso não houve
    # perda nenhuma, e o nome mentiria sobre o sinal.
    dif_referencia = (preco_total - preco_ref * qtd).round(2)
    dif_referencia[preco_ref.isna()] = np.nan

    return pd.DataFrame({
        "Grupo Despesa":      m.get("Grupo Despesa", ""),
        "Data":               dt.dt.date,
        "OS":                 os_col,
        "Criador":            m.get("Criado Por", ""),
        "Cidade":             m["Forncedor por Cidade"],
        "Fornecedor":         m["Fornecedor"],
        "Modelo":             m["Modelo"],
        "Item":               m["Descrição"],
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


STATUS_QUARENTENA = {STATUS_AMBIGUO, STATUS_PRECO_INVALIDO}


def resumir_status(df):
    """Retorna as métricas canônicas usadas por diário, panorama e e-mail."""
    total_bruto = len(df)
    contagens = {st: int((df["Status"] == st).sum()) for st in (
        "CONFORME", "ACIMA DO ACORDO", "ABAIXO DO ACORDO", "SEM ACORDO",
        STATUS_AMBIGUO, STATUS_PRECO_INVALIDO,
    )}
    total_quarentena = contagens[STATUS_AMBIGUO] + contagens[STATUS_PRECO_INVALIDO]
    total_elegivel = total_bruto - total_quarentena
    percentuais = {
        st: round(contagens[st] / total_elegivel * 100, 1) if total_elegivel else 0.0
        for st in ("CONFORME", "ACIMA DO ACORDO", "ABAIXO DO ACORDO", "SEM ACORDO")
    }
    motivos = {
        str(mot): int(qtd) for mot, qtd in
        df.loc[df["Status"] == "SEM ACORDO", "Motivo Sem Acordo"].value_counts().items()
    }
    pct_quarentena = round(total_quarentena / total_bruto * 100, 1) if total_bruto else 0.0
    return {
        "total_bruto": total_bruto,
        "total_elegivel": total_elegivel,
        "total_quarentena": total_quarentena,
        "contagens": contagens,
        "percentuais_elegiveis": percentuais,
        "percentual_quarentena_bruto": pct_quarentena,
        "motivos_sem_acordo": motivos,
        "alerta_sem_acordo": percentuais["SEM ACORDO"] > LIMITE_ALERTA_SEM_ACORDO,
        "limite_alerta_sem_acordo": LIMITE_ALERTA_SEM_ACORDO,
        "comparavel": total_elegivel > 0,
    }


def imprimir_resumo(resumo):
    print(f"  Total bruto: {resumo['total_bruto']:,} | Elegível: {resumo['total_elegivel']:,}")
    rotulos = (("Conformes", "CONFORME"), ("Acima", "ACIMA DO ACORDO"),
               ("Abaixo", "ABAIXO DO ACORDO"), ("Sem acordo", "SEM ACORDO"))
    for rotulo, status in rotulos:
        print(f"  {rotulo}: {resumo['contagens'][status]:,} "
              f"({resumo['percentuais_elegiveis'][status]}% dos elegíveis)")
    if not resumo["comparavel"]:
        print("  Nenhuma linha ficou comparável; todas as linhas estão em quarentena.")
    if resumo["total_quarentena"]:
        print(f"  Em quarentena: {resumo['total_quarentena']:,} "
              f"({resumo['percentual_quarentena_bruto']}% do total bruto)")
        for status in (STATUS_AMBIGUO, STATUS_PRECO_INVALIDO):
            if resumo["contagens"][status]:
                print(f"    {status:<26}{resumo['contagens'][status]:>7,}")
    if resumo["motivos_sem_acordo"]:
        print("  Motivo do SEM ACORDO:")
        total_sem = resumo["contagens"]["SEM ACORDO"]
        for motivo in ORDEM_MOTIVOS:
            n = resumo["motivos_sem_acordo"].get(motivo, 0)
            if n:
                print(f"    {motivo:<24}{n:>7,} ({n / total_sem * 100:.1f}% do sem acordo)")
    if resumo["alerta_sem_acordo"]:
        print(f"ALERTA: SEM ACORDO em {resumo['percentuais_elegiveis']['SEM ACORDO']:.1f}% "
              f"dos elegíveis, acima do limite de {resumo['limite_alerta_sem_acordo']:.1f}%.")
    print("RESUMO_JSON=" + json.dumps(resumo, ensure_ascii=False, separators=(",", ":")))


# ═══════════════════════════════════════════════════════════════════
# MOTOR DE ESCRITA — aba Resultado (sem linha de total)
# ═══════════════════════════════════════════════════════════════════

def _gerar_aba(wb, df, drop, nome_tabela):
    excluir  = set(drop) | SEMPRE_OCULTAR
    catalogo = {c[0]: c for c in COLUNAS}
    cols = [n for n, *_ in COLUNAS if n in df.columns and n not in excluir] + \
           [c for c in df.columns if c not in catalogo and c not in excluir]
    idx  = {c: i for i, c in enumerate(cols)}
    L    = {c: xl_col_to_name(i) for i, c in enumerate(cols)}
    nrow, ncol = len(df), len(cols)
    ws   = wb.add_worksheet("Relatório")

    def fmt(size=9, **kw):
        return wb.add_format({"font_name": FONTE, "font_size": size, **BORDA, **kw})
    def hdr(bg):
        return fmt(10, bold=True, font_color="white", bg_color=bg,
                   align="center", valign="vcenter", text_wrap=True)

    spec     = {n: c for n, c in catalogo.items() if n not in excluir}
    hdr_band = {b: hdr(bg) for b, bg in BAND.items()}
    hdr_def  = hdr(HDR)

    def fmt_corpo(name):
        s = spec.get(name, (name, 14, "text", None, False, False))
        p = {"valign": "top"}
        if   s[2] == "money": p |= {"num_format": "R$ #,##0.00", "align": "right"}
        elif s[2] == "qty":   p |= {"num_format": "#,##0",        "align": "center"}
        elif s[2] == "int":   p |= {"num_format": "0",            "align": "center"}
        elif s[2] == "date":  p |= {"num_format": "dd/mm/yyyy",   "align": "center"}
        if s[5]: p["text_wrap"] = True
        return fmt(**p)

    def fmt_hdr(name):
        s = spec.get(name)
        return hdr_band.get(s[3], hdr_def) if s else hdr_def

    col_fmt  = {c: fmt_corpo(c) for c in cols}
    chip_fmt = {st: fmt(bg_color=CHIP[st], bold=True, align="center", valign="vcenter") for st in CHIP}
    has_status = "Status" in idx

    for c in cols:
        s      = spec.get(c)
        width  = s[1] if s else 14
        hidden = bool(s[4]) if s else False
        ws.set_column(idx[c], idx[c], width, None, {"level": 1, "hidden": True} if hidden else {})
    ws.set_default_row(28); ws.set_row(0, 30)

    for r, row in enumerate(df.to_dict("records"), 1):
        st = row.get("Status") or "SEM ACORDO"
        for c in cols:
            v  = row.get(c, "")
            if pd.isna(v): v = ""
            f_ = chip_fmt.get(st, col_fmt[c]) if (has_status and c == "Status") else col_fmt[c]
            ws.write(r, idx[c], v, f_)

    if nrow:
        ws.add_table(0, 0, nrow, ncol - 1, {
            "name": nome_tabela, "style": "Table Style Light 1",
            "banded_rows": False, "header_row": True,
            "columns": [{"header": c, "header_format": fmt_hdr(c)} for c in cols],
        })

    if has_status:
        sc = idx["Status"]
        for st, bg in WASH.items():
            rule = {"type": "formula", "criteria": f'=${L["Status"]}2="{st}"',
                    "format": wb.add_format({"bg_color": bg})}
            if sc > 0:        ws.conditional_format(1, 0, nrow, sc-1, rule)
            if sc < ncol - 1: ws.conditional_format(1, sc+1, nrow, ncol-1, rule)

    red   = wb.add_format({"font_color": "#C00000", "bold": True})
    green = wb.add_format({"font_color": "#1E7B34"})
    for c in ("Diferenca Unit.", "Diferenca Total"):
        if c in idx:
            rng = (1, idx[c], nrow, idx[c])
            ws.conditional_format(*rng, {"type": "cell", "criteria": ">", "value": 0, "format": red})
            ws.conditional_format(*rng, {"type": "cell", "criteria": "<", "value": 0, "format": green})



# ═══════════════════════════════════════════════════════════════════
# RELATÓRIO: COM ACORDO
# ═══════════════════════════════════════════════════════════════════

STATUS_COM_ACORDO = {"CONFORME", "ACIMA DO ACORDO", "ABAIXO DO ACORDO"}

DROP_COM_ACORDO = {
    "Motivo Sem Acordo",     # sempre vazio quando há acordo
    "Tinha acordo?",
    "Menor Preco Acordo",
    "Fornecedor do Acordo",
    "Dif. p/ Menor Acordo",
}

def gerar_com_acordo(df, path):
    wb = xlsxwriter.Workbook(path)
    _gerar_aba(wb, df, drop=DROP_COM_ACORDO, nome_tabela="ComAcordo")
    wb.close()
    print(f"  Salvo: {path}")


# ═══════════════════════════════════════════════════════════════════
# RELATÓRIO: SEM ACORDO
# ═══════════════════════════════════════════════════════════════════

DROP_SEM_ACORDO = {
    "Status",
    "Preco Acordo",
    "Preco Total Acordo",
    "Diferenca Unit.",
    "Diferenca Total",
}

def gerar_sem_acordo(df, path):
    df = df.copy()
    if "Dif. p/ Menor Acordo" in df.columns:
        # Maior diferenca contra a referencia no topo; sem acordo possivel no fim
        df = df.sort_values("Dif. p/ Menor Acordo", ascending=False, na_position="last")
    wb = xlsxwriter.Workbook(path)
    _gerar_aba(wb, df, drop=DROP_SEM_ACORDO, nome_tabela="SemAcordo")
    wb.close()
    print(f"  Salvo: {path}")


DROP_PENDENCIAS = {
    "Tinha acordo?", "Menor Preco Acordo", "Fornecedor do Acordo",
    "Dif. p/ Menor Acordo", "Preco Acordo", "Preco Total Acordo",
    "Diferenca Unit.", "Diferenca Total",
}


def gerar_pendencias(df, path):
    wb = xlsxwriter.Workbook(path)
    _gerar_aba(wb, df, drop=DROP_PENDENCIAS, nome_tabela="PendenciasReferencia")
    wb.close()
    print(f"  Salvo: {path}")


def gerar_qualidade_acordos(df_acordo, path):
    """Gera fila operacional com todas as pendências da base de acordos."""
    validos = df_acordo[df_acordo["_preco_valido"]]
    stats = validos.groupby(CHAVE_ACORDO)["PRECO"].agg(["nunique", "min", "max"])
    ambiguas = set(stats[stats["nunique"] > 1].index)
    com_preco = set(map(tuple, validos[CHAVE_ACORDO].values))
    sem_preco = set(map(tuple, df_acordo[CHAVE_ACORDO].values)) - com_preco
    colunas = ["Tipo de pendência", "CNPJ normalizado", "Cidade", "Modelo",
               "Item", "Preço original", "Menor preço", "Maior preço", "Ocorrências"]
    linhas = []
    for chave, grupo in df_acordo.groupby(CHAVE_ACORDO, dropna=False):
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
    pd.DataFrame(linhas, columns=colunas).to_csv(
        path, sep=";", index=False, encoding="utf-8-sig"
    )
    print(f"  Salvo: {path}")


# ═══════════════════════════════════════════════════════════════════
# EXECUÇÃO — roda tudo
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("Carregando base...")
    df_base   = carregar_base(BASE_PATH)

    # Se os filtros zeraram a base, não há nada a reportar (Situação 2)
    if df_base.empty:
        print("AVISO: Nenhuma linha sobrou após os filtros.")
        print("RESULTADO=SEM_DADOS_FILTRO")
        sys.exit(0)

    df_acordo = carregar_acordo(ACORDO_PATH)
    print(f"  Base: {len(df_base):,} linhas | Acordo: {len(df_acordo):,} linhas")

    print("Processando...")
    df    = processar(df_base, df_acordo)
    resumo = resumir_status(df)
    imprimir_resumo(resumo)

    run_id = os.environ.get("SUPPLY_VISION_RUN_ID")
    stamp = run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    base  = pathlib.Path(OUTPUT_DIR)

    for nome, filtro, gerador in [
        ("COM ACORDO", df["Status"].isin(STATUS_COM_ACORDO),  gerar_com_acordo),
        ("SEM ACORDO", df["Status"] == "SEM ACORDO", gerar_sem_acordo),
        ("PENDENCIAS", df["Status"].isin(STATUS_QUARENTENA), gerar_pendencias),
    ]:
        dados = df[filtro].reset_index(drop=True)
        print(f"\nGerando {nome} ({len(dados):,} linhas)...")
        if dados.empty:
            print(f"  (nenhum dado — arquivo não gerado)")
            continue
        slug  = nome.lower().replace(" ", "_")
        pasta = base / slug
        pasta.mkdir(parents=True, exist_ok=True)
        nome_arquivo = slug + f"_{stamp}.xlsx"
        gerador(dados, str(pasta / nome_arquivo))
        print(f"RELATORIO_{slug.upper()}={pasta / nome_arquivo}")

    qualidade_dir = base / "qualidade_acordos"
    qualidade_dir.mkdir(parents=True, exist_ok=True)
    qualidade_path = qualidade_dir / f"qualidade_acordos_{stamp}.csv"
    gerar_qualidade_acordos(df_acordo, qualidade_path)
    print(f"RELATORIO_QUALIDADE_ACORDOS={qualidade_path}")

    print("\nConcluído.")
