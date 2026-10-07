from datetime import datetime
import types
import pytest
import estado_entrega


@pytest.mark.parametrize('slot', ['8:00', '0800', '08:00'])
def test_slot_normalizado_conserva_data_da_execucao(monkeypatch, tmp_path, slot):
    monkeypatch.setattr(estado_entrega, 'sv_paths', types.SimpleNamespace(OPERACAO=tmp_path))
    monkeypatch.setenv('SV_ALERTA_SLOT', slot)
    monkeypatch.setenv('SV_ALERTA_DATA', '2026-10-05')
    primeiro = estado_entrega.caminho_entrega()
    class DepoisDaMeiaNoite(datetime):
        @classmethod
        def now(cls):
            return cls(2026, 10, 6, 0, 5)
    monkeypatch.setattr(estado_entrega, 'datetime', DepoisDaMeiaNoite)
    assert estado_entrega.caminho_entrega() == primeiro
    assert primeiro.name == '2026-10-05_0800.json'


@pytest.mark.parametrize('slot', ['24:00', '08:99', 'errado'])
def test_slot_invalido_nao_contorna_registro(slot):
    with pytest.raises(ValueError):
        estado_entrega.normalizar_slot(slot)
