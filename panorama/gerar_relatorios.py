"""
Gera os relatórios COM/SEM ACORDO para o recorte (processo\\base_periodo.xlsx).

NÃO duplica a lógica de negócio: importa carregar_base, carregar_acordo,
processar e gerar_* direto do Supply Vision\\processo\\rodar.py — os filtros de
universo (parametros\\) e o layout dos relatórios vêm juntos, sempre
sincronizados com o pipeline diário.

Consequência do acoplamento: se as assinaturas dessas funções mudarem no
rodar.py, este script quebra — ajustar aqui.

Sem e-mail. Saída em reports\\, nomeada com o período.
"""

import os, secrets, sys, pathlib
from datetime import datetime

sys.dont_write_bytecode = True   # não grava __pycache__ no Supply Vision ao importar o rodar.py

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PANORAMA = pathlib.Path(__file__).resolve().parent   # supply-vision/panorama

sys.path.insert(0, str(PANORAMA))          # svp_paths.py e periodo.py, ao lado
import svp_paths
from periodo import resolver_ou_sair

sys.path.insert(0, str(svp_paths.SUPPLY_VISION_SRC))    # rodar.py e sv_paths.py

# Mesmo período que o baixar_periodo.py resolveu: os dois leem o mesmo argv,
# ou o mesmo recorte.py. O _verificar_base() abaixo confere que a base em
# disco corresponde a ele, para não rotular um relatório com período errado.
DATA_INICIO, DATA_FIM, ORIGEM_PERIODO = resolver_ou_sair()

import rodar                    # motor original do Supply Vision

BASE_PATH   = str(svp_paths.BASE_PATH)
META_PATH   = str(svp_paths.META_PATH)
ACORDO_PATH = rodar.ACORDO_PATH      # mesma ACORDOS.xlsx do pipeline diário;
                                     # leitura com retry embutido no rodar.carregar_acordo
OUTPUT_DIR  = svp_paths.REPORTS


def _parse(s):
    return datetime.strptime(str(s).strip(), '%d/%m/%Y').date()


def _verificar_base():
    """Garante que a base em disco é do período pedido agora.

    Sem isso, mudar o período e rodar só este script geraria um relatório
    rotulado com um período e preenchido com dados de outro."""
    if not pathlib.Path(BASE_PATH).exists():
        print('ERRO: dados\\base_periodo.xlsx não existe.')
        print('      Rode `executar.bat recorte` primeiro.')
        sys.exit(1)
    try:
        meta  = pathlib.Path(META_PATH).read_text(encoding='utf-8')
        linha = next(l for l in meta.splitlines() if l.startswith('PERIODO='))
        i, f  = linha.split('=', 1)[1].split(';')
        if (_parse(i), _parse(f)) != (_parse(DATA_INICIO), _parse(DATA_FIM)):
            print(f'ERRO: a base baixada é do período {i} a {f},')
            print(f'      mas o pedido é {DATA_INICIO} a {DATA_FIM}.')
            print('      Rode `executar.bat recorte` para baixar o período novo.')
            sys.exit(1)
    except (FileNotFoundError, StopIteration, ValueError, IndexError):
        print('ERRO: não foi possível validar o período da base baixada')
        print('      (dados\\base_periodo.info.txt ausente ou ilegível).')
        print('      Rode `executar.bat recorte` para baixar de novo com validação.')
        sys.exit(1)


def gerar():
    """Processa a base do recorte e gera os dois relatórios. True = gerou algo."""
    _verificar_base()
    d0, d1 = _parse(DATA_INICIO), _parse(DATA_FIM)
    tag = f"{d0.strftime('%Y%m%d')}-{d1.strftime('%Y%m%d')}"

    print(f'Recorte: {DATA_INICIO} a {DATA_FIM}')
    print('Carregando base do período...')
    df_base = rodar.carregar_base(BASE_PATH)

    if df_base.empty:
        print('AVISO: Nenhuma linha sobrou após os filtros (SEM_DADOS_FILTRO).')
        print('       Nenhum relatório gerado.')
        return False

    df_acordo = rodar.carregar_acordo(ACORDO_PATH)   # retry embutido no rodar.py (16/07/2026)
    print(f'  Base: {len(df_base):,} linhas | Acordo: {len(df_acordo):,} linhas')

    print('Processando...')
    df    = rodar.processar(df_base, df_acordo)
    rodar.imprimir_resumo(rodar.resumir_status(df))

    stamp = os.environ.get('SUPPLY_VISION_RUN_ID') or \
            f"{datetime.now():%Y%m%d_%H%M%S}_{secrets.token_hex(3)}"
    gerou = False
    for nome, filtro, gerador in [
        ('COM ACORDO', df['Status'].isin(rodar.STATUS_COM_ACORDO),  rodar.gerar_com_acordo),
        ('SEM ACORDO', df['Status'] == 'SEM ACORDO', rodar.gerar_sem_acordo),
        ('PENDENCIAS', df['Status'].isin(rodar.STATUS_QUARENTENA), rodar.gerar_pendencias),
    ]:
        dados = df[filtro].reset_index(drop=True)
        print(f'\nGerando {nome} ({len(dados):,} linhas)...')
        if dados.empty:
            print('  (nenhum dado — arquivo não gerado)')
            continue
        slug  = nome.lower().replace(' ', '_')
        pasta = OUTPUT_DIR / slug
        pasta.mkdir(parents=True, exist_ok=True)
        gerador(dados, str(pasta / f'{slug}_periodo_{tag}_{stamp}.xlsx'))
        gerou = True

    print('\nConcluído.')
    return gerou


if __name__ == '__main__':
    gerar()
