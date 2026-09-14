"""
limpeza.py - Housekeeping do SupplyVision

Política de retenção (por IDADE, com base no timestamp NO NOME do arquivo):

    planilhas e CSV  ->  24 horas
    logs (.log)      ->  5 dias

Os arquivos são APAGADOS, não movidos. A pasta logs/archive foi aposentada:
guardar histórico de relatório não servia a ninguém, porque tudo aqui é
regenerável sob demanda — e um recorte antigo pode inclusive estar
desatualizado em relação aos acordos de hoje.

Fontes varridas:
    logs/                           logs de pipeline, limpeza e verificação
    relatorios/diarios/             saída das execuções agendadas
    relatorios/historicos/          saída dos recortes por período

Arquivo sem timestamp reconhecível no nome NUNCA é tocado.

Também remove pastas __pycache__ (bytecode descartável, que se regenera).

Cada execução grava seu próprio log unitário (logs/limpeza_AAAAMMDD_HHMM.log),
que entra na mesma política de 5 dias.

Uso:
    python limpeza.py              -> execução real
    python limpeza.py --dry-run    -> só LISTA o que apagaria, nada é apagado
"""
import argparse
import re
import shutil
from datetime import datetime, timedelta
from pathlib import Path

import sv_paths

RETENCAO_PLANILHAS = timedelta(hours=24)
RETENCAO_LOGS = timedelta(days=5)
EXT_LOG = {".log"}

"""
_TS_RE ancora no FIM do nome (sem extensao).

Recortes contêm o intervalo consultado antes do timestamp de geração. A âncora
impede que a data do intervalo seja confundida com a idade do arquivo.
"""
_TS_SEGUNDOS = re.compile(r"_(\d{8})_(\d{6})(?:_[0-9A-Za-z]+)?$")
_TS_MINUTOS = re.compile(r"_(\d{8})_(\d{4})(?:_[0-9A-Za-z]+)?$")
# Alguns arquivos trazem só a data no fim do nome, sem hora
# (ex.: qualidade_acordos_validacao_template_YYYYMMDD.csv). Sem este padrão
# eles devolviam None e ficavam no disco para sempre. São tratados como
# gerados à meia-noite daquele dia.
_TS_DATA = re.compile(r"_(\d{8})$")



def registrar(log_path: Path, msg: str):
    linha = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(linha)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(linha + "\n")


def extrair_timestamp(nome: str):
    """Extrai o datetime de GERACAO do nome do arquivo.

    O timestamp precisa estar no FIM do nome (antes da extensao e de um
    sufixo opcional de hash). Nomes fora desse padrao devolvem None e o
    arquivo fica de fora da limpeza, por seguranca."""
    stem = Path(nome).stem
    m = _TS_SEGUNDOS.search(stem)
    formato = "%Y%m%d%H%M%S"
    if not m:
        m = _TS_MINUTOS.search(stem)
        formato = "%Y%m%d%H%M"
    if not m:
        m = _TS_DATA.search(stem)
        formato = "%Y%m%d"
    if not m:
        return None
    try:
        return datetime.strptime("".join(m.groups()), formato)
    except ValueError:
        return None


def retencao_de(arquivo: Path) -> timedelta:
    return RETENCAO_LOGS if arquivo.suffix.lower() in EXT_LOG else RETENCAO_PLANILHAS


def _fontes():
    """Raízes varridas recursivamente pela limpeza."""
    return [sv_paths.LOG_DIR, sv_paths.RELATORIOS_DIARIOS,
            sv_paths.RELATORIOS_HISTORICOS]


def limpar(dry_run: bool):
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    log_path = sv_paths.LOG_DIR / f"limpeza_{stamp}.log"
    agora = datetime.now()
    modo = "TESTE (dry-run)" if dry_run else "REAL"
    registrar(
        log_path,
        f"===== modo: {modo} | planilhas/CSV: {RETENCAO_PLANILHAS} | "
        f"logs: {RETENCAO_LOGS} | acao: APAGAR =====",
    )

    apagados = 0
    bytes_livres = 0

    for pasta in _fontes():
        if not pasta.exists():
            continue
        for arq in sorted(pasta.rglob("*")):
            if not arq.is_file() or arq == log_path:
                continue
            dt = extrair_timestamp(arq.name)
            if dt is None:
                registrar(log_path, f"  [MANTIDO] sem timestamp reconhecível: {arq}")
                continue
            idade = agora - dt
            if idade <= retencao_de(arq):
                continue
            tamanho = arq.stat().st_size
            if dry_run:
                registrar(log_path, f"  [TESTE] apagaria ({idade.days}d): {arq}")
                apagados += 1
                bytes_livres += tamanho
                continue
            try:
                arq.unlink()
                registrar(log_path, f"  [OK] apagado ({idade.days}d): {arq}")
                apagados += 1
                bytes_livres += tamanho
            except Exception as e:
                registrar(log_path, f"  [ERRO] {arq}: {e}")

    for pycache in sv_paths.ALERTAS.rglob("__pycache__"):
        if ".venv" in pycache.parts:
            continue
        if dry_run:
            registrar(log_path, f"  [TESTE] removeria pasta: {pycache}")
            continue
        try:
            shutil.rmtree(pycache)
            registrar(log_path, f"  [OK] pasta removida: {pycache}")
        except Exception as e:
            registrar(log_path, f"  [ERRO] {pycache}: {e}")

    verbo = "seriam liberados" if dry_run else "liberados"
    registrar(log_path, f"===== {apagados} arquivo(s), {bytes_livres / 1048576:.2f} MB {verbo} =====")
    registrar(log_path, "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Housekeeping do SupplyVision")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Apenas lista o que apagaria, sem apagar nada",
    )
    args = parser.parse_args()
    limpar(dry_run=args.dry_run)
