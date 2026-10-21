import json
import os
import subprocess
import sys
from pathlib import Path

from test_parametros_csv_multilinha import carregar


def test_historico_corrompido_avisa_e_recria(tmp_path, monkeypatch, capsys):
    mod = carregar(tmp_path, monkeypatch)
    mod.CONTAGENS.write_text('{invalido', encoding='utf-8')
    assert mod._checar_queda('fixture', 10) == 10
    assert json.loads(mod.CONTAGENS.read_text()) == {'fixture': 10}
    assert 'AVISO' in capsys.readouterr().out


def test_temporario_legado_nao_colide(tmp_path, monkeypatch):
    mod = carregar(tmp_path, monkeypatch)
    (tmp_path / '.contagens.json.tmp').mkdir()
    assert mod._checar_queda('fixture', 10) == 10


def test_processos_preservam_todas_as_contagens(tmp_path):
    codigo = '''
import runpy, sys
from pathlib import Path
m = runpy.run_path(sys.argv[1])
m['_checar_queda'].__globals__['CONTAGENS'] = Path(sys.argv[2])
for n in range(10):
    m['_checar_queda'](sys.argv[3], 10)
'''
    fonte = Path(__file__).parents[1] / 'parametros' / '_dados.py'
    destino = tmp_path / '.contagens.json'
    processos = [subprocess.Popen([sys.executable, '-c', codigo, str(fonte), str(destino), str(i)],
                                 env={**os.environ, 'MODO_ENSAIO': '1'},
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                 for i in range(8)]
    for p in processos:
        _, erro = p.communicate(timeout=30)
        assert p.returncode == 0, erro.decode('utf-8', 'replace')
    assert json.loads(destino.read_text()) == {str(i): 10 for i in range(8)}
