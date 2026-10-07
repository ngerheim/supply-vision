"""Publica planilhas completas e vincula metadados à geração correspondente."""
import hashlib
import os
import tempfile
from pathlib import Path


def hash_arquivo(caminho):
    h = hashlib.sha256()
    with Path(caminho).open('rb') as arquivo:
        for bloco in iter(lambda: arquivo.read(1024 * 1024), b''):
            h.update(bloco)
    return h.hexdigest()


def salvar_base(df, destino, meta=None, conteudo_meta=''):
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporarios = []
    try:
        with tempfile.NamedTemporaryFile(dir=destino.parent, suffix='.xlsx', delete=False) as arquivo:
            planilha = Path(arquivo.name)
        temporarios.append(planilha)
        df.to_excel(planilha, index=False)
        with planilha.open('r+b') as arquivo:
            os.fsync(arquivo.fileno())
        if meta is not None:
            meta = Path(meta)
            with tempfile.NamedTemporaryFile(dir=meta.parent, suffix='.info.tmp', mode='w',
                                             encoding='utf-8', delete=False) as arquivo:
                temporario_meta = Path(arquivo.name)
                temporarios.append(temporario_meta)
                arquivo.write(conteudo_meta + f'SHA256={hash_arquivo(planilha)}\n')
                arquivo.flush()
                os.fsync(arquivo.fileno())
            # Não existe rename atômico de dois arquivos: invalida primeiro o
            # marcador antigo para que uma interrupção não aceite pares mistos.
            meta.unlink(missing_ok=True)
        os.replace(planilha, destino)
        if meta is not None:
            os.replace(temporario_meta, meta)
    finally:
        for temporario in temporarios:
            temporario.unlink(missing_ok=True)


def validar_vinculo(base, texto_meta):
    hash_esperado = next((l.split('=', 1)[1] for l in texto_meta.splitlines()
                         if l.startswith('SHA256=')), None)
    # Compatibilidade com bases anteriores; a próxima extração inclui o hash.
    if hash_esperado is not None and hash_arquivo(base) != hash_esperado:
        raise ValueError('Planilha e metadados pertencem a gerações diferentes.')
