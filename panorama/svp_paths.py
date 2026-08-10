"""
Caminhos do Panorama — análise por recorte temporal.

Tudo deriva de RAIZ, então mover o projeto não exige editar nada aqui.
"""
from pathlib import Path

PANORAMA = Path(__file__).resolve().parent   # supply-vision/panorama
RAIZ     = PANORAMA.parent                   # supply-vision

# Motor de negócio, compartilhado com o pipeline diário. O
# gerar_relatorios.py importa carregar_base, carregar_acordo, processar e
# gerar_* do rodar.py: a lógica não é duplicada, e mudá-la lá vale para os
# dois.
SUPPLY_VISION_SRC = RAIZ / "processo"

CONFIG          = RAIZ / "config"
CHAVE_QLIK_PATH = CONFIG / "cfg_qlik.txt"

# base.xlsx é o recorte do dia; base_periodo.xlsx é o histórico. Arquivos
# distintos, na mesma pasta.
BASE_PATH = RAIZ / "dados" / "base_periodo.xlsx"
META_PATH = RAIZ / "dados" / "base_periodo.info.txt"

# Os relatórios de recorte ficam fora de reports/ de propósito: o limpeza.py
# varre toda subpasta de reports/ com retenção dimensionada para o diário, e
# arquivaria o histórico junto.
REPORTS = RAIZ / "reports_periodo"
