import importlib.util
import sys
import types
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

import base_atomica
from test_contrato_base import linha_base, OBRIGATORIAS

PANORAMA = Path(__file__).resolve().parents[1] / 'panorama'


def carregar(nome, monkeypatch):
    monkeypatch.syspath_prepend(str(PANORAMA))
    spec = importlib.util.spec_from_file_location(f'{nome}_panorama_test', PANORAMA / f'{nome}.py')
    mod = importlib.util.module_from_spec(spec)
    # Os scripts legados reconfiguram streams e flags ao importar.
    monkeypatch.setattr(sys, 'dont_write_bytecode', sys.dont_write_bytecode)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def periodo(monkeypatch):
    mod = carregar('periodo', monkeypatch)
    class Dia(date):
        @classmethod
        def today(cls):
            return cls(2026, 10, 20)
    monkeypatch.setattr(mod, 'date', Dia)
    return mod


@pytest.mark.parametrize('argv,motivo', [
    ([], 'Informe'), (['--inicio'], 'sem valor'),
    (['--inicio', '01/01/2026'], '--fim'),
    (['--fim', '01/01/2026'], '--inicio'),
    (['--inicio', '31/02/2026', '--fim', '01/03/2026'], 'inválida'),
    (['--inicio', '2026-01-01', '--fim', '01/03/2026'], 'DD/MM/AAAA'),
    (['--inicio', '02/01/2026', '--fim', '01/01/2026'], 'posterior'),
    (['--inicio', '21/10/2026', '--fim', '22/10/2026'], 'inicial.*futuro'),
    (['--inicio', '20/10/2026', '--fim', '21/10/2026'], 'final.*futuro'),
])
def test_periodo_invalido_aborta_com_motivo(periodo, argv, motivo):
    with pytest.raises(periodo.PeriodoInvalido, match=motivo):
        periodo.resolver(argv)


@pytest.mark.parametrize('inicio,fim', [('29/02/2024', '01/03/2024'),
                                      ('20/10/2026', '20/10/2026')])
def test_periodo_inclusivo_aceita_bissexto_e_hoje(periodo, inicio, fim):
    assert periodo.resolver(['--inicio', inicio, '--fim', fim]) == (inicio, fim, 'argumento')


@pytest.mark.parametrize('inicio,avisa', [('16/09/2025', False), ('15/09/2025', True)])
def test_aviso_apenas_acima_de_400_dias_inclusivos(periodo, capsys, inicio, avisa):
    assert periodo.resolver(['--inicio', inicio, '--fim', '20/10/2026'])[0] == inicio
    assert ('AVISO:' in capsys.readouterr().out) is avisa


@pytest.fixture
def historico(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, 'argv', ['panorama.py', '--inicio', '28/02/2024', '--fim', '01/03/2024'])
    import sv_paths
    monkeypatch.setattr(sv_paths, 'DADOS_DIR', tmp_path)
    monkeypatch.setattr(sv_paths, 'RELATORIOS_HISTORICOS', tmp_path / 'historicos')
    # _verificar_base nao depende das regras de negocio, cobertas em test_regras.
    monkeypatch.setitem(sys.modules, 'rodar', types.ModuleType('rodar'))
    return carregar('baixar_periodo', monkeypatch), carregar('gerar_relatorios', monkeypatch)


def test_download_historico_conserva_periodo_hash_e_projecao(historico, monkeypatch, capsys):
    baixar, gerar = historico
    chamadas = []
    class Sessao:
        def __init__(self, *args): pass
        def __enter__(self): return self
        def __exit__(self, *args): chamadas.append('fechar')
        def abrir_objeto(self, obj): return 7, OBRIGATORIAS + ['Extra'], 12
        def selecionar_datas(self, campo, dias):
            chamadas.append((campo, dias))
            return 3
        def ler(self, h, headers, qcx, numericas, **kwargs):
            assert (h, headers, qcx, numericas, kwargs) == (
                7, OBRIGATORIAS + ['Extra'], 12,
                {'OS Quantidade', 'Valor Unitario'}, {'progresso_a_cada': 25})
            linha = list(linha_base().values())
            return [linha + ['a'], linha + ['b']]
    monkeypatch.setattr(baixar.qlik, 'Sessao', Sessao)
    assert baixar.baixar() == 1
    assert chamadas == [('OS.OSABERTURADATA', [date(2024, 2, 28), date(2024, 2, 29), date(2024, 3, 1)]), 'fechar']
    assert pd.read_excel(baixar.SAIDA).columns.tolist() == OBRIGATORIAS
    texto = Path(baixar.META).read_text(encoding='utf-8')
    assert texto.startswith('PERIODO=28/02/2024;01/03/2024\nLINHAS=1\nBAIXADO_EM=')
    assert 'SHA256=' in texto
    assert gerar._verificar_base() is None
    assert 'Linhas duplicadas removidas: 1' in capsys.readouterr().out


def test_consulta_sem_movimento_descarta_somente_par_historico(historico, monkeypatch):
    baixar, _ = historico
    base, meta = Path(baixar.SAIDA), Path(baixar.META)
    base.write_bytes(b'base anterior'); meta.write_text('meta anterior', encoding='utf-8')
    protegido = base.parent / 'base.xlsx'
    protegido.write_bytes(b'diaria')
    class Sessao:
        def __init__(self, *args): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def abrir_objeto(self, obj): return 7, OBRIGATORIAS, 11
        def selecionar_datas(self, *args): return 0
        def ler(self, *args, **kwargs): pytest.fail('Selecao vazia nao pode ler o cubo inteiro')
    monkeypatch.setattr(baixar.qlik, 'Sessao', Sessao)
    assert baixar.baixar() == 0
    assert not base.exists() and not meta.exists()
    assert protegido.read_bytes() == b'diaria'


@pytest.mark.parametrize('falha', ['base-ausente', 'meta-ausente', 'sem-periodo',
                                  'periodo-ilegivel', 'outro-periodo', 'hash-divergente'])
def test_metadado_invalido_aborta_antes_de_processar(historico, monkeypatch, falha):
    baixar, gerar = historico
    base, meta = Path(baixar.SAIDA), Path(baixar.META)
    periodo = 'PERIODO=28/02/2024;01/03/2024\n'
    base_atomica.salvar_base(pd.DataFrame([linha_base()]), base, meta, periodo)
    if falha == 'base-ausente':
        base.unlink()
    elif falha == 'meta-ausente':
        meta.unlink()
    elif falha == 'hash-divergente':
        base.write_bytes(b'outra geracao')
    else:
        conteudo = meta.read_text(encoding='utf-8')
        troca = {'sem-periodo': '', 'periodo-ilegivel': 'PERIODO=impossivel\n',
                 'outro-periodo': 'PERIODO=01/01/2024;02/01/2024\n'}[falha]
        meta.write_text(conteudo.replace(periodo, troca), encoding='utf-8')
    monkeypatch.setattr(gerar.rodar, 'carregar_base', lambda *a: pytest.fail('Nao deve processar'), raising=False)
    with pytest.raises(SystemExit) as erro:
        gerar.gerar()
    assert erro.value.code == 1


def test_metadado_legado_sem_hash_continua_aceito_se_periodo_confere(historico):
    baixar, gerar = historico
    pd.DataFrame([linha_base()]).to_excel(baixar.SAIDA, index=False)
    Path(baixar.META).write_text('PERIODO=28/02/2024;01/03/2024\nLINHAS=1\n', encoding='utf-8')
    assert gerar._verificar_base() is None
