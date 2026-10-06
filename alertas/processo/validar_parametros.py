"""Valida os parametros locais sem rede nem alterar o historico de contagens."""
import runpy
from pathlib import Path


def validar():
    dados = runpy.run_path(str(Path(__file__).parents[1] / 'parametros' / '_dados.py'))
    for nome in ('excluir_grupos_despesa.txt', 'excluir_modelos.txt',
                 'excluir_fornecedores.txt', 'excluir_descricoes.txt'):
        dados['carregar_lista'](nome, registrar=False)
    dados['carregar_de_para']('itens.csv', 'descricao_qlik', 'item_acordo', registrar=False)
    dados['carregar_de_para']('modelos.csv', 'modelo_qlik', 'modelo_acordo',
                             normalizar_chave=False, registrar=False)


if __name__ == '__main__':
    try:
        validar()
    except (OSError, RuntimeError, ValueError) as erro:
        raise SystemExit(str(erro)) from erro
    print('Parametros locais validados; nenhuma conexao externa realizada.')
