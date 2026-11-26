import importlib
import sys
from datetime import date

import openpyxl
import pandas as pd
import pytest


@pytest.fixture
def painel(rodar, monkeypatch):
    """Importa com os parâmetros e caminhos fictícios do conftest (como o CI)."""
    monkeypatch.delitem(sys.modules, 'painel_resultados', raising=False)
    return importlib.import_module('painel_resultados')


def linha(data, preco, status='CONFORME', os_=1, item='FILTRO', fornecedor='Oficina A', qtd=1, **extra):
    base = {
        'Data': data, 'OS': os_, 'Criador': 'Ana', 'Cidade': 'Cidade A', 'UF': 'MG',
        'Fornecedor': fornecedor, 'Modelo': 'HILUX 2.8', 'Item': item, 'Qtd': qtd,
        'Preco OS': preco, 'Preco Total OS': preco * qtd, 'Preco Acordo': 100,
        'Diferenca Total': (preco - 100) * qtd, 'Tinha acordo?': 'SIM',
        'Dif. p/ Menor Acordo': 0, 'Status': status, 'CNPJ': '11222333000181',
    }
    base.update(extra)
    return base


def test_limpeza_marca_duplicada_e_preco_fora_da_faixa(painel):
    linhas = [linha(date(2026, 10, 1), 100, os_=i) for i in range(12)]
    linhas.append(linha(date(2026, 10, 1), 1000, os_=99))
    linhas.append(linha(date(2026, 10, 1), 100, os_=0))
    dados = painel.limpar(painel.preparar(pd.DataFrame(linhas)))
    motivos = dados[painel.MOTIVO_COLUNA].tolist()
    assert motivos.count(painel.MOTIVO_DUPLICADA) == 1
    assert motivos.count(painel.MOTIVO_DESVIO) == 1
    assert dados.loc[dados['OS'] == 99, painel.MOTIVO_COLUNA].item() == painel.MOTIVO_DESVIO
    assert len(dados) == len(linhas)


def test_faixa_por_uf_quantidade_atipica_e_alerta_de_unidade(painel):
    mg = [linha(date(2026, 10, 1), 100 + i, os_=i, UF='MG') for i in range(12)]
    sp = [linha(date(2026, 10, 1), 160 + i, os_=100 + i, UF='SP') for i in range(12)]
    extra = [linha(date(2026, 10, 2), 205, os_=200, UF='MG'),
             linha(date(2026, 10, 2), 105, os_=201, UF='MG', qtd=50)]
    dados = painel.limpar(painel.preparar(pd.DataFrame(mg + sp + extra)))
    motivo = dados.set_index('OS')[painel.MOTIVO_COLUNA]
    alerta = dados.set_index('OS')[painel.ALERTA_COLUNA]
    # SP é mais caro, mas normal para a própria UF: nada descartado por região.
    assert (motivo.loc[100:111] == '').all()
    assert motivo.loc[201] == painel.MOTIVO_QUANTIDADE
    assert motivo.loc[200] == painel.MOTIVO_DESVIO or alerta.loc[200] == painel.ALERTA_UNIDADE


def test_indice_constante_e_acordos_so_desde_o_corte(painel):
    linhas = [linha(date(2026, 8, 10), 100, os_=1), linha(date(2026, 8, 11), 100, os_=2)]
    linhas += [linha(date(2026, 10, 5), 100, os_=3),
               linha(date(2026, 10, 6), 120, status='ACIMA DO ACORDO', os_=4, item='PASTILHA'),
               linha(date(2026, 10, 7), 80, status='SEM ACORDO', os_=5, item='DISCO')]
    _, ind = painel.calcular(pd.DataFrame(linhas))
    assert set(ind['Índice de preço']['Índice']) == {100.0}
    acordos = ind['Acordos']
    assert acordos['Mês'].tolist() == ['2026-10']
    assert acordos['Conformidade (não acima)'].item() == 0.5
    assert round(acordos['% do gasto com acordo'].item(), 4) == round(220 / 300, 4)


