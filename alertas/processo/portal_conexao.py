"""Conexão autenticada ao portal sem expor o token em redirecionamentos."""
import ipaddress
import urllib.error
import urllib.parse
import urllib.request


def _loopback(host):
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def endereco_interno(publico, interno=''):
    """Na instalação conjunta, HTTP usa a mesma porta no próprio servidor."""
    url = urllib.parse.urlsplit(interno or publico)
    if url.scheme not in ('http', 'https') or not url.hostname:
        raise ValueError('Endereço interno do Portal deve usar HTTP local ou HTTPS.')
    if url.username or url.password or url.query or url.fragment:
        raise ValueError('Endereço interno do Portal não aceita credenciais, query ou fragmento.')
    # Ler .port também valida portas malformadas, antes de criar a requisição.
    porta = url.port
    if not interno and url.scheme == 'http' and not _loopback(url.hostname):
        url = url._replace(netloc=f'127.0.0.1:{porta or 80}')
    if url.scheme == 'http' and not _loopback(url.hostname):
        raise ValueError('Token do Portal só pode usar HTTP em loopback; para acesso remoto use HTTPS.')
    return urllib.parse.urlunsplit(url).rstrip('/')


class SemRedirecionamento(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, 'Redirecionamento do Portal recusado.', headers, fp)


def abrir(requisicao, timeout=60):
    url = urllib.parse.urlsplit(requisicao.full_url)
    # Proxy de ambiente não deve receber credenciais destinadas ao loopback.
    handlers = [SemRedirecionamento()]
    if _loopback(url.hostname):
        handlers.append(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener(*handlers).open(requisicao, timeout=timeout)


def repetir_http(codigo):
    # Credencial/endereço incorreto e redirecionamento não se resolvem esperando.
    return codigo in (408, 429) or codigo >= 500
