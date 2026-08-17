"""
Caminhos do Panorama — análise por recorte temporal.

Tudo deriva de RAIZ, então mover o projeto não exige editar nada aqui.
"""
from pathlib import Path

PANORAMA = Path(__file__).resolve().parent
RAIZ     = PANORAMA.parent

SUPPLY_VISION_SRC = RAIZ / "processo"

CONFIG          = RAIZ / "config"
CHAVE_QLIK_PATH = CONFIG / "cfg_qlik.txt"

BASE_PATH = RAIZ / "dados" / "base_periodo.xlsx"
META_PATH = RAIZ / "dados" / "base_periodo.info.txt"

REPORTS = RAIZ / "reports_periodo"