def test_painel_em_excel_tem_resumo_instrumentos_e_base(painel, tmp_path):
    linhas = [linha(date(2026, 9, 20 + i % 5), 100 + i, os_=i) for i in range(15)]
    caminho = tmp_path / 'painel.xlsx'
    assert painel.gerar_painel(pd.DataFrame(linhas), str(caminho)) is True
    abas = openpyxl.load_workbook(caminho, read_only=True).sheetnames
    assert abas[0] == 'Resumo' and abas[-1] == 'Base com limpeza'
    assert {'Índice de preço', 'Acordos', 'Qualidade dos dados'} <= set(abas)


def test_sem_linhas_elegiveis_nao_gera(painel, tmp_path):
    df = pd.DataFrame([linha(date(2026, 10, 1), 100, status='ACORDO AMBÍGUO')])
    assert painel.gerar_painel(df, str(tmp_path / 'x.xlsx')) is False
    assert not (tmp_path / 'x.xlsx').exists()


def test_exporta_painel_e_pacote_base_so_para_recorte_longo(painel, tmp_path):
    import json, zipfile
    linhas = [linha(date(2025, 3, 2 + i % 5), 100 + i, os_=i) for i in range(12)]
    linhas += [linha(date(2026, 10, 1 + i % 5), 110 + i, os_=50 + i) for i in range(12)]
    linhas += [linha(date(2026, 10, 3), 900, os_=99), linha(date(2026, 10, 4), 100, status='ACORDO AMBÍGUO', os_=98)]
    df = pd.DataFrame(linhas)
    dados, ind = painel.calcular(df)
    crua = pd.DataFrame({'Data Abertura': ['01/03/2025', '02/03/2025'], 'Codigo OS': ['1', '2'], 'Fornecedor': ['A', 'B'],
                         'Forncedor por Cidade': ['X', 'Y'], 'Modelo': ['M', 'M'], 'Descrição': ['IPVA', 'FILTRO'],
                         'OS Quantidade': ['1', '1'], 'Valor Unitario': [10.0, 20.0], 'Valor Total': ['10', '20'],
                         '_desc_norm': ['IPVA', 'FILTRO'], '_motivo_universo': ['Item excluído', '']})
    pasta = tmp_path / 'painel'
    assert painel.exportar_painel(dados, ind, date(2026, 9, 1), df, crua, pasta, date(2025, 1, 1)) is None
    assert not pasta.exists()
    assert painel.exportar_painel(dados, ind, date(2025, 1, 1), df, crua, pasta, date(2025, 1, 1)) == pasta
    base = pd.read_csv(pasta / 'base_limpa.csv', sep=';', encoding='utf-8-sig')
    assert len(base) == 25 and set(base['Mantida']) <= {'SIM', 'NÃO'}
    j = json.loads((pasta / 'painel.json').read_text(encoding='utf-8'))
    assert j['periodo']['inicio'].startswith('2025-03') and j['resumo']['linhas'] == 25
    assert j['qualidade']['universo'] == {'linhasCruas': 2, 'entraram': 1,
        'filtros': [{'motivo': 'Descrição fora do escopo (filtro de descrições)', 'linhas': 1}]}
    assert j['qualidade']['quarentena'] == [{'motivo': 'ACORDO AMBÍGUO', 'linhas': 1}]
    assert j['itens'][0]['serie'] and j['metodo']
    with zipfile.ZipFile(pasta / 'painel_base.zip') as z:
        assert sorted(z.namelist()) == ['LEIA-ME.txt', 'base_crua.csv', 'base_tratada.csv', 'retiradas.csv']
        retiradas = z.read('retiradas.csv').decode('utf-8-sig')
        assert 'Filtro do Universo;Descrição fora do escopo' in retiradas
        assert 'Quarentena do motor;ACORDO AMBÍGUO' in retiradas
        assert 'Limpeza estatística;' in retiradas
        assert z.read('base_crua.csv').decode('utf-8-sig').splitlines()[1].startswith('Retirada: ')
    assert not list(pasta.glob('*.tmp'))
