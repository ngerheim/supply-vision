"""Leitura dos parâmetros de universo a partir dos arquivos de dados.

Os .py deste pacote não contêm dados: leem os .txt de filtros/ e os .csv de
de_para/. Em 27/07/2026 o arquivo de sinônimos, que na época era um .py com
442 pares dentro, foi sobrescrito por uma versão antiga de 184; o SEM ACORDO
saltou de ~66% para ~80% e passou quatro execuções até alguém notar.

Formato:
  .txt  um valor por linha; linhas vazias e iniciadas com # são ignoradas.
  .csv  delimitador ';', UTF-8 com BOM (abre no Excel com duplo clique).
        Colunas: <de>;<para>;ativo;observacao
        'para' vazio  = revisado, sem equivalente no acordo.
        ativo != Sim  = linha desligada, mantida como registro da decisão.

As guardas de carga falham alto em vez de avisar. Rodar com parâmetro vazio
ou corrompido produz um relatório que parece certo e está errado, e ninguém
tem como desconfiar.
"""
import csv
import json
import re
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent
FILTROS = BASE / 'filtros'
DE_PARA = BASE / 'de_para'
CONTAGENS = BASE / '.contagens.json'

ENC = 'utf-8-sig'
TOLERANCIA_QUEDA = 0.20

_NULOS = {'', '-', 'NONE', 'NAN', 'NULL', '<NA>', 'NAT'}

# Letras que não decompõem em base + acento sob NFD.
_IRREDUTIVEIS = str.maketrans({'Ø': 'O', 'Đ': 'D', 'Ð': 'D', 'Ł': 'L',
                               'Þ': 'TH', 'ß': 'SS', 'Æ': 'AE', 'Œ': 'OE'})


def _e_nulo(valor):
    """True para None, NaN e os marcadores de ausência do pandas.

    NaN e pd.NA não podem ser testados do mesmo jeito: `pd.NA != pd.NA` não
    devolve booleano, devolve pd.NA, e usar isso num `if` levanta TypeError.
    Comparar o nome do tipo evita importar pandas aqui — este módulo carrega
    os parâmetros e não deveria depender dele.
    """
    if valor is None:
        return True
    if type(valor).__name__ in ('NAType', 'NaTType'):
        return True
    try:
        return valor != valor          # NaN float
    except (TypeError, ValueError):
        return False


def normalizar(texto):
    """Forma canônica de comparação de texto, usada em todo o projeto.

    Maiúsculas, sem acento, espaços colapsados. O NBSP (\\xa0) que aparece nas
    descrições vindas do Qlik entra no \\s+ e vira espaço simples.

    Os acentos saem por decomposição Unicode, não por tabela: uma tabela só
    cobre o que alguém lembrou de listar, e `Š` de ŠKODA ou `Ø` já passavam
    direto.

    Marcadores de ausência viram string vazia. A base traz '-', 'nan', vazio e
    os nulos do pandas para o mesmo conceito, e tratá-los como texto faria '-'
    casar com '-' no cruzamento.

    As chaves do de-para passam por aqui na carga porque a comparação é contra
    a descrição já normalizada. Sem isso, chave acentuada nunca casa:
    'REVISÃO 50000 KM' no CSV jamais encontraria 'REVISAO 50000 KM' vindo da
    base, e o sinônimo virava letra morta sem nenhum aviso.
    """
    if _e_nulo(texto):
        return ''
    s = str(texto).strip().upper()
    # NFD separa a letra do acento; o filtro descarta as marcas combinantes.
    s = ''.join(c for c in unicodedata.normalize('NFD', s)
                if not unicodedata.combining(c))
    # Letras que não decompõem em base + acento: Ø, Đ, Ł, ß e afins.
    s = s.translate(_IRREDUTIVEIS)
    s = re.sub(r'\s+', ' ', s).strip()
    return '' if s in _NULOS else s


class ParametroInvalido(RuntimeError):
    """Parâmetro ausente, vazio ou com queda suspeita de tamanho."""


def _linhas_uteis(caminho):
    if not caminho.is_file():
        raise ParametroInvalido(
            f'Parâmetro ausente: {caminho}\n'
            f'   O pipeline não roda sem ele. Copie o modelo .exemplo ao lado\n'
            f'   e preencha, ou restaure a partir do seu backup.'
        )
    try:
        bruto = caminho.read_text(encoding=ENC)
    except (OSError, UnicodeDecodeError) as e:
        raise ParametroInvalido(f'Parâmetro ilegível: {caminho}: {e}') from e
    return [ln for ln in bruto.splitlines()
            if ln.strip() and not ln.lstrip().startswith('#')]


