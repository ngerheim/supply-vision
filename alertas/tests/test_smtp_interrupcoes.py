import smtplib

import pytest
from test_email import carregar_email


@pytest.fixture
def email(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    monkeypatch.setenv('MODO_ENSAIO', '0')  # conectar e substituido por transporte em memoria.
    monkeypatch.delenv('SUPPLY_VISION_SEM_ENVIO', raising=False)
    return mod


def enviar(mod):
    return mod.enviar_email('Teste', 'Corpo', [], ['para@example.com'], copia_oculta=[])


@pytest.mark.parametrize('fase,estado,envios', [
    ('conexao', None, 0), ('reserva', 'incerto', 0),
    ('envio', 'incerto', 1), ('recibo', 'incerto', 1), ('fechamento', 'enviado', 1),
])
def test_interrupcao_preserva_recibo_e_impede_reenvio_incerto(
        email, monkeypatch, fase, estado, envios):
    chamadas = []
    falha = [True]
    class SMTP:
        def __enter__(self):
            chamadas.append('conexao')
            if fase == 'conexao' and falha[0]:
                raise OSError('interrupcao na conexao')
            return self
        def __exit__(self, *args):
            if fase == 'fechamento' and falha[0]:
                raise OSError('interrupcao no fechamento')
        def send_message(self, msg, *, to_addrs):
            # O recibo deve estar duravel ANTES de tentar DATA.
            assert email.estado_entrega.consultar_entrega()['estado'] == 'incerto'
            assert to_addrs == ['para@example.com']
            chamadas.append('envio')
            if fase == 'envio' and falha[0]:
                raise smtplib.SMTPServerDisconnected('resposta perdida')
            return {}
    monkeypatch.setattr(email, 'conectar', lambda *a: SMTP())
    fsync = email.estado_entrega.os.fsync
    replace = email.estado_entrega.os.replace
    def sincronizar(fd):
        if fase == 'reserva' and falha[0]:
            raise OSError('interrupcao ao persistir reserva')
        return fsync(fd)
    def substituir(origem, destino):
        if fase == 'recibo' and falha[0]:
            raise OSError('interrupcao ao publicar recibo')
        return replace(origem, destino)
    monkeypatch.setattr(email.estado_entrega.os, 'fsync', sincronizar)
    monkeypatch.setattr(email.estado_entrega.os, 'replace', substituir)
    erro = email.estado_entrega.EntregaEmRevisao if fase == 'envio' else OSError
    with pytest.raises(erro):
        enviar(email)
    recibo = email.estado_entrega.consultar_entrega()
    assert (recibo['estado'] if recibo else None) == estado
    assert chamadas.count('envio') == envios
    assert not list(email.sv_paths.OPERACAO.rglob('*.tmp'))
    falha[0] = False
    if estado == 'incerto':
        with pytest.raises(email.estado_entrega.EntregaEmRevisao):
            enviar(email)
    else:
        assert enviar(email) is None
        assert email.estado_entrega.consultar_entrega()['estado'] == 'enviado'
    assert chamadas.count('conexao') == (2 if estado is None else 1)
    assert chamadas.count('envio') == (1 if estado is None else envios)


@pytest.mark.parametrize('erro', [
    smtplib.SMTPRecipientsRefused({'para@example.com': (550, b'recusado')}),
    smtplib.SMTPDataError(554, b'recusado'),
    smtplib.SMTPSenderRefused(550, b'recusado', 'origem@example.com'),
])
def test_rejeicao_explicita_cancela_reserva_e_permite_nova_tentativa(email, monkeypatch, erro):
    chamadas = []
    class SMTP:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def send_message(self, *args, **kwargs):
            chamadas.append('envio')
            if len(chamadas) == 1:
                raise erro
            return {}
    monkeypatch.setattr(email, 'conectar', lambda *a: SMTP())
    with pytest.raises(type(erro)):
        enviar(email)
    assert email.estado_entrega.consultar_entrega() is None
    assert enviar(email) is None
    assert chamadas == ['envio', 'envio']
    assert email.estado_entrega.consultar_entrega()['estado'] == 'enviado'


@pytest.mark.parametrize('campo', ['assunto', 'para', pytest.param('cco', marks=pytest.mark.xfail(
    strict=True, raises=pytest.fail.Exception,
    reason='enviar_email valida To/Subject via EmailMessage, mas CCO vai ao envelope sem validar CR/LF'))])
@pytest.mark.parametrize('quebra', ['\r', '\n', '\r\n'])
def test_injecao_de_cabecalho_aborta_antes_de_smtp(email, monkeypatch, campo, quebra):
    conexoes = []
    class SMTP:
        def __enter__(self):
            conexoes.append(True)
            return self
        def __exit__(self, *args): pass
        def send_message(self, *args, **kwargs): return {}
    monkeypatch.setattr(email, 'conectar', lambda *a: SMTP())
    valor = f'origem@example.com{quebra}Bcc: intruso@example.com'
    with pytest.raises(ValueError):
        email.enviar_email(valor if campo == 'assunto' else 'Teste', 'Corpo', [],
                           [valor if campo == 'para' else 'para@example.com'],
                           copia_oculta=[valor] if campo == 'cco' else [])
    assert conexoes == []
    assert email.estado_entrega.consultar_entrega() is None
