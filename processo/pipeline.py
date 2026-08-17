import subprocess
import pathlib
import sys
import re
import logging
import os
import secrets
import msvcrt
from datetime import datetime


import sv_paths

LOG_DIR = str(sv_paths.LOG_DIR)
PIPELINE_TIMEOUT_S = sv_paths.PIPELINE_TIMEOUT_S
RUN_ID = os.environ.get("SUPPLY_VISION_RUN_ID") or \
         f"{datetime.now():%Y%m%d_%H%M%S}_{secrets.token_hex(3)}"
LOCK_PATH = sv_paths.LOG_DIR / "pipeline.lock"
_lock_handle = None

PYTHON = sys.executable.lower().replace("pythonw.exe", "python.exe")

SCRIPT_BAIXAR = str(sv_paths.SCRIPT_BAIXAR)
SCRIPT_RODAR  = str(sv_paths.SCRIPT_RODAR)
SCRIPT_EMAIL  = str(sv_paths.SCRIPT_EMAIL)


def configurar_log():
    pathlib.Path(LOG_DIR).mkdir(parents=True, exist_ok=True)
    log_path = f"{LOG_DIR}\\pipeline_{RUN_ID}.log"

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    handlers = [logging.FileHandler(log_path, encoding="utf-8")]
    if sys.stdout is not None:
        handlers.append(logging.StreamHandler(sys.stdout))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(message)s",
        datefmt="%H:%M:%S",
        handlers=handlers
    )
    return log_path


def rodar_script(caminho, nome, args=None):
    logging.info(f"{'='*50}")
    logging.info(f"INICIANDO: {nome}")
    logging.info(f"{'='*50}")

    cmd = [PYTHON, caminho] + (args or [])
    try:
        resultado = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
            env={**os.environ, "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1",
                 "SUPPLY_VISION_RUN_ID": RUN_ID},
            creationflags=0x08000000, timeout=PIPELINE_TIMEOUT_S
        )
    except subprocess.TimeoutExpired as e:
        logging.error(f"ERRO em '{nome}': excedeu o timeout de {PIPELINE_TIMEOUT_S}s")
        if e.stdout:
            for linha in str(e.stdout).strip().splitlines():
                logging.info(f"  {linha}")
        return False, e.stdout or ""

    if resultado.stdout:
        for linha in resultado.stdout.strip().splitlines():
            logging.info(f"  {linha}")

    if resultado.returncode != 0:
        logging.error(f"ERRO em '{nome}' (código {resultado.returncode})")
        if resultado.stderr:
            for linha in resultado.stderr.strip().splitlines():
                logging.error(f"  {linha}")
        return False, resultado.stdout

    logging.info(f"CONCLUÍDO: {nome}")
    return True, resultado.stdout


def extrair_contexto(output):
    contexto = "parcial"
    datas    = [datetime.now().strftime("%d/%m/%Y")]

    m_ctx   = re.search(r"CONTEXTO_EMAIL=(\w+)", output)
    m_datas = re.search(r"DATAS_EMAIL=(.+)", output)

    if m_ctx:
        contexto = m_ctx.group(1)
    if m_datas:
        datas = m_datas.group(1).strip().split(",")

    return contexto, datas


def extrair_resultado(output):
    """Lê o marcador RESULTADO=... emitido por baixar_base.py / rodar.py."""
    m = re.search(r"RESULTADO=(\w+)", output)
    return m.group(1) if m else ""


def extrair_relatorios(output):
    """Lê os caminhos dos relatórios gerados NESTA execução (marcadores do rodar.py)."""
    com = re.search(r"RELATORIO_COM_ACORDO=(.+)", output)
    sem = re.search(r"RELATORIO_SEM_ACORDO=(.+)", output)
    pend = re.search(r"RELATORIO_PENDENCIAS=(.+)", output)
    return (com.group(1).strip() if com else "",
            sem.group(1).strip() if sem else "",
            pend.group(1).strip() if pend else "")


def adquirir_lock():
    """Mantém um lock exclusivo do Windows até o processo terminar."""
    global _lock_handle
    sv_paths.LOG_DIR.mkdir(parents=True, exist_ok=True)
    _lock_handle = open(LOCK_PATH, "a+b")
    _lock_handle.seek(0, os.SEEK_END)
    if _lock_handle.tell() == 0:
        _lock_handle.write(b"0")
        _lock_handle.flush()
    _lock_handle.seek(0)
    try:
        msvcrt.locking(_lock_handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        _lock_handle.close()
        _lock_handle = None
        raise RuntimeError("já existe uma execução do Supply Vision em andamento")


def enviar_aviso(contexto, datas, situacao):
    """Dispara o e-mail de aviso (sem relatórios) e encerra o pipeline."""
    logging.info(f"  Situação detectada: {situacao} — enviando e-mail de aviso.")
    ok, _ = rodar_script(
        SCRIPT_EMAIL,
        "Envio de e-mail (aviso)",
        args=[contexto, ",".join(datas), "", situacao]
    )
    if not ok:
        logging.error("Pipeline interrompido em: Envio de e-mail (aviso)")
        sys.exit(1)
    logging.info("="*50)
    logging.info(f"PIPELINE CONCLUÍDO — AVISO ENVIADO ({situacao})")
    logging.info("="*50)
    sys.exit(0)


def main():
    try:
        adquirir_lock()
    except RuntimeError as e:
        print(f"ERRO: {e}.", file=sys.stderr)
        sys.exit(2)
    log_path = configurar_log()
    logging.info(f"Run ID: {RUN_ID}")
    logging.info(f"Pipeline iniciado — {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    logging.info(f"Log: {log_path}")

    ok, output_baixar = rodar_script(SCRIPT_BAIXAR, "Download Qlik (filtrado)")
    if not ok:
        logging.error("Pipeline interrompido em: Download Qlik")
        sys.exit(1)

    contexto, datas = extrair_contexto(output_baixar)
    logging.info(f"  Contexto detectado: {contexto} | Datas: {', '.join(datas)}")

    if extrair_resultado(output_baixar) == "SEM_DADOS_QLIK":
        enviar_aviso(contexto, datas, "SEM_DADOS_QLIK")

    ok, output_rodar = rodar_script(SCRIPT_RODAR, "Geração de relatórios")
    if not ok:
        logging.error("Pipeline interrompido em: Geração de relatórios")
        sys.exit(1)

    if extrair_resultado(output_rodar) == "SEM_DADOS_FILTRO":
        enviar_aviso(contexto, datas, "SEM_DADOS_FILTRO")

    caminho_com, caminho_sem, caminho_pend = extrair_relatorios(output_rodar)
    logging.info(f"  Relatórios desta execução: com_acordo={caminho_com or '(não gerado)'} | sem_acordo={caminho_sem or '(não gerado)'} | pendencias={caminho_pend or '(não gerado)'}")
    ok, _ = rodar_script(
        SCRIPT_EMAIL,
        "Envio de e-mail",
        args=[contexto, ",".join(datas), output_rodar, "", caminho_com, caminho_sem, caminho_pend]
    )
    if not ok:
        logging.error("Pipeline interrompido em: Envio de e-mail")
        sys.exit(1)

    logging.info("="*50)
    logging.info("PIPELINE CONCLUÍDO COM SUCESSO")
    logging.info("="*50)


if __name__ == "__main__":
    main()
