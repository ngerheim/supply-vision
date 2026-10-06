import runpy
import shutil
from pathlib import Path

import pytest


@pytest.fixture
def validar(monkeypatch, tmp_path):
    alertas = Path(__file__).parents[1]
    parametros = tmp_path / 'alertas' / 'parametros'
    for exemplo in (alertas / 'parametros').rglob('*.exemplo.*'):
        destino = parametros / exemplo.relative_to(alertas / 'parametros')
        destino = destino.with_name(destino.name.replace('.exemplo', ''))
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(exemplo, destino)
    monkeypatch.setenv('SUPPLY_VISION_PRIVADO', str(tmp_path))
    monkeypatch.delenv('SUPPLY_VISION_PARAMETROS_DIR', raising=False)
    executar = runpy.run_path(str(alertas / 'processo' / 'validar_parametros.py'))['validar']
    return executar, parametros


def test_validacao_nao_grava_contagens(validar):
    executar, parametros = validar
    executar()
    assert not (parametros / '.contagens.json').exists()


def test_recusa_filtro_ausente(validar):
    executar, parametros = validar
    (parametros / 'filtros' / 'excluir_modelos.txt').unlink()
    with pytest.raises(RuntimeError, match='ausente'):
        executar()


def test_recusa_csv_sem_colunas_obrigatorias(validar):
    executar, parametros = validar
    (parametros / 'de_para' / 'itens.csv').write_text('origem;destino\na;b\n')
    with pytest.raises(RuntimeError, match='colunas ausentes'):
        executar()
