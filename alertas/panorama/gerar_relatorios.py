"""
Gera um relatório consolidado para o recorte (processo\\base_periodo.xlsx).

NÃO duplica a lógica de negócio: importa carregar_base, carregar_acordo,
processar e gerar_recorte_historico direto de processo\\rodar.py — os filtros
de universo (parametros\\) e o layout do relatório vêm juntos, sempre
sincronizados com o pipeline diário.

Consequência do acoplamento: se as assinaturas dessas funções mudarem no
rodar.py, este script quebra — ajustar aqui.

Sem e-mail. Saída em privado/alertas/relatorios/historicos, nomeada com o período.
"""

import os, secrets, sys, pathlib
from datetime import datetime

sys.dont_write_bytecode = True

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PANORAMA = pathlib.Path(__file__).resolve().parent

sys.path.insert(0, str(PANORAMA))
from periodo import resolver_ou_sair

PROCESSO = PANORAMA.parent / 'processo'
sys.path.insert(0, str(PROCESSO))
import sv_paths

DATA_INICIO, DATA_FIM, ORIGEM_PERIODO = resolver_ou_sair()

import rodar

BASE_PATH   = str(sv_paths.DADOS_DIR / 'base_periodo.xlsx')
META_PATH   = str(sv_paths.DADOS_DIR / 'base_periodo.info.txt')
OUTPUT_DIR  = sv_paths.RELATORIOS_HISTORICOS


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
    """Processa a base do recorte e gera um relatório consolidado."""
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

    df_acordo = rodar.carregar_acordos_portal()
    print(f'  Base: {len(df_base):,} linhas | Acordo: {len(df_acordo):,} linhas')

    print('Processando...')
    df    = rodar.processar(df_base, df_acordo)
    rodar.imprimir_resumo(rodar.resumir_status(df))

    stamp = os.environ.get('SUPPLY_VISION_RUN_ID') or \
            f"{datetime.now():%Y%m%d_%H%M%S}_{secrets.token_hex(3)}"
    dados = rodar.preparar_recorte_historico(df)
    print(f'\nGerando RECORTE HISTÓRICO ({len(dados):,} linhas)...')
    if dados.empty:
        print('  (nenhum dado elegível — arquivo não gerado)')
        print('\nConcluído.')
        return False

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    caminho = OUTPUT_DIR / f'recorte_historico_{tag}_{stamp}.xlsx'
    gerou = rodar.gerar_recorte_historico(df, str(caminho))

    print('\nConcluído.')
    return gerou


if __name__ == '__main__':
    gerar()
