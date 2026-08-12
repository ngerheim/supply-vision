"""
Painel — gera o snapshot completo consumido pelo Power BI.

    python painel\\executar.py                  extrai do Qlik e publica
    python painel\\executar.py --sem-extrair    reusa dados/base_painel.xlsx

--sem-extrair salta a etapa mais lenta e reprocessa a base já extraída. Serve
para iterar em regra de classificação sem esperar a extração a cada ajuste, e
para reprocessar depois de mudar ACORDOS.xlsx ou os parametros/. Não use para
atualizar o painel: a base em disco é do momento em que foi extraída.

Extrai do Qlik o recorte de painel_paths.INICIO_HISTORICO até hoje, roda o
mesmo motor do pipeline diário, grava um Parquet candidato, valida, e só então
promove o candidato a oficial por substituição atômica. Falha em qualquer
etapa: o oficial não é tocado, o candidato fica em painel/candidato/ para
inspeção, e o processo sai com código != 0.

NÃO duplica lógica de negócio: importa carregar_base, carregar_acordo,
processar e STATUS_QUARENTENA de processo/rodar.py, e usa processo/qlik.py e
processo/contrato_base.py para a extração — como panorama/ já faz. Se as
assinaturas mudarem lá, este script quebra: ajustar aqui.

Fase 1 (ver docs/desenho_painel_sv.md): disparo manual. Sem agendamento, sem
timeout próprio — a execução é acompanhada na tela. O exit code != 0 já está
no lugar para quando isso passar a rodar pelo Agendador de Tarefas.
"""
import logging
import msvcrt
import pathlib
import secrets
import shutil
import sys
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

sys.dont_write_bytecode = True   # não deixa __pycache__ em processo/

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))   # painel_paths
import painel_paths

sys.path.insert(0, str(painel_paths.SUPPLY_VISION_SRC))
import contrato_base
import qlik
import rodar
import sv_paths as _sv

CAMPO_DATA = 'OS.OSABERTURADATA'
PROGRESSO_A_CADA = 25

_lock_handle = None


class PainelFalhou(RuntimeError):
    """Interrompe a execução com mensagem própria, sem traceback."""


# ═══════════════════════════════════════════════════════════════════
# INFRA — log e lock
# ═══════════════════════════════════════════════════════════════════

def configurar_log():
    log_path = painel_paths.LOGS_DIR / f"painel_{datetime.now():%Y%m%d_%H%M%S}.log"
    handlers = [logging.FileHandler(log_path, encoding="utf-8")]
    if sys.stdout is not None:
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s",
                        datefmt="%H:%M:%S", handlers=handlers)
    return log_path


