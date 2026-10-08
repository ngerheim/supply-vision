import os
import sys

import pytest

from test_email import carregar_email
from test_pipeline import carregar_pipeline
from test_verificador import carregar_verificador


@pytest.mark.parametrize('modo', ['1', '0', None])
def test_pipeline_propaga_sem_envio_somente_no_ensaio(monkeypatch, tmp_path, modo):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    if modo is None:
        monkeypatch.delenv('MODO_ENSAIO', raising=False)
    else:
        monkeypatch.setenv('MODO_ENSAIO', modo)
    monkeypatch.delenv('SUPPLY_VISION_SEM_ENVIO', raising=False)
    monkeypatch.setattr(sys, 'argv', ['pipeline.py', '--slot', '08:00'])
    monkeypatch.setattr(mod, 'adquirir_lock', lambda: None)
    monkeypatch.setattr(mod, 'configurar_log', lambda: str(tmp_path / 'pipeline.log'))
    consultas = []
    monkeypatch.setattr(mod.estado_entrega, 'consultar_entrega', lambda: consultas.append(True))
    respostas = iter([
        (True, 'CONTEXTO_EMAIL=manha\nDATAS_EMAIL=07/10/2026'),
        (True, 'RELATORIO_COM_ACORDO=teste.xlsx\nRESUMO_JSON={"total_elegivel":1,"contagens":{"ACIMA DO ACORDO":1,"ABAIXO DO ACORDO":0}}'),
        (True, ''),
    ])
    ambientes = []

    def rodar(*args, **kwargs):
        ambientes.append(os.environ.get('SUPPLY_VISION_SEM_ENVIO'))
        return next(respostas)

    monkeypatch.setattr(mod, 'rodar_script', rodar)
    mod.main()
    assert ambientes == (['1'] * 3 if modo == '1' else [None] * 3)
    assert consultas == ([] if modo == '1' else [True])


def test_envio_direto_em_ensaio_salva_preview_sem_smtp_ou_estado(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    monkeypatch.setenv('MODO_ENSAIO', '1')
    monkeypatch.delenv('SUPPLY_VISION_SEM_ENVIO', raising=False)

    def proibido(*args, **kwargs):
        pytest.fail('Ensaio nao pode usar SMTP nem consultar/marcar entrega')

    monkeypatch.setattr(mod, 'conectar', proibido)
    monkeypatch.setattr(mod.estado_entrega, 'consultar_entrega', proibido)
    destino = mod.enviar_email('Teste', 'Corpo', [], ['teste@example.com'], copia_oculta=[])
    assert destino.is_file()
    assert b'Subject: Teste' in destino.read_bytes()


@pytest.mark.parametrize('modo', ['1', '0', None])
def test_saude_suprime_email_somente_no_ensaio(monkeypatch, tmp_path, modo):
    mod = carregar_verificador(monkeypatch, tmp_path)
    if modo is None:
        monkeypatch.delenv('MODO_ENSAIO', raising=False)
    else:
        monkeypatch.setenv('MODO_ENSAIO', modo)
    chamadas = []

    class SMTP:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def send_message(self, *args, **kwargs):
            chamadas.append('envio')

    def conectar(*args):
        chamadas.append('conexao')
        return SMTP()

    monkeypatch.setattr(mod, 'conectar', conectar)
    assert mod._enviar_email('Teste', 'Corpo') is (modo != '1')
    assert chamadas == ([] if modo == '1' else ['conexao', 'envio'])
    if modo == '1':
        assert 'ensaio: envio suprimido' in (tmp_path / mod.LOG_VERIF).read_text()


def test_saude_e_aviso_de_chave_nao_anunciam_envio_em_ensaio(monkeypatch, tmp_path):
    from datetime import date

    mod = carregar_verificador(monkeypatch, tmp_path)
    monkeypatch.setenv('MODO_ENSAIO', '1')
    monkeypatch.setattr(mod, 'CHAVE_QLIK_EXPIRA', date.today())
    monkeypatch.setattr(mod, 'conectar', lambda *args: pytest.fail('SMTP bloqueado'))
    mod.verificar('0800')
    mod.checar_expiracao_chave('0800')
    log = (tmp_path / mod.LOG_VERIF).read_text()
    assert log.count('ensaio: envio suprimido') == 2
    assert 'ALERTA ENVIADO' not in log
    assert 'QLIK enviado' not in log
