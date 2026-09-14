"""
Extração do recorte do dia: baixa do Qlik as OS das datas alvo e grava
dados/base.xlsx.

O horário decide o que buscar — ver datas_alvo(). O pipeline.py lê do stdout
as linhas CONTEXTO_EMAIL, DATAS_EMAIL e RESULTADO para saber o que enviar.
"""
import sys
from datetime import datetime, timedelta

import pandas as pd

import contrato_base
import qlik
import sv_paths

CHAVE_PATH = str(sv_paths.CFG_QLIK)
SAIDA      = str(sv_paths.BASE_PATH)

APP_ID  = sv_paths.QLIK_APP_ID
OBJ_ID  = sv_paths.QLIK_OBJ_ID
TENANT  = sv_paths.QLIK_TENANT
CAMPO   = 'OS.OSABERTURADATA'


def datas_alvo():
    """Quais dias buscar e qual o contexto do e-mail, conforme o horário.

      manhã (< 10h)  dia anterior — na segunda, sexta + sábado
      meio-dia       hoje, parcial
      tarde          hoje, compilado
    """
    agora = datetime.now()
    hoje  = agora.date()
    hora  = agora.hour
    dow   = agora.weekday()

    if hora < 10:
        if dow == 0:
            datas = [hoje - timedelta(days=3), hoje - timedelta(days=2)]
            contexto = 'segunda_manha'
        else:
            datas = [hoje - timedelta(days=1)]
            contexto = 'manha'
    else:
        datas = [hoje]
        contexto = 'parcial' if hora < 15 else 'compilado'

    return datas, contexto


def baixar():
    datas, contexto = datas_alvo()
    datas_str = [d.strftime('%d/%m/%Y') for d in datas]
    print(f'Contexto: {contexto}')
    print(f'Datas alvo: {", ".join(datas_str)}')

    def sinaliza(resultado=None):
        """Marcadores que o pipeline.py lê do stdout."""
        print(f'CONTEXTO_EMAIL={contexto}')
        print(f'DATAS_EMAIL={",".join(datas_str)}')
        if resultado:
            print(f'RESULTADO={resultado}')

    with qlik.Sessao(TENANT, APP_ID, CHAVE_PATH) as s:
        h, headers, qcx = s.abrir_objeto(OBJ_ID)
        contrato_base.validar(headers, 'objeto do Qlik')

        casadas = s.selecionar_datas(CAMPO, datas)
        print(f'Datas com movimento: {casadas} de {len(datas)}')
        if casadas == 0:
            print('AVISO: Nenhum dado no Qlik para a(s) data(s) alvo.')
            sinaliza('SEM_DADOS_QLIK')
            sys.exit(0)

        rows = s.ler(h, headers, qcx, contrato_base.COLUNAS_NUMERICAS)

    print(f'Linhas lidas: {len(rows):,}')

    df = pd.DataFrame(rows, columns=headers if len(headers) == qcx else None)
    df, n_desc, n_dup = contrato_base.tratar(df)
    print(f'Colunas descartadas (não usadas): {n_desc}')
    if n_dup:
        print(f'Linhas duplicadas removidas: {n_dup}')

    sv_paths.BASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(SAIDA, index=False)
    print(f'base.xlsx salva: {SAIDA}')

    sinaliza()


if __name__ == '__main__':
    baixar()
