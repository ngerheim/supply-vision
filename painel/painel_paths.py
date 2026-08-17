"""
Caminhos, configuração e contrato de colunas do Painel — snapshot completo
para o Power BI.

Mesma convenção de panorama/svp_paths.py: tudo deriva de RAIZ, então mover o
projeto não exige editar nada aqui.

Fase 1 (ver docs/desenho_painel_sv.md): sem CHAVE_REGISTRO, sem merge entre
execuções, sem rotação de N backups, disparo manual. Evolui quando a
necessidade aparecer, não antes.
"""
from pathlib import Path

PAINEL = Path(__file__).resolve().parent
RAIZ   = PAINEL.parent

SUPPLY_VISION_SRC = RAIZ / "processo"

CHAVE_QLIK_PATH = RAIZ / "config" / "cfg_qlik.txt"

CANDIDATO_DIR    = PAINEL / "candidato"
CONSOLIDADO_DIR  = PAINEL / "consolidado"
ARQUIVADOS_DIR   = PAINEL / "arquivados"
LOGS_DIR         = PAINEL / "logs"

CONSOLIDADO_PATH = CONSOLIDADO_DIR / "supply_vision_painel.parquet"
BACKUP_PATH      = ARQUIVADOS_DIR / "supply_vision_painel_anterior.parquet"
LOCK_PATH        = PAINEL / ".lock"

BASE_PAINEL_PATH = RAIZ / "dados" / "base_painel.xlsx"

INICIO_HISTORICO = "01/01/2025"

LIMIAR_QUEDA_PCT = 10

COLUNAS_PAINEL = [
    "Data", "OS", "Criador", "Cidade", "Fornecedor", "Modelo", "Item",
    "Motivo Sem Acordo", "Qtd", "Preco OS", "Preco Acordo", "Preco Total OS",
    "Preco Total Acordo", "Diferenca Unit.", "Diferenca Total",
    "Tinha acordo?", "Menor Preco Acordo", "Fornecedor do Acordo",
    "Dif. p/ Menor Acordo", "Status", "CNPJ",
]

COLUNAS_META = ["Grupo Modelo", "Grupo Item", "STATUS_ACORDO", "DATA_EXECUCAO", "RUN_ID"]

GRUPO_MODELO_EXCECOES = {
    "Kia":      "Kia Bongo",
    "Mercedes": "Mercedes Atego",
    "Prancha":  "Prancha Plataforma",
}


def grupo_item(descricao, sinonimos, normalizar):
    """Descricao canonica do item, pelo de-para do projeto.

    sinonimos e normalizar entram como argumento em vez de import no topo
    para este modulo continuar sem dependencia de parametros/ -- ele e lido
    tambem por quem so quer os caminhos.
    """
    d = normalizar(descricao)
    return sinonimos.get(d) or d


def grupo_modelo(modelo):
    """Primeira palavra do modelo, com as exceções acima aplicadas."""
    if not modelo:
        return ""
    primeira = str(modelo).split()[0]
    return GRUPO_MODELO_EXCECOES.get(primeira, primeira)

STATUS_ACORDO_DENTRO = "COM_ACORDO"
STATUS_ACORDO_FORA   = "SEM_ACORDO"

STATUS_FORA = "SEM ACORDO"

for _dir in (CANDIDATO_DIR, CONSOLIDADO_DIR, ARQUIVADOS_DIR, LOGS_DIR):
    _dir.mkdir(parents=True, exist_ok=True)
