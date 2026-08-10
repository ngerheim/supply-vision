"""
Resolve e valida o período do recorte.

Precedência: os argumentos --inicio e --fim, que o executar.bat passa; na
ausência deles, o recorte.py ao lado. O recorte.py continua existindo para
que rodar `python panorama/executar.py` sem argumento siga funcionando.

Um período mal formado que chegasse ao Qlik viraria seleção vazia, e o
relatório sairia sem linhas nenhuma sem explicar por quê.
"""
import sys
from datetime import date, datetime

FORMATO = '%d/%m/%Y'
LIMITE_AVISO_DIAS = 400


class PeriodoInvalido(ValueError):
    """Período ausente, mal formado ou incoerente."""


def _parse(texto, rotulo):
    try:
        return datetime.strptime(str(texto).strip(), FORMATO).date()
    except (ValueError, TypeError):
        raise PeriodoInvalido(
            f'{rotulo} inválida: {texto!r}\n'
            f'   Formato esperado: DD/MM/AAAA (ex: 01/07/2026)'
        )


def _de_argv(argv):
    """Extrai --inicio e --fim de argv, ou None se não vierem."""
    valores = {}
    for chave in ('--inicio', '--fim'):
        if chave in argv:
            i = argv.index(chave)
            if i + 1 >= len(argv):
                raise PeriodoInvalido(f'{chave} veio sem valor.')
            valores[chave] = argv[i + 1]
    if not valores:
        return None
    if len(valores) == 1:
        faltando = '--fim' if '--inicio' in valores else '--inicio'
        raise PeriodoInvalido(f'{faltando} não foi informado. Passe os dois ou nenhum.')
    return valores['--inicio'], valores['--fim']


def _de_recorte():
    try:
        from recorte import DATA_FIM, DATA_INICIO
    except ImportError:
        raise PeriodoInvalido(
            'Nenhum período informado e recorte.py não pôde ser lido.\n'
            '   Use: executar.bat recorte, ou passe --inicio e --fim.'
        )
    return DATA_INICIO, DATA_FIM


def resolver(argv=None):
    """Devolve (inicio, fim, origem) já validados, como texto."""
    argv = sys.argv[1:] if argv is None else argv

    bruto = _de_argv(argv)
    origem = 'argumento'
    if bruto is None:
        bruto = _de_recorte()
        origem = 'recorte.py'

    d0 = _parse(bruto[0], 'Data inicial')
    d1 = _parse(bruto[1], 'Data final')

    if d0 > d1:
        raise PeriodoInvalido(
            f'A data inicial ({d0:%d/%m/%Y}) é posterior à final ({d1:%d/%m/%Y}).'
        )

    hoje = date.today()
    if d0 > hoje:
        raise PeriodoInvalido(
            f'A data inicial ({d0:%d/%m/%Y}) está no futuro. '
            f'O Qlik não tem lançamentos à frente de hoje ({hoje:%d/%m/%Y}).'
        )
    if d1 > hoje:
        raise PeriodoInvalido(
            f'A data final ({d1:%d/%m/%Y}) está no futuro. '
            f'O recorte iria até hoje ({hoje:%d/%m/%Y}) e o relatório sairia '
            f'rotulado com um período maior do que o que contém.'
        )

    dias = (d1 - d0).days + 1
    if dias > LIMITE_AVISO_DIAS:
        print(f'AVISO: recorte de {dias} dias. A extração pode levar vários minutos.')

    return d0.strftime(FORMATO), d1.strftime(FORMATO), origem


def resolver_ou_sair(argv=None):
    """Igual ao resolver, mas encerra com mensagem limpa em vez de traceback."""
    try:
        return resolver(argv)
    except PeriodoInvalido as e:
        print(f'ERRO: {e}')
        sys.exit(1)
