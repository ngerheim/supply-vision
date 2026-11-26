"""
Extração do recorte histórico.

Baixa do Qlik as OS do período escolhido e grava dados/base_periodo.xlsx mais
o .info.txt que o gerar_relatorios.py confere antes de processar — a trava que
impede rotular um relatório com um período que não é o dele.

O período vem de argumento. O recorte não envia e-mail e descarta a base
anterior quando a consulta não retorna dados.
"""

import pathlib
import sys
from datetime import date, datetime, timedelta

import pandas as pd

sys.dont_write_bytecode = True

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
from periodo import resolver_ou_sair

PROCESSO = RAIZ.parent / 'processo'
sys.path.insert(0, str(PROCESSO))
import sv_paths

DATA_INICIO, DATA_FIM, ORIGEM_PERIODO = resolver_ou_sair()

import contrato_base
from base_atomica import salvar_base
import qlik

CHAVE_PATH = str(sv_paths.CFG_QLIK)
SAIDA      = str(sv_paths.DADOS_DIR / 'base_periodo.xlsx')
META       = str(sv_paths.DADOS_DIR / 'base_periodo.info.txt')

APP_ID  = sv_paths.QLIK_APP_ID
OBJ_ID  = sv_paths.QLIK_OBJ_ID
TENANT  = sv_paths.QLIK_TENANT
CAMPO   = 'OS.OSABERTURADATA'

AVISO_DIAS = 366
PROGRESSO_A_CADA = 25
# Seleção longa demais no Qlik devolveu outro período sem erro (23/11/2026:
# 692 dias pedidos, jun/2023-ago/2025 entregues). Blocos curtos já
# funcionavam; a checagem de datas no fim recusa qualquer escape.
BLOCO_DIAS = 120


def dias_do_recorte():
    """Expande o período em dias corridos. Já vem validado do periodo.py."""
    d0 = datetime.strptime(DATA_INICIO, '%d/%m/%Y').date()
    d1 = datetime.strptime(DATA_FIM, '%d/%m/%Y').date()
    return [d0 + timedelta(days=i) for i in range((d1 - d0).days + 1)]


def _fora_do_periodo(df, inicio, fim):
    """Linhas com data de abertura válida fora do período pedido.

    Data ilegível não conta aqui: ela segue para a quarentena do motor."""
    datas = pd.to_datetime(df['Data Abertura'].astype(str).str.strip(),
                           format='%d/%m/%Y', errors='coerce')
    validas = datas.dropna().dt.date
    return int(((validas < inicio) | (validas > fim)).sum())


def _arquivo_mes(ano, mes):
    return sv_paths.HISTORICO_DIR / f'{ano:04d}-{mes:02d}.csv.gz'


