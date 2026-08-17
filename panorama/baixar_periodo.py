"""
Extração do recorte histórico.

Baixa do Qlik as OS do período escolhido e grava dados/base_periodo.xlsx mais
o .info.txt que o gerar_relatorios.py confere antes de processar — a trava que
impede rotular um relatório com um período que não é o dele.

Difere do pipeline diário em três pontos: o período vem de argumento ou do
recorte.py, não do relógio; não emite marcadores de e-mail, porque recorte não
dispara envio; e apaga a base anterior quando o recorte não tem dados.
"""

import pathlib
import sys
from datetime import datetime, timedelta

import pandas as pd

sys.dont_write_bytecode = True

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
import svp_paths
from periodo import resolver_ou_sair

DATA_INICIO, DATA_FIM, ORIGEM_PERIODO = resolver_ou_sair()

sys.path.insert(0, str(svp_paths.SUPPLY_VISION_SRC))
import contrato_base
import qlik
import sv_paths as _sv

CHAVE_PATH = str(svp_paths.CHAVE_QLIK_PATH)
SAIDA      = str(svp_paths.BASE_PATH)
META       = str(svp_paths.META_PATH)

APP_ID  = _sv.QLIK_APP_ID
OBJ_ID  = _sv.QLIK_OBJ_ID
TENANT  = _sv.QLIK_TENANT
CAMPO   = 'OS.OSABERTURADATA'

AVISO_DIAS = 366
PROGRESSO_A_CADA = 25


def dias_do_recorte():
    """Expande o período em dias corridos. Já vem validado do periodo.py."""
    d0 = datetime.strptime(DATA_INICIO, '%d/%m/%Y').date()
    d1 = datetime.strptime(DATA_FIM, '%d/%m/%Y').date()
    return [d0 + timedelta(days=i) for i in range((d1 - d0).days + 1)]


def _descartar_base_antiga():
    """Sem dados no recorte, a base anterior não pode ficar.

    Ela é de outro período, e o gerar_relatorios.py rodaria em cima dela
    produzindo um relatório com o rótulo do recorte novo e os números do
    antigo. O .info.txt some junto para não sobrar metadado órfão.
    """
    pathlib.Path(SAIDA).unlink(missing_ok=True)
    pathlib.Path(META).unlink(missing_ok=True)


def baixar():
    """Baixa o recorte. Devolve o nº de linhas salvas (0 = sem dados)."""
    dias = dias_do_recorte()
    print(f'Recorte: {DATA_INICIO} a {DATA_FIM}  ({len(dias)} dia(s) corridos)')
    if len(dias) > AVISO_DIAS:
        print(f'AVISO: recorte com {len(dias)} dias — a extração pode demorar '
              f'vários minutos.')

    with qlik.Sessao(TENANT, APP_ID, CHAVE_PATH) as s:
        h, headers, qcx = s.abrir_objeto(OBJ_ID)
        contrato_base.validar(headers, 'objeto do Qlik')

        casadas = s.selecionar_datas(CAMPO, dias)
        print(f'Dias com dados no recorte: {casadas} de {len(dias)}')
        if casadas == 0:
            print('AVISO: Nenhum dado no Qlik para o recorte.')
            _descartar_base_antiga()
            print('RESULTADO=SEM_DADOS_QLIK')
            return 0

        rows = s.ler(h, headers, qcx, contrato_base.COLUNAS_NUMERICAS,
                     progresso_a_cada=PROGRESSO_A_CADA)

    print(f'Linhas lidas: {len(rows):,}')

    print('Salvando base_periodo.xlsx (pode demorar em recortes grandes)...')
    df = pd.DataFrame(rows, columns=headers if len(headers) == qcx else None)
    df, n_desc, n_dup = contrato_base.tratar(df)
    print(f'Colunas descartadas (não usadas): {n_desc}')
    if n_dup:
        print(f'Linhas duplicadas removidas: {n_dup:,} '
              f'({100 * n_dup / len(rows):.3f}% do recorte)')

    pathlib.Path(SAIDA).parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(SAIDA, index=False)

    pathlib.Path(META).write_text(
        f'PERIODO={DATA_INICIO};{DATA_FIM}\n'
        f'LINHAS={len(df)}\n'
        f'BAIXADO_EM={datetime.now().strftime("%d/%m/%Y %H:%M")}\n',
        encoding='utf-8')

    print(f'base_periodo.xlsx salva: {SAIDA}')
    return len(df)


if __name__ == '__main__':
    baixar()
