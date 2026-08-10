"""
Parâmetros de universo: o que entra na análise e como cada item do Qlik se
liga ao item do acordo.

    from parametros import GRUPOS_EXCLUIR, SINONIMOS

Consumidos pelo pipeline diário e pelo recorte histórico, sempre da mesma
fonte. Os dados moram em filtros/*.txt e de_para/*.csv, em texto puro; este
módulo só os carrega. Ver _dados.py para o formato e as guardas de carga.
"""
from ._dados import (ParametroInvalido, carregar_de_para, carregar_lista,
                     normalizar)

# --- Filtros de exclusão: o que NÃO entra na análise ---
GRUPOS_EXCLUIR       = carregar_lista('excluir_grupos_despesa.txt')
MODELOS_EXCLUIR      = carregar_lista('excluir_modelos.txt')
FORNECEDORES_EXCLUIR = carregar_lista('excluir_fornecedores.txt')
ITENS_EXCLUIR        = carregar_lista('excluir_descricoes.txt')

# --- De-para: do vocabulário do Qlik para o do ACORDOS.xlsx ---
# itens.csv casa contra a descrição normalizada, então as chaves entram
# normalizadas. modelos.csv casa contra o valor cru da coluna Modelo.
MODELOS   = carregar_de_para('modelos.csv', 'modelo_qlik', 'modelo_acordo',
                             normalizar_chave=False)
SINONIMOS = carregar_de_para('itens.csv', 'descricao_qlik', 'item_acordo')

__all__ = [
    'FORNECEDORES_EXCLUIR',
    'GRUPOS_EXCLUIR',
    'ITENS_EXCLUIR',
    'MODELOS',
    'MODELOS_EXCLUIR',
    'ParametroInvalido',
    'SINONIMOS',
    'normalizar',
]
