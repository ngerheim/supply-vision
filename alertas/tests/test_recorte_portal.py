import importlib.util
import sys
import types
from pathlib import Path

import pytest
from test_email import carregar_email


def carregar_recorte(monkeypatch, tmp_path, *, linhas=1, arquivo=True, destinatario='destino@example.com'):
    chamadas = []
    baixar = types.ModuleType('baixar_periodo')
    baixar.DATA_INICIO = '01/01/2026'; baixar.DATA_FIM = '31/01/2026'; baixar.ORIGEM_PERIODO = 'argumento'
    baixar.baixar = lambda: chamadas.append('baixar') or linhas
    gerar = types.ModuleType('gerar_relatorios')
    caminho = tmp_path / 'recorte.xlsx'
    gerar.gerar = lambda: chamadas.append('gerar') or (caminho if arquivo else False)
    pipeline = types.ModuleType('pipeline')
    pipeline.adquirir_lock = lambda: chamadas.append('lock')
    email = types.ModuleType('enviar_email')
    email.enviar_email = lambda *args, **kwargs: chamadas.append(('email', args, kwargs))
    for nome, mod in [('baixar_periodo', baixar), ('gerar_relatorios', gerar), ('pipeline', pipeline), ('enviar_email', email)]:
        monkeypatch.setitem(sys.modules, nome, mod)
    monkeypatch.setattr(sys, 'argv', ['executar.py'] + ([] if destinatario is None else ['--destinatario', destinatario]))
    spec = importlib.util.spec_from_file_location('recorte_portal_test', Path(__file__).resolve().parents[1] / 'panorama' / 'executar.py')
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod, chamadas, caminho


def test_recorte_gera_arquivo_sem_email_mesmo_com_destinatario_antigo(monkeypatch, tmp_path):
    mod, chamadas, caminho = carregar_recorte(monkeypatch, tmp_path)
    mod.main()
    assert chamadas[:3] == ['lock', 'baixar', 'gerar']
    assert chamadas == ['lock', 'baixar', 'gerar']


@pytest.mark.parametrize('linhas,arquivo,destinatario', [(0, True, 'destino@example.com'), (1, False, 'destino@example.com'), (1, True, None)])
def test_recorte_sem_dados_arquivo_ou_destinatario_nao_envia(monkeypatch, tmp_path, linhas, arquivo, destinatario):
    mod, chamadas, _ = carregar_recorte(monkeypatch, tmp_path, linhas=linhas, arquivo=arquivo, destinatario=destinatario)
    mod.main()
    assert not any(isinstance(c, tuple) for c in chamadas)


@pytest.mark.parametrize('destinatario', ['', 'a@example.com;b@example.com', 'a@example.com\r\nBcc:b@example.com'])
def test_destinatario_antigo_nao_interfere_na_geracao_sem_email(monkeypatch, tmp_path, destinatario):
    mod, chamadas, _ = carregar_recorte(monkeypatch, tmp_path, destinatario=destinatario)
    mod.main()
    assert chamadas == ['lock', 'baixar', 'gerar']


def test_recorte_lock_ocupado_aborta_antes_do_download(monkeypatch, tmp_path):
    mod, chamadas, _ = carregar_recorte(monkeypatch, tmp_path)
    def ocupado(): raise RuntimeError('ocupado')
    monkeypatch.setattr(sys.modules['pipeline'], 'adquirir_lock', ocupado)
    with pytest.raises(SystemExit) as erro: mod.main()
    assert erro.value.code == 2
    assert chamadas == []


def test_smtp_historico_nao_acrescenta_copia_oculta_diaria(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    entregas = []
    class SMTP:
        def __init__(self, *args, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def ehlo(self): pass
        def starttls(self, **kwargs): pass
        def login(self, *args): pass
        def send_message(self, msg, *, to_addrs): entregas.append((msg, to_addrs))
    monkeypatch.setattr(mod.smtplib, 'SMTP', SMTP)
    monkeypatch.delenv('SUPPLY_VISION_SEM_ENVIO', raising=False)
    def nao_ler(): raise AssertionError('Não deve ler destinatários diários')
    monkeypatch.setattr(mod, 'obter_destinatarios', nao_ler)
    mod.enviar_email('Recorte', 'Corpo', [], ['historico@example.com'], copia_oculta=[])
    assert entregas[0][1] == ['historico@example.com']
    assert entregas[0][0]['To'] == 'historico@example.com'
