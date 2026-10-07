"""
Extração do recorte do dia: baixa do Qlik as OS das datas alvo e grava
dados/base.xlsx.

O horário decide o que buscar — ver datas_alvo(). O pipeline.py lê do stdout
as linhas CONTEXTO_EMAIL, DATAS_EMAIL e RESULTADO para saber o que enviar.
"""
import os
import re
import sys
from datetime import datetime, timedelta

import pandas as pd

import contrato_base
from base_atomica import salvar_base
import qlik
import sv_paths

CHAVE_PATH = str(sv_paths.CFG_QLIK)
SAIDA      = str(sv_paths.BASE_PATH)

APP_ID  = sv_paths.QLIK_APP_ID
OBJ_ID  = sv_paths.QLIK_OBJ_ID
TENANT  = sv_paths.QLIK_TENANT
CAMPO   = 'OS.OSABERTURADATA'


def ler_slot(argv=None, env=None):
    """Horário agendado (HH:MM) passado pelo supervisor, se houver.

    Aceita --slot HH:MM na linha de comando ou SV_ALERTA_SLOT no ambiente.
    Sem slot válido devolve None e vale o relógio (comportamento antigo).
    """
    argv = sys.argv[1:] if argv is None else argv
    env = os.environ if env is None else env
    valor = ''
    for i, arg in enumerate(argv):
        if arg == '--slot' and i + 1 < len(argv):
            valor = argv[i + 1]
        elif arg.startswith('--slot='):
            valor = arg.split('=', 1)[1]
    valor = (valor or env.get('SV_ALERTA_SLOT', '')).strip()
    m = re.fullmatch(r'(\d{1,2}):?(\d{2})', valor)
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        if valor:
            print(f'AVISO: slot agendado inválido ignorado: {valor!r}')
        return None
    return int(m.group(1)), int(m.group(2))


def datas_alvo(slot=None):
    """Quais dias buscar e qual o contexto do e-mail, conforme o horário.

      manhã (< 10h)  dia anterior — na segunda, sexta + sábado + domingo
      11h/14h        hoje, parcial (sexta 14h encerra o dia)
      17h            hoje, compilado

    Com slot (hora, minuto), o horário considerado é o do disparo agendado
    na data de hoje: uma nova tentativa às 10:05 do slot de 08:00 continua
    buscando o dia anterior, em vez de virar parcial do dia.
    """
    agora = datetime.now()
    if slot is not None:
        if os.environ.get('SV_ALERTA_DATA'):
            agora = datetime.strptime(os.environ['SV_ALERTA_DATA'], '%Y-%m-%d')
        agora = agora.replace(hour=slot[0], minute=slot[1], second=0, microsecond=0)
    hoje  = agora.date()
    hora  = agora.hour
    dow   = agora.weekday()

    if hora < 10:
        if dow == 0:
            datas = [hoje - timedelta(days=3), hoje - timedelta(days=2),
                     hoje - timedelta(days=1)]
            contexto = 'segunda_manha'
        else:
            datas = [hoje - timedelta(days=1)]
            contexto = 'manha'
    else:
        datas = [hoje]
        contexto = 'compilado' if hora >= 15 or (dow == 4 and hora >= 14) else 'parcial'

    return datas, contexto


def baixar():
    slot = ler_slot()
    if slot is not None:
        print(f'Slot agendado: {slot[0]:02d}:{slot[1]:02d}')
    datas, contexto = datas_alvo(slot)
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
    salvar_base(df, SAIDA)
    print(f'base.xlsx salva: {SAIDA}')

    sinaliza()


if __name__ == '__main__':
    baixar()