def adquirir_lock():
    """Lock exclusivo do Windows, igual ao do pipeline.py.

    O SO libera o lock se o processo morrer, então não existe lock órfão para
    tratar — é o motivo de usar msvcrt.locking em vez de um arquivo com PID.
    """
    global _lock_handle
    _lock_handle = open(painel_paths.LOCK_PATH, "a+b")
    _lock_handle.seek(0, 2)
    if _lock_handle.tell() == 0:
        _lock_handle.write(b"0")
        _lock_handle.flush()
    _lock_handle.seek(0)
    try:
        msvcrt.locking(_lock_handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        _lock_handle.close()
        _lock_handle = None
        raise PainelFalhou("já existe uma execução do painel em andamento")


def liberar_lock():
    global _lock_handle
    if _lock_handle:
        _lock_handle.close()
        _lock_handle = None


# ═══════════════════════════════════════════════════════════════════
# ETAPA 1 — extração do recorte completo
# ═══════════════════════════════════════════════════════════════════

def extrair():
    """Baixa o recorte do painel e grava dados/base_painel.xlsx.

    O .xlsx intermediário existe porque rodar.carregar_base() lê de arquivo.
    Custa um round-trip, e é o preço de não duplicar os seis filtros de
    universo que ele aplica.
    """
    d0 = datetime.strptime(painel_paths.INICIO_HISTORICO, '%d/%m/%Y').date()
    dias = [d0 + timedelta(days=i) for i in range((date.today() - d0).days + 1)]
    logging.info(f"Recorte: {painel_paths.INICIO_HISTORICO} até hoje "
                 f"({len(dias):,} dias corridos)")

    with qlik.Sessao(_sv.QLIK_TENANT, _sv.QLIK_APP_ID,
                     str(painel_paths.CHAVE_QLIK_PATH)) as s:
        h, headers, qcx = s.abrir_objeto(_sv.QLIK_OBJ_ID)
        contrato_base.validar(headers, 'objeto do Qlik')

        casadas = s.selecionar_datas(CAMPO_DATA, dias)
        logging.info(f"Dias com dados: {casadas:,} de {len(dias):,}")
        if casadas == 0:
            raise PainelFalhou("nenhum dado no Qlik para o recorte")

        rows = s.ler(h, headers, qcx, contrato_base.COLUNAS_NUMERICAS,
                     progresso_a_cada=PROGRESSO_A_CADA)

    logging.info(f"Linhas lidas: {len(rows):,}")

    df = pd.DataFrame(rows, columns=headers if len(headers) == qcx else None)
    df, n_desc, n_dup = contrato_base.tratar(df)
    logging.info(f"Colunas descartadas (não usadas): {n_desc}")
    if n_dup:
        logging.info(f"Linhas duplicadas removidas: {n_dup:,} "
                     f"({100 * n_dup / len(rows):.3f}%)")

    painel_paths.BASE_PAINEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(painel_paths.BASE_PAINEL_PATH, index=False)
    logging.info(f"base_painel.xlsx salva ({len(df):,} linhas)")


# ═══════════════════════════════════════════════════════════════════
# ETAPA 2 — processamento e gravação do candidato
# ═══════════════════════════════════════════════════════════════════

def gerar_candidato(run_id):
    """Cruza com os acordos e grava o Parquet candidato. Devolve o caminho."""
    df_base = rodar.carregar_base(str(painel_paths.BASE_PAINEL_PATH))
    if df_base.empty:
        raise PainelFalhou("nenhuma linha sobrou após os filtros do pipeline")

    df_acordo = rodar.carregar_acordo(rodar.ACORDO_PATH)
    logging.info(f"Base: {len(df_base):,} linhas | Acordo: {len(df_acordo):,} linhas")

    df = rodar.processar(df_base, df_acordo)

    # Pendências (acordo ambíguo ou sem preço válido) ficam fora do painel:
    # não são "sem acordo", são "não dá para saber". Mesmo tratamento que o
    # README dá a elas nos relatórios.
    antes = len(df)
    df = df[~df["Status"].isin(rodar.STATUS_QUARENTENA)]
    logging.info(f"Pendências excluídas: {antes - len(df):,} de {antes:,}")
    if df.empty:
        raise PainelFalhou("nenhuma linha classificável sobrou")

    painel = df[painel_paths.COLUNAS_PAINEL].copy()

    # Dentro ou fora do acordo, pela mesma régua que separa os relatórios
    # com_acordo/sem_acordo. Ver a nota em painel_paths sobre por que não sai
    # de "Tinha acordo?".
    dentro = painel["Status"].isin(rodar.STATUS_COM_ACORDO)
    painel["STATUS_ACORDO"] = np.where(dentro, painel_paths.STATUS_ACORDO_DENTRO,
                                       painel_paths.STATUS_ACORDO_FORA)
    painel["DATA_EXECUCAO"] = datetime.now()
    painel["RUN_ID"]        = run_id

    # Status que não seja de acordo nem "SEM ACORDO" cairia em SEM_ACORDO sem
    # ninguém ver — um valor novo no rodar.py entraria como se fosse fora do
    # acordo, e o painel mentiria sobre o percentual.
    inesperado = set(painel.loc[~dentro, "Status"].unique()) - {painel_paths.STATUS_FORA}
    if inesperado:
        raise PainelFalhou(f"Status inesperado, não classificável como dentro "
                           f"ou fora do acordo: {sorted(inesperado)}")

    # Tipos explícitos, sem deixar o parquet inferir. OS e CNPJ como texto:
    # são identificadores, não números — e OS inteiro perderia o dtype entre
    # execuções se um recorte viesse com nulo. O nulo vira vazio, não a
    # string "<NA>", que apareceria assim no Power BI.
    painel["OS"] = (painel["OS"].astype("Int64").astype(str)
                                .replace("<NA>", "").fillna(""))
    painel["CNPJ"] = painel["CNPJ"].fillna("").astype(str)

    caminho = painel_paths.CANDIDATO_DIR / f"sv_painel_{run_id}.parquet"
    painel.to_parquet(caminho, index=False)
    logging.info(f"Candidato gravado ({len(painel):,} linhas): {caminho.name}")
    return caminho


# ═══════════════════════════════════════════════════════════════════
# ETAPA 3 — validação
# ═══════════════════════════════════════════════════════════════════

def validar(caminho):
    """Confere o candidato. Devolve a lista de avisos (não impeditivos).

    Levanta PainelFalhou no que impede publicar: ilegível, schema errado,
    domínio inválido, vazio.
    """
    try:
        df = pd.read_parquet(caminho)
    except Exception as e:
        raise PainelFalhou(f"candidato ilegível: {e}")

    faltando = set(painel_paths.COLUNAS_PAINEL + painel_paths.COLUNAS_META) - set(df.columns)
    if faltando:
        raise PainelFalhou(f"colunas ausentes: {sorted(faltando)}")
    if df.empty:
        raise PainelFalhou("candidato sem nenhuma linha")

    dominio = {painel_paths.STATUS_ACORDO_DENTRO, painel_paths.STATUS_ACORDO_FORA}
    fora_dominio = set(df["STATUS_ACORDO"].dropna().unique()) - dominio
    if fora_dominio:
        raise PainelFalhou(f"STATUS_ACORDO fora do domínio: {sorted(fora_dominio)}")

    # STATUS_ACORDO sai de Status na etapa 2 — divergência aqui é bug de
    # geração, não dado de origem.
    esperado = np.where(df["Status"].isin(rodar.STATUS_COM_ACORDO),
                        painel_paths.STATUS_ACORDO_DENTRO,
                        painel_paths.STATUS_ACORDO_FORA)
    divergentes = (esperado != df["STATUS_ACORDO"]).sum()
    if divergentes:
        raise PainelFalhou(f"{divergentes:,} linha(s) com STATUS_ACORDO "
                           f"divergente de Status")

    if df["Data"].isna().all():
        raise PainelFalhou("coluna 'Data' inteiramente nula — layout do Qlik mudou?")

    avisos = []
    if painel_paths.CONSOLIDADO_PATH.exists():
        try:
            n_antes = len(pd.read_parquet(painel_paths.CONSOLIDADO_PATH,
                                          columns=["RUN_ID"]))
            if n_antes:
                queda = 100 * (n_antes - len(df)) / n_antes
                if queda > painel_paths.LIMIAR_QUEDA_PCT:
                    avisos.append(f"queda de {queda:.1f}% nas linhas "
                                  f"({n_antes:,} -> {len(df):,}) desde a última publicação")
        except Exception as e:
            avisos.append(f"não foi possível comparar com a versão anterior: {e}")
    return avisos


# ═══════════════════════════════════════════════════════════════════
# ETAPA 4 — publicação atômica
# ═══════════════════════════════════════════════════════════════════

def publicar(caminho):
    """Promove o candidato a oficial, guardando a versão anterior.

    Path.replace() é atômico no mesmo volume: não existe instante em que o
    consolidado esteja truncado ou ausente para quem estiver lendo.
    """
    if painel_paths.CONSOLIDADO_PATH.exists():
        shutil.copy2(painel_paths.CONSOLIDADO_PATH, painel_paths.BACKUP_PATH)
    caminho.replace(painel_paths.CONSOLIDADO_PATH)


def main():
    log_path = configurar_log()
    run_id = f"{datetime.now():%Y%m%d_%H%M%S}_{secrets.token_hex(3)}"
    logging.info(f"RUN_ID {run_id} — log em {log_path.name}")

    sem_extrair = "--sem-extrair" in sys.argv
    candidato = None
    try:
        adquirir_lock()
        if sem_extrair:
            if not painel_paths.BASE_PAINEL_PATH.exists():
                raise PainelFalhou(
                    f"--sem-extrair pedido, mas {painel_paths.BASE_PAINEL_PATH.name} "
                    f"não existe. Rode sem a opção para extrair do Qlik primeiro.")
            idade = datetime.fromtimestamp(painel_paths.BASE_PAINEL_PATH.stat().st_mtime)
            logging.warning(f"AVISO: --sem-extrair — reusando base extraída em "
                            f"{idade:%d/%m/%Y %H:%M}, sem consultar o Qlik")
        else:
            extrair()
        candidato = gerar_candidato(run_id)
        for aviso in validar(candidato):
            logging.warning(f"AVISO: {aviso}")
        publicar(candidato)
        logging.info(f"CONCLUÍDO: {painel_paths.CONSOLIDADO_PATH}")
    except PainelFalhou as e:
        logging.error(f"ERRO: {e}")
        if candidato and candidato.exists():
            logging.error(f"Candidato preservado para inspeção: {candidato}")
        sys.exit(1)
    finally:
        liberar_lock()


if __name__ == '__main__':
    main()
