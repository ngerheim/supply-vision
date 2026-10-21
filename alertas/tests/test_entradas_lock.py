import ast
import sys
import types
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize('script,primeira', [
    ('processo/baixar_base.py', 'baixar'), ('processo/rodar.py', 'carregar_base'),
    ('processo/enviar_email.py', 'obter_destinatarios'),
    ('panorama/baixar_periodo.py', 'baixar'), ('panorama/gerar_relatorios.py', 'gerar'),
])
def test_entrada_direta_recusa_lock_antes_de_io(monkeypatch, script, primeira):
    fonte = Path(__file__).parents[1] / script
    arvore = ast.parse(fonte.read_text(encoding='utf-8-sig'))
    entrada = next(n for n in arvore.body if isinstance(n, ast.If)
                   and '__name__' in ast.unparse(n.test))
    def ocupado():
        raise SystemExit(2)
    monkeypatch.setitem(sys.modules, 'pipeline', types.SimpleNamespace(garantir_lock_entrada=ocupado))
    def io(*args, **kwargs):
        pytest.fail('Entrada executou I/O antes de adquirir lock')
    contexto = {'__name__': '__main__', primeira: io, 'BASE_PATH': 'fixture'}
    with pytest.raises(SystemExit) as erro:
        exec(compile(ast.Module(body=[entrada], type_ignores=[]), str(fonte), 'exec'), contexto)
    assert erro.value.code == 2


@pytest.mark.skipif(sys.platform != 'win32', reason='Lock nativo Windows')
def test_filho_herda_reserva_real_e_entrada_independente_e_barrada(tmp_path):
    processo = Path(__file__).parents[1] / 'processo'
    filho = tmp_path / 'filho.py'
    filho.write_text(f"import sys; sys.path.insert(0, {str(processo)!r}); import pipeline; pipeline.garantir_lock_entrada(); print('filho protegido')", encoding='utf-8')
    codigo = '''
import pipeline, subprocess, sys
pipeline.adquirir_lock()
ok, texto = pipeline.rodar_script(sys.argv[1], 'fixture')
assert ok and 'filho protegido' in texto, texto
p = subprocess.run([sys.executable, '-c', 'import pipeline; pipeline.garantir_lock_entrada()'], capture_output=True)
assert p.returncode == 2, (p.returncode, p.stderr)
'''
    r = subprocess.run([sys.executable, '-c', codigo, str(filho)], cwd=processo,
                       capture_output=True, timeout=20)
    assert r.returncode == 0, r.stderr.decode('utf-8', 'replace')
