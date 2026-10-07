import urllib.error
import urllib.request
import pytest
import portal_conexao


def test_http_publico_usa_loopback_e_preserva_porta():
    assert portal_conexao.endereco_interno('http://servidor:3000') == 'http://127.0.0.1:3000'
    assert portal_conexao.endereco_interno('https://portal.exemplo.com') == 'https://portal.exemplo.com'


@pytest.mark.parametrize('url', ['http://outro:3000', 'https://user:senha@outro',
                                'file:///etc/passwd', 'https://outro?token=x'])
def test_recusa_configuracao_interna_insegura(url):
    with pytest.raises(ValueError):
        portal_conexao.endereco_interno('http://localhost:3000', url)


def test_redirecionamento_nao_repassa_bearer():
    req = urllib.request.Request('https://portal.exemplo.com', headers={'Authorization': 'Bearer segredo'})
    with pytest.raises(urllib.error.HTTPError, match='recusado'):
        portal_conexao.SemRedirecionamento().redirect_request(
            req, None, 302, 'Found', {}, 'https://outro.exemplo.com')


@pytest.mark.parametrize('codigo, repetir', [(302, False), (401, False), (403, False),
                                            (404, False), (429, True), (503, True)])
def test_respostas_permanentes_nao_repetem(codigo, repetir):
    assert portal_conexao.repetir_http(codigo) is repetir
