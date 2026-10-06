import importlib.util
import ssl
import smtplib
import sys
from pathlib import Path

import pytest
from test_email import carregar_email


@pytest.mark.parametrize("seguro", [False, True])
@pytest.mark.parametrize("saude", [False, True])
@pytest.mark.parametrize("certificado_valido", [False, True])
def test_tls_valida_certificado_antes_de_enviar_credenciais(monkeypatch, tmp_path, saude, certificado_valido, seguro):
    mod = carregar_email(monkeypatch, tmp_path)
    if saude:
        fake = sys.modules["sv_paths"]
        fake.LOG_DIR = tmp_path / "logs"
        fake.DESTINATARIO_ALERTA = "alerta@example.com"
        fake.CHAVE_QLIK_EXPIRA = None
        spec = importlib.util.spec_from_file_location("saude_tls", Path(mod.__file__).with_name("verificar_saude.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    sys.modules["sv_paths"].SMTP_SEGURO = seguro
    mod.SMTP_PORTA = sys.modules["sv_paths"].SMTP_PORTA = 465 if seguro else 587
    monkeypatch.delenv("SUPPLY_VISION_SEM_ENVIO", raising=False)
    chamadas = []

    class SMTP:
        def __init__(self, host, porta, **kwargs):
            assert porta == (465 if seguro else 587)
            if seguro:
                validar(kwargs["context"])

        def __enter__(self): return self
        def __exit__(self, *args): pass
        def ehlo(self): chamadas.append("ehlo")
        def starttls(self, *, context):
            validar(context)
        def login(self, *args): chamadas.append("login")
        def send_message(self, *args, **kwargs):
            chamadas.append("envio")
            return {}

    def validar(context):
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.check_hostname
        chamadas.append("tls")
        if not certificado_valido:
            raise ssl.SSLCertVerificationError("certificado invalido")
    monkeypatch.setattr(smtplib, "SMTP_SSL" if seguro else "SMTP", SMTP)
    if saude:
        assert mod._enviar_email("teste", "corpo") == certificado_valido
    elif certificado_valido:
        mod.enviar_email("teste", "corpo", [], ["teste@example.com"])
    else:
        with pytest.raises(ssl.SSLCertVerificationError):
            mod.enviar_email("teste", "corpo", [], ["teste@example.com"])
    assert ("login" in chamadas) == certificado_valido
    assert ("envio" in chamadas) == certificado_valido
