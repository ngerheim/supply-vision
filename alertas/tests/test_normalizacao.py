import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "parametros_dados_normalizacao_test", ROOT / "parametros" / "_dados.py"
)
_dados = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(_dados)


@pytest.mark.parametrize("valor", [None, np.nan, pd.NA, pd.NaT, "nan", "<NA>"])
def test_nulos_normalizam_para_vazio(valor):
    assert _dados.normalizar(valor) == ""


def test_nbsp_acentos_e_unicode_sao_normalizados():
    assert _dados.normalizar("  revisão\xa0Škoda Øleo  ") == "REVISAO SKODA OLEO"


def test_colisao_pos_normalizacao_aborta(tmp_path, monkeypatch):
    de_para = tmp_path / "de_para"
    de_para.mkdir()
    arquivo = de_para / "itens.csv"
    arquivo.write_text(
        "de;para;ativo\nREVISÃO;A;Sim\nREVISAO;B;Sim\n", encoding="utf-8-sig"
    )
    monkeypatch.setattr(_dados, "DE_PARA", de_para)
    monkeypatch.setattr(_dados, "CONTAGENS", tmp_path / "contagens.json")
    with pytest.raises(_dados.ParametroInvalido, match="colidem"):
        _dados.carregar_de_para("itens.csv", "de", "para")
