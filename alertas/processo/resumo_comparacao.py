"""Indicadores canônicos e sua saída estruturada para o pipeline."""

import json
from contrato_comparacao import (
    STATUS_AMBIGUO, STATUS_PRECO_INVALIDO, STATUS_DATA_INVALIDA,
    STATUS_DIMENSAO_PENDENTE, STATUS_QUANTIDADE_INVALIDA, STATUS_PRECO_COMPRA_INVALIDO,
    STATUS_QUARENTENA, ORDEM_MOTIVOS, LIMITE_ALERTA_SEM_ACORDO, LIMITE_ALERTA_PENDENCIAS,
)


def resumir_status(df):
    """Retorna as métricas canônicas usadas por diário, panorama e e-mail."""
    total_bruto = len(df)
    contagens = {st: int((df["Status"] == st).sum()) for st in (
        "CONFORME", "ACIMA DO ACORDO", "ABAIXO DO ACORDO", "SEM ACORDO",
        STATUS_AMBIGUO, STATUS_PRECO_INVALIDO, STATUS_DATA_INVALIDA, STATUS_DIMENSAO_PENDENTE, STATUS_QUANTIDADE_INVALIDA, STATUS_PRECO_COMPRA_INVALIDO,
    )}
    total_quarentena = sum(contagens[st] for st in STATUS_QUARENTENA)
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
        "alerta_pendencias": pct_quarentena > LIMITE_ALERTA_PENDENCIAS,
        "limite_alerta_pendencias": LIMITE_ALERTA_PENDENCIAS,
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
        for status in STATUS_QUARENTENA:
            if resumo["contagens"][status]:
                print(f"    {status:<26}{resumo['contagens'][status]:>7,}")
    if resumo["motivos_sem_acordo"]:
        print("  Motivo do SEM ACORDO:")
        total_sem = resumo["contagens"]["SEM ACORDO"]
        for motivo in ORDEM_MOTIVOS:
            n = resumo["motivos_sem_acordo"].get(motivo, 0)
            if n:
                print(f"    {motivo:<24}{n:>7,} ({n / total_sem * 100:.1f}% do sem acordo)")
    if resumo.get("alerta_pendencias"):
        print(f"ALERTA: {resumo['percentual_quarentena_bruto']:.1f}% das compras em pendência. Conferir os dados antes de confiar nos indicadores.")
    if resumo["alerta_sem_acordo"]:
        print(f"ALERTA: SEM ACORDO em {resumo['percentuais_elegiveis']['SEM ACORDO']:.1f}% "
              f"dos elegíveis, acima do limite de {resumo['limite_alerta_sem_acordo']:.1f}%.")
    print("RESUMO_JSON=" + json.dumps(resumo, ensure_ascii=False, separators=(",", ":")))

