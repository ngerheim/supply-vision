"""
Contrato da base extraída do Qlik: o que ela precisa ter, e o tratamento
comum ao pipeline diário e ao recorte histórico.

COLUNAS é também a resposta para "o que preciso produzir se a fonte não for
o Qlik".

O descarte de colunas acontece aqui, e não no hipercubo, de propósito:
reduzir o cubo no Qlik faz linhas distintas colapsarem, porque ele devolve
uma linha por combinação de dimensões. Aqui é projeção pura.

A deduplicação foi medida em 243.537 linhas, de 01/2025 a 08/2026: com as 22
colunas do objeto, a base não tem nenhuma linha repetida; com as 11 usadas,
aparecem 21 — todas criadas pelo próprio descarte, e todas artefato de
lançamento. Ela registra quantas removeu porque deduplicação silenciosa
deixa de ser regra e vira comportamento emergente: no dia em que o modelo de
dados mudar, o número muda sozinho e ninguém vê.
"""


class BaseInvalida(RuntimeError):
    """A base não cumpre o contrato: falta coluna obrigatória."""


# Ordem canônica. Define também a ordem das colunas na base gravada.
COLUNAS = [
    'Grupo Despesa',
    'Modelo',
    'Codigo OS',
    'Data Abertura',
    'Descrição',
    'OS Quantidade',
    'Valor Unitario',
    'Fornecedor',
    'Forncedor por Cidade',   # a grafia errada é do Qlik, não daqui
    'Fornecedor CNPJ',
    'Criado Por',
]

# Chegam como número, não como texto, na leitura do hipercubo.
COLUNAS_NUMERICAS = {'Valor Unitario', 'OS Quantidade'}


def validar(cabecalhos, origem):
    """Confere os cabeçalhos contra o contrato. Aborta nomeando o que falta.

    Chamado antes de baixar: sem isso o pipeline traria a base inteira para
    descobrir o problema depois — ou não descobrir.
    """
    faltando = [c for c in COLUNAS if c not in cabecalhos]
    if faltando:
        raise BaseInvalida(
            f'{origem}: faltam colunas obrigatórias: {", ".join(faltando)}\n'
            f'   Encontradas: {", ".join(cabecalhos)}\n'
            f'   A coluna pode ter sido renomeada ou removida no Qlik. Ajuste\n'
            f'   COLUNAS em processo/contrato_base.py e confira o rodar.py.'
        )


def tratar(df):
    """Descarta as colunas não usadas e remove linhas exatamente iguais.

    Devolve (df, colunas_descartadas, linhas_duplicadas). Não imprime nada:
    quem chama decide como registrar.
    """
    faltando = [c for c in COLUNAS if c not in df.columns]
    if faltando:
        raise BaseInvalida(f'base sem as colunas: {", ".join(faltando)}')

    descartadas = len(df.columns) - len(COLUNAS)
    df = df[COLUNAS]

    antes = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    return df, descartadas, antes - len(df)
