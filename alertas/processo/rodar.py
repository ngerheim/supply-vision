"""Entrada diária e API de compatibilidade do motor de comparação.

As etapas ficam nos módulos por assunto; o panorama continua importando
carregar_base, carregar_acordos_portal, processar e gerar_* daqui.
"""
import os
import sys
import pathlib
from datetime import datetime

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

import sv_paths

sys.path.insert(0, str(sv_paths.PARAMETROS_SRC))


from contrato_comparacao import (
    STATUS_AMBIGUO as STATUS_AMBIGUO,
    STATUS_PRECO_INVALIDO as STATUS_PRECO_INVALIDO,
    STATUS_DATA_INVALIDA as STATUS_DATA_INVALIDA,
    STATUS_QUANTIDADE_INVALIDA as STATUS_QUANTIDADE_INVALIDA,
    STATUS_PRECO_COMPRA_INVALIDO as STATUS_PRECO_COMPRA_INVALIDO,
    STATUS_DIMENSAO_PENDENTE as STATUS_DIMENSAO_PENDENTE,
    MOTIVO_NAO_COMPARAVEL as MOTIVO_NAO_COMPARAVEL,
    MOTIVO_FORNECEDOR as MOTIVO_FORNECEDOR,
    MOTIVO_CIDADE as MOTIVO_CIDADE,
    MOTIVO_MODELO as MOTIVO_MODELO,
    MOTIVO_ITEM_MAPEAR as MOTIVO_ITEM_MAPEAR,
    MOTIVO_ITEM as MOTIVO_ITEM,
    MOTIVO_AMBIGUO as MOTIVO_AMBIGUO,
    MOTIVO_PRECO_INVALIDO as MOTIVO_PRECO_INVALIDO,
    MOTIVO_DATA_INVALIDA as MOTIVO_DATA_INVALIDA,
    MOTIVO_PRECO_COMPRA_INVALIDO as MOTIVO_PRECO_COMPRA_INVALIDO,
    MOTIVO_QUANTIDADE_INVALIDA as MOTIVO_QUANTIDADE_INVALIDA,
    STATUS_QUARENTENA as STATUS_QUARENTENA,
    STATUS_COM_ACORDO as STATUS_COM_ACORDO,
    STATUS_DIVERGENCIA as STATUS_DIVERGENCIA,
)
from leitura_dados import (
    BASE_PATH as BASE_PATH,
    carregar_base as carregar_base,
    _preparar_acordos as _preparar_acordos,
    carregar_acordos_portal as carregar_acordos_portal,
)
from vigencia_acordos import (
    _data_vigencia as _data_vigencia,
)
from qualidade_acordos import (
    gerar_qualidade_acordos as gerar_qualidade_acordos,
)
from regras_comparacao import (
    processar as processar,
)
from resumo_comparacao import (
    resumir_status as resumir_status,
    imprimir_resumo as imprimir_resumo,
)
from planilhas_comparacao import (
    gerar_alerta_acordo as gerar_alerta_acordo,
    preparar_recorte_historico as preparar_recorte_historico,
    gerar_recorte_historico as gerar_recorte_historico,
    gerar_pendencias_comparacao as gerar_pendencias_comparacao,
)

OUTPUT_DIR = str(sv_paths.RELATORIOS_DIARIOS)


if __name__ == "__main__":
    from pipeline import garantir_lock_entrada
    garantir_lock_entrada()
    print("Carregando base...")
    df_base   = carregar_base(BASE_PATH)

    if df_base.empty:
        print("AVISO: Nenhuma linha sobrou após os filtros.")
        print("RESULTADO=SEM_DADOS_FILTRO")
        sys.exit(0)

    df_acordo = carregar_acordos_portal()
    print(f"  Base: {len(df_base):,} linhas | Acordo: {len(df_acordo):,} linhas")

    print("Processando...")
    df    = processar(df_base, df_acordo)
    resumo = resumir_status(df)
    imprimir_resumo(resumo)

    run_id = os.environ.get("SUPPLY_VISION_RUN_ID")
    stamp = run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    base  = pathlib.Path(OUTPUT_DIR)

    if df["Status"].isin(STATUS_QUARENTENA).any():
        pasta_pendencias = base / "pendencias_comparacao"
        pasta_pendencias.mkdir(parents=True, exist_ok=True)
        caminho_pendencias = pasta_pendencias / f"pendencias_comparacao_{stamp}.xlsx"
        gerar_pendencias_comparacao(df, str(caminho_pendencias))
        print(f"RELATORIO_PENDENCIAS_COMPARACAO={caminho_pendencias}")

    dados = df[df["Status"].isin(STATUS_DIVERGENCIA)].reset_index(drop=True)
    print(f"\nGerando DIVERGÊNCIAS COM ACORDO ({len(dados):,} linhas)...")
    if dados.empty:
        print("  (nenhuma divergência — arquivo não gerado)")
    else:
        pasta = base / "com_acordo"
        pasta.mkdir(parents=True, exist_ok=True)
        caminho = pasta / f"com_acordo_{stamp}.xlsx"
        gerar_alerta_acordo(dados, str(caminho))
        print(f"RELATORIO_COM_ACORDO={caminho}")

    qualidade_dir = base / "qualidade_acordos"
    qualidade_dir.mkdir(parents=True, exist_ok=True)
    qualidade_path = qualidade_dir / f"qualidade_acordos_{stamp}.csv"
    pendencias = gerar_qualidade_acordos(df_acordo, qualidade_path)
    # O arquivo e sempre gerado (serve de registro), mas so vira anexo quando
    # ha algo para alguem corrigir. Sem isso, todo e-mail carregava um CSV de
    # cabecalho vazio.
    if pendencias:
        print(f"RELATORIO_QUALIDADE_ACORDOS={qualidade_path}")
    else:
        print("  Qualidade dos acordos: nenhuma pendencia, nao sera anexado.")

    print("\nConcluído.")
