from pathlib import Path
import pandas as pd
import pytest
import base_atomica


def test_planilha_completa_tem_metadados_vinculados(tmp_path):
    base, meta = tmp_path / 'base.xlsx', tmp_path / 'base.info.txt'
    base_atomica.salvar_base(pd.DataFrame({'valor': [1, 2]}), base, meta, 'LINHAS=2\n')
    texto = meta.read_text(encoding='utf-8')
    base_atomica.validar_vinculo(base, texto)
    assert pd.read_excel(base)['valor'].tolist() == [1, 2]
    base.write_bytes(b'outra geracao')
    with pytest.raises(ValueError, match='gerações'):
        base_atomica.validar_vinculo(base, texto)


def test_falha_na_escrita_nao_substitui_base_anterior(tmp_path):
    base = tmp_path / 'base.xlsx'
    base.write_bytes(b'anterior')
    class Falha:
        def to_excel(self, caminho, **kwargs):
            Path(caminho).write_bytes(b'parcial')
            raise OSError('disco cheio')
    with pytest.raises(OSError):
        base_atomica.salvar_base(Falha(), base)
    assert base.read_bytes() == b'anterior'
    assert list(tmp_path.iterdir()) == [base]


def test_interrupcao_entre_planilha_e_meta_invalida_marcador_antigo(tmp_path, monkeypatch):
    base, meta = tmp_path / 'base.xlsx', tmp_path / 'base.info.txt'
    meta.write_text('PERIODO=antigo\n', encoding='utf-8')
    replace = base_atomica.os.replace
    def interromper(origem, destino):
        if Path(destino) == meta:
            raise OSError('interrupcao')
        return replace(origem, destino)
    monkeypatch.setattr(base_atomica.os, 'replace', interromper)
    with pytest.raises(OSError):
        base_atomica.salvar_base(pd.DataFrame({'valor': [3]}), base, meta, 'PERIODO=novo\n')
    assert not meta.exists()
    assert pd.read_excel(base)['valor'].tolist() == [3]
    assert list(tmp_path.iterdir()) == [base]
