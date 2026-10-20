import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

import contrato_base
from test_datas_alvo import carregar_baixar_base


# Contrato externo explicito: nao deriva as entradas da lista da implementacao.
OBRIGATORIAS = ['Grupo Despesa', 'Modelo', 'Codigo OS', 'Data Abertura',
                'Descrição', 'OS Quantidade', 'Valor Unitario', 'Fornecedor',
                'Forncedor por Cidade', 'Fornecedor CNPJ', 'Criado Por']


def linha_base():
    return dict(zip(OBRIGATORIAS, ['GRUPO TESTE', 'MODELO TESTE', 'OS-1', '01/10/2026',
                                  'ITEM TESTE', 2, 12.5, 'FORNECEDOR TESTE',
                                  'CIDADE TESTE', '02424242000138', 'PESSOA TESTE']))


def test_contrato_explicito_e_numeros():
    assert contrato_base.COLUNAS == OBRIGATORIAS
    assert contrato_base.COLUNAS_NUMERICAS == {'OS Quantidade', 'Valor Unitario'}
    assert contrato_base.validar(OBRIGATORIAS + ['Extra'], 'fixture') is None


@pytest.mark.parametrize('coluna', OBRIGATORIAS)
def test_cada_coluna_obrigatoria_e_exigida_antes_e_depois_da_extracao(coluna):
    dados = pd.DataFrame([linha_base()]).drop(columns=coluna)
    with pytest.raises(contrato_base.BaseInvalida) as erro:
        contrato_base.validar(dados.columns, 'objeto-ficticio')
    assert coluna in str(erro.value)
    assert 'objeto-ficticio' in str(erro.value)
    with pytest.raises(contrato_base.BaseInvalida) as erro:
        contrato_base.tratar(dados)
    assert coluna in str(erro.value)


def test_projecao_deduplica_so_apos_preservar_dimensoes_opcionais():
    linhas = [{**linha_base(), 'UF': uf, 'MEDIDA': medida,
               'Fornecedor por Estado': uf, 'Ignorada': extra}
              for uf, medida, extra in [('SP', 'PAR', 'a'), ('SP', 'PAR', 'b'),
                                        ('MG', 'PAR', 'a'), ('SP', 'UNIDADE', 'a')]]
    original = pd.DataFrame(linhas)
    copia = original.copy(deep=True)
    tratada, descartadas, duplicadas = contrato_base.tratar(original)
    assert descartadas == 1
    assert duplicadas == 1
    assert tratada.columns.tolist() == OBRIGATORIAS + ['Fornecedor por Estado', 'UF', 'MEDIDA']
    assert tratada[['UF', 'MEDIDA']].values.tolist() == [
        ['SP', 'PAR'], ['MG', 'PAR'], ['SP', 'UNIDADE']]
    assert tratada.index.tolist() == [0, 1, 2]
    assert tratada['OS Quantidade'].tolist() == [2, 2, 2]
    assert tratada['Valor Unitario'].tolist() == [12.5, 12.5, 12.5]
    assert_frame_equal(original, copia)


def test_base_vazia_preserva_schema_sem_inventar_linhas():
    dados, descartadas, duplicadas = contrato_base.tratar(pd.DataFrame(columns=OBRIGATORIAS))
    assert dados.empty
    assert dados.columns.tolist() == OBRIGATORIAS
    assert (descartadas, duplicadas) == (0, 0)


@pytest.mark.parametrize('cenario', ['completo', 'sem-dados', 'schema-invalido'])
def test_download_diario_valida_contrato_e_emite_marcadores(
        monkeypatch, tmp_path, capsys, cenario):
    mod = carregar_baixar_base(monkeypatch)
    monkeypatch.setattr(mod, 'contrato_base', contrato_base)
    monkeypatch.setattr(mod.sv_paths, 'BASE_PATH', tmp_path / 'base.xlsx')
    monkeypatch.setattr(mod, 'SAIDA', str(tmp_path / 'base.xlsx'))
    monkeypatch.setattr(mod.sys, 'argv', ['baixar_base.py', '--slot', '08:00'])
    monkeypatch.setenv('SV_ALERTA_DATA', '2026-10-05')
    chamadas = []
    headers = OBRIGATORIAS + ['Extra'] if cenario != 'schema-invalido' else ['Extra']
    class Sessao:
        def __init__(self, *args): pass
        def __enter__(self): return self
        def __exit__(self, *args): chamadas.append('fechar')
        def abrir_objeto(self, obj):
            chamadas.append('objeto')
            return 7, headers, len(headers)
        def selecionar_datas(self, campo, datas):
            chamadas.append('selecionar')
            from datetime import date
            assert (campo, datas) == ('OS.OSABERTURADATA', [
                date(2026, 10, 2), date(2026, 10, 3), date(2026, 10, 4)])
            return 0 if cenario == 'sem-dados' else 3
        def ler(self, h, cabecalhos, qcx, numericas):
            chamadas.append('ler')
            assert (h, cabecalhos, qcx, numericas) == (
                7, headers, 12, {'OS Quantidade', 'Valor Unitario'})
            linha = list({**linha_base(), 'Data Abertura': '02/10/2026'}.values())
            return [linha + ['a'], linha + ['b']]
    monkeypatch.setattr(mod.qlik, 'Sessao', Sessao, raising=False)
    if cenario == 'schema-invalido':
        with pytest.raises(contrato_base.BaseInvalida, match='Modelo'):
            mod.baixar()
        assert chamadas == ['objeto', 'fechar']
        assert not mod.sv_paths.BASE_PATH.exists()
    elif cenario == 'sem-dados':
        with pytest.raises(SystemExit) as erro:
            mod.baixar()
        assert erro.value.code == 0
        assert chamadas == ['objeto', 'selecionar', 'fechar']
        assert not mod.sv_paths.BASE_PATH.exists()
    else:
        assert mod.baixar() is None
        assert chamadas == ['objeto', 'selecionar', 'ler', 'fechar']
        dados = pd.read_excel(mod.SAIDA, dtype={'Fornecedor CNPJ': str})
        assert dados.columns.tolist() == OBRIGATORIAS
        assert len(dados) == 1
        assert dados.loc[0, 'Fornecedor CNPJ'] == '02424242000138'
        assert dados.loc[0, 'Valor Unitario'] == 12.5
    saida = capsys.readouterr().out
    if cenario != 'schema-invalido':
        assert 'CONTEXTO_EMAIL=segunda_manha' in saida
        assert 'DATAS_EMAIL=02/10/2026,03/10/2026,04/10/2026' in saida
    assert ('RESULTADO=SEM_DADOS_QLIK' in saida) is (cenario == 'sem-dados')