def _checar_queda(nome, quantidade):
    """Bloqueia lista vazia e queda brusca; registra a contagem em disco.

    Na primeira carga não há com o que comparar: apenas registra.
    """
    hist = {}
    if CONTAGENS.is_file():
        try:
            hist = json.loads(CONTAGENS.read_text(encoding='utf-8'))
        except (OSError, ValueError) as e:
            # Tratar corrupção como "sem histórico" desarmaria justamente a
            # guarda que deveria pegar uma queda anormal — e a próxima carga
            # gravaria o valor reduzido como novo normal.
            raise ParametroInvalido(
                f'{CONTAGENS.name} ilegível ({e}).\n'
                f'   Sem ele não dá para detectar queda anormal de parâmetro.\n'
                f'   Apague o arquivo para recomeçar o registro do zero — a\n'
                f'   próxima carga passa sem comparação, então confira os\n'
                f'   tamanhos antes.'
            ) from e

    anterior = hist.get(nome)
    if anterior and quantidade < anterior * (1 - TOLERANCIA_QUEDA):
        raise ParametroInvalido(
            f'{nome}: caiu de {anterior} para {quantidade} entradas '
            f'({100 * (1 - quantidade / anterior):.0f}% a menos).\n'
            f'   Queda acima de {TOLERANCIA_QUEDA:.0%} é tratada como suspeita de\n'
            f'   sobrescrita. Se a redução for intencional, apague a chave\n'
            f'   {nome!r} de {CONTAGENS} e rode de novo.'
        )

    if quantidade == 0:
        raise ParametroInvalido(
            f'{nome}: nenhuma entrada válida.\n'
            f'   Uma lista de filtro vazia deixaria passar tudo, em silêncio.'
        )

    if hist.get(nome) != quantidade:
        hist[nome] = quantidade
        # Grava em temporário e renomeia: escrita interrompida no meio deixaria
        # o arquivo truncado, e a carga seguinte abortaria por corrupção.
        tmp = CONTAGENS.with_suffix('.json.tmp')
        try:
            tmp.write_text(json.dumps(hist, indent=2, ensure_ascii=False),
                           encoding='utf-8')
            tmp.replace(CONTAGENS)
        except OSError:
            tmp.unlink(missing_ok=True)   # o registro ajuda, mas não vale
                                          # derrubar o pipeline por ele
    return quantidade


def carregar_lista(nome):
    """Lê um .txt de filtros e devolve um set de strings."""
    valores = {ln.strip() for ln in _linhas_uteis(FILTROS / nome)}
    _checar_queda(nome, len(valores))
    return valores


def carregar_de_para(nome, col_de, col_para, normalizar_chave=True):
    """Lê um .csv de de-para e devolve {chave: destino ou None}.

    As chaves são normalizadas por padrão, porque quem consome compara contra
    texto já normalizado. Colisão criada pela normalização — duas grafias que
    viram a mesma chave apontando para destinos diferentes — aborta a carga:
    a última venceria em silêncio.

    modelos.csv passa normalizar_chave=False: ali a comparação é contra o
    valor cru da coluna Modelo, não contra a forma canônica.

    Destino vazio vira None, que o rodar.py usa para marcar 'Item não
    comparável' — revisado, sem equivalente no acordo.
    """
    linhas = _linhas_uteis(DE_PARA / nome)
    leitor = csv.DictReader(linhas, delimiter=';')

    faltando = {col_de, col_para} - set(leitor.fieldnames or [])
    if faltando:
        raise ParametroInvalido(
            f'{nome}: colunas ausentes {sorted(faltando)}. '
            f'Encontradas: {leitor.fieldnames}'
        )

    mapa, origem, duplicadas = {}, {}, []
    for linha in leitor:
        bruta = (linha.get(col_de) or '').strip()
        if not bruta:
            continue
        if (linha.get('ativo') or 'Sim').strip().lower() not in ('sim', 's', '1', 'true'):
            continue
        chave = normalizar(bruta) if normalizar_chave else bruta
        destino = (linha.get(col_para) or '').strip() or None
        if chave in mapa and mapa[chave] != destino:
            duplicadas.append((origem[chave], bruta, mapa[chave], destino))
        mapa[chave] = destino
        origem[chave] = bruta

    if duplicadas:
        det = '\n'.join(f'     {a!r} -> {va!r}\n     {b!r} -> {vb!r}'
                        for a, b, va, vb in duplicadas[:5])
        raise ParametroInvalido(
            f'{nome}: {len(duplicadas)} par(es) de chaves que colidem depois da '
            f'normalização, com destinos diferentes.\n'
            f'   A última venceria em silêncio, então o carregamento para aqui.\n{det}'
        )

    _checar_queda(nome, len(mapa))
    return mapa
