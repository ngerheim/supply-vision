import json
import pytest
from resumo_saida import ler_resumo


@pytest.mark.parametrize('quebra', ['\n', '\r\n'])
def test_resumo_estruturado_ignora_mensagens_e_preserva_dados(quebra):
    dados = {'total_elegivel': 7, 'contagens': {'ACIMA DO ACORDO': 2},
             'descricao': 'Preço com acento', 'comparavel': True}
    output = quebra.join(['Filtro Grupo: 4 linhas removidas',
                          'RESUMO_JSON=' + json.dumps(dados, ensure_ascii=False),
                          'RELATORIO_COM_ACORDO=arquivo.xlsx'])
    assert ler_resumo(output) == dados


@pytest.mark.parametrize('output', ['', 'AVISO RESUMO_JSON={}', 'RESUMO_JSON='])
def test_marcador_ausente_nao_vira_resumo_vazio(output):
    with pytest.raises(ValueError, match='RESUMO_JSON ausente'):
        ler_resumo(output)


def test_json_corrompido_nao_e_aceito():
    with pytest.raises(json.JSONDecodeError):
        ler_resumo('RESUMO_JSON={corrompido}')
