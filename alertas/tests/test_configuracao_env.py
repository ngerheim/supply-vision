import json
from pathlib import Path

import pytest

from sv_paths import _carregar, _carregar_opcional

CASOS = json.loads((Path(__file__).resolve().parents[2] / "testes/fixtures/configuracao-env.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("caso", CASOS, ids=lambda caso: caso["nome"])
def test_contrato_env(caso, tmp_path):
    arquivo = tmp_path / "config.env"
    arquivo.write_text(caso["texto"], encoding="utf-8")
    if caso.get("erro"):
        with pytest.raises(SystemExit):
            _carregar(arquivo)
        with pytest.raises(SystemExit):
            _carregar_opcional(arquivo)
    else:
        assert _carregar(arquivo) == caso["valores"]
        assert _carregar_opcional(arquivo) == caso["valores"]
    assert _carregar_opcional(tmp_path / "ausente.env") == {}
