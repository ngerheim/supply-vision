"""Conexao TLS comum aos alertas e ao verificador de saude."""
from contextlib import contextmanager
import smtplib
import ssl


@contextmanager
def conectar(host, porta, usuario, senha, seguro=False):
    contexto = ssl.create_default_context()
    fabrica = smtplib.SMTP_SSL if seguro else smtplib.SMTP
    opcoes = {"timeout": 60}
    if seguro:
        opcoes["context"] = contexto
    with fabrica(host, porta, **opcoes) as servidor:
        servidor.ehlo()
        if not seguro:
            servidor.starttls(context=contexto)
            servidor.ehlo()
        servidor.login(usuario, senha)
        yield servidor
