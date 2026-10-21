"""Leitura do protocolo de resumo emitido pelo motor de negócio."""
import json
import re


def ler_resumo(output):
    marcador = re.search(r'^RESUMO_JSON=(.+)$', output, re.MULTILINE)
    if not marcador:
        raise ValueError('RESUMO_JSON ausente no output de rodar.py')
    return json.loads(marcador.group(1))