def _mes_fechado(ano, mes, hoje):
    fim = (date(ano + mes // 12, mes % 12 + 1, 1) - timedelta(days=1))
    return fim < hoje - timedelta(days=sv_paths.HISTORICO_JANELA_DIAS)


def _historico_local(dias, hoje=None):
    """Meses fechados e ainda válidos vêm do disco; devolve (guardados, dias a baixar)."""
    hoje = hoje or date.today()
    guardados, dias_qlik = {}, []
    validade = datetime.now().timestamp() - sv_paths.HISTORICO_VALIDADE_DIAS * 86400
    meses = sorted({(d.year, d.month) for d in dias})
    for ano, mes in meses:
        dias_mes = [d for d in dias if (d.year, d.month) == (ano, mes)]
        arquivo = _arquivo_mes(ano, mes)
        usar = _mes_fechado(ano, mes, hoje) and arquivo.exists() and arquivo.stat().st_mtime >= validade
        if usar:
            try:
                df = pd.read_csv(arquivo, sep=';', dtype=str, keep_default_na=False, encoding='utf-8')
                for c in contrato_base.COLUNAS_NUMERICAS & set(df.columns):
                    df[c] = pd.to_numeric(df[c], errors='coerce')
                datas = pd.to_datetime(df['Data Abertura'], format='%d/%m/%Y', errors='coerce').dt.date
                guardados[(ano, mes)] = df[datas.between(dias_mes[0], dias_mes[-1])]
                continue
            except Exception as erro:
                print(f'AVISO: histórico de {mes:02d}/{ano} ilegível ({type(erro).__name__}); baixando de novo.')
        dias_qlik.extend(dias_mes)
    if guardados:
        n = sum(len(d) for d in guardados.values())
        print(f'Histórico local: {len(guardados)} mês(es) do disco ({n:,} linhas); '
              f'{len(dias_qlik)} dia(s) a baixar do Qlik.')
    return guardados, dias_qlik


def _guardar_meses(df, dias_baixados, hoje=None):
    """Guarda cada mês fechado que foi baixado inteiro; meses recentes ou
    parciais nunca vão para o histórico."""
    hoje = hoje or date.today()
    baixados = set(dias_baixados)
    datas = pd.to_datetime(df['Data Abertura'].astype(str).str.strip(), format='%d/%m/%Y', errors='coerce')
    sv_paths.HISTORICO_DIR.mkdir(parents=True, exist_ok=True)
    for (ano, mes), parte in df.groupby([datas.dt.year, datas.dt.month]):
        ano, mes = int(ano), int(mes)
        inicio = date(ano, mes, 1)
        fim = date(ano + mes // 12, mes % 12 + 1, 1) - timedelta(days=1)
        inteiro = all(inicio + timedelta(days=i) in baixados for i in range((fim - inicio).days + 1))
        if not (inteiro and _mes_fechado(ano, mes, hoje)):
            continue
        destino = _arquivo_mes(ano, mes)
        temporario = destino.with_name(destino.name + '.tmp')
        parte.to_csv(temporario, sep=';', index=False, encoding='utf-8', compression='gzip')
        temporario.replace(destino)


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

    guardados, dias_qlik = _historico_local(dias)
    blocos = [dias_qlik[i:i + BLOCO_DIAS] for i in range(0, len(dias_qlik), BLOCO_DIAS)]
    rows, casadas, headers, qcx = [], 0, None, None
    if blocos:
        with qlik.Sessao(TENANT, APP_ID, CHAVE_PATH) as s:
            h, headers, qcx = s.abrir_objeto(OBJ_ID)
            contrato_base.validar(headers, 'objeto do Qlik')

            for n, bloco in enumerate(blocos, 1):
                no_bloco = s.selecionar_datas(CAMPO, bloco)
                casadas += no_bloco
                if len(blocos) > 1:
                    print(f'Bloco {n}/{len(blocos)}: {bloco[0]:%d/%m/%Y} a {bloco[-1]:%d/%m/%Y} '
                          f'({no_bloco} dia(s) com dados)')
                if no_bloco:
                    rows.extend(s.ler(h, headers, qcx, contrato_base.COLUNAS_NUMERICAS,
                                      progresso_a_cada=PROGRESSO_A_CADA))
        print(f'Dias com dados baixados do Qlik: {casadas} de {len(dias_qlik)}')

    if casadas == 0 and not guardados:
        print('AVISO: Nenhum dado no Qlik para o recorte.')
        _descartar_base_antiga()
        print('RESULTADO=SEM_DADOS_QLIK')
        return 0

    print(f'Linhas lidas do Qlik: {len(rows):,}')
    print('Salvando base_periodo.xlsx (pode demorar em recortes grandes)...')
    partes = [d for d in guardados.values()]
    if rows:
        novo = pd.DataFrame(rows, columns=headers if len(headers) == qcx else None)
        novo, n_desc, n_dup = contrato_base.tratar(novo)
        print(f'Colunas descartadas (não usadas): {n_desc}')
        if n_dup:
            print(f'Linhas duplicadas removidas: {n_dup:,} '
                  f'({100 * n_dup / len(rows):.3f}% do baixado)')
        _guardar_meses(novo, dias_qlik)
        partes.append(novo)
    df = pd.concat(partes, ignore_index=True) if len(partes) > 1 else partes[0]

    fora = _fora_do_periodo(df, dias[0], dias[-1])
    if fora:
        _descartar_base_antiga()
        raise RuntimeError(f'O Qlik devolveu {fora:,} linha(s) com abertura fora de '
                           f'{DATA_INICIO} a {DATA_FIM}; a base NÃO foi salva.')

    pathlib.Path(SAIDA).parent.mkdir(parents=True, exist_ok=True)
    salvar_base(df, SAIDA, META,
        f'PERIODO={DATA_INICIO};{DATA_FIM}\n'
        f'LINHAS={len(df)}\n'
        f'BAIXADO_EM={datetime.now().strftime("%d/%m/%Y %H:%M")}\n')

    print(f'base_periodo.xlsx salva: {SAIDA}')
    return len(df)


if __name__ == '__main__':
    from pipeline import garantir_lock_entrada
    garantir_lock_entrada()
    baixar()
