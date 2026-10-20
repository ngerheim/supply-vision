import socket
import subprocess

import pytest
import qlik
from test_pipeline import carregar_pipeline
from test_verificador import carregar_verificador


@pytest.mark.parametrize('operacao', ['dns', 'tcp', 'connect_ex', 'udp'])
def test_barreira_de_rede_falha_antes_de_io(operacao):
    with pytest.raises(AssertionError, match='Rede bloqueada'):
        if operacao == 'dns':
            socket.getaddrinfo('smtp.example.com', 587)
        else:
            with socket.socket(type=socket.SOCK_DGRAM if operacao == 'udp' else socket.SOCK_STREAM) as sock:
                if operacao == 'tcp':
                    sock.connect(('127.0.0.1', 9))
                elif operacao == 'connect_ex':
                    sock.connect_ex(('127.0.0.1', 9))
                else:
                    sock.sendto(b'fixture', ('127.0.0.1', 9))


@pytest.mark.xfail(strict=True, raises=AssertionError,
                   reason='qlik.Sessao.abrir imprime str(exc) de create_connection sem mascarar a chave')
def test_falha_de_conexao_qlik_nao_expoe_bearer(monkeypatch, tmp_path, capsys):
    segredo = 'eyJ-segredo-ficticio-qlik'
    chave = tmp_path / 'chave.txt'
    chave.write_text(segredo, encoding='utf-8')
    def falhar(*args, **kwargs):
        raise OSError(f'Authorization: Bearer {segredo}')
    monkeypatch.setattr(qlik.websocket, 'create_connection', falhar)
    monkeypatch.setattr(qlik.time, 'sleep', lambda s: None)
    with pytest.raises(OSError):
        qlik.Sessao('tenant.example.com', 'app-ficticio', chave).abrir()
    saida = capsys.readouterr().out
    assert 'ERRO: conexão' in saida
    assert segredo not in saida


@pytest.mark.xfail(strict=True, raises=AssertionError,
                   reason='verificar_saude._enviar_email grava str(exc) SMTP sem mascarar SMTP_SENHA')
def test_falha_smtp_da_saude_nao_expoe_senha(monkeypatch, tmp_path):
    mod = carregar_verificador(monkeypatch, tmp_path)
    monkeypatch.setenv('MODO_ENSAIO', '0')  # Conexao falsa falha antes de qualquer transporte.
    def falhar(*args):
        raise OSError(f'Falha com senha {mod.SMTP_SENHA}')
    monkeypatch.setattr(mod, 'conectar', falhar)
    assert mod._enviar_email('Teste', 'Corpo') is False
    log = (tmp_path / mod.LOG_VERIF).read_text(encoding='utf-8')
    assert 'FALHA AO ENVIAR' in log
    assert mod.SMTP_SENHA not in log


@pytest.mark.xfail(strict=True, raises=AssertionError,
                   reason='pipeline.rodar_script registra stderr de timeout sem mascarar credenciais')
def test_timeout_do_filho_nao_expoe_segredo(monkeypatch, tmp_path, caplog):
    mod = carregar_pipeline(monkeypatch, tmp_path)
    segredo = 'segredo-ficticio-do-filho'
    def falhar(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 1, output='parcial',
                                        stderr=f'Authorization: Bearer {segredo}')
    monkeypatch.setattr(mod.subprocess, 'run', falhar)
    assert mod.rodar_script('fixture.py', 'fixture') == (False, 'parcial')
    assert 'timeout' in caplog.text
    assert segredo not in caplog.text


@pytest.mark.parametrize('run_id', ['../fora', '..\\fora', 'a/b', 'a\\b'])
@pytest.mark.xfail(strict=True, raises=pytest.fail.Exception,
                   reason='pipeline aceita SUPPLY_VISION_RUN_ID com separadores na importacao e o interpola em caminhos')
def test_identificador_com_separador_e_recusado_na_entrada(monkeypatch, tmp_path, run_id):
    monkeypatch.setenv('SUPPLY_VISION_RUN_ID', run_id)
    with pytest.raises(ValueError):
        carregar_pipeline(monkeypatch, tmp_path)
