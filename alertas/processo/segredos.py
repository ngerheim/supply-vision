"""Mascaramento comum para mensagens de diagnostico externas."""

import re


def mascarar(texto, *segredos):
    texto = str(texto)
    for segredo in segredos:
        if segredo:
            texto = texto.replace(str(segredo), '[mascarado]')
    return re.sub(r'(?i)(\bbearer\s+)[^\s\x22\x27,;]+',
                  r'\1[mascarado]', texto)
