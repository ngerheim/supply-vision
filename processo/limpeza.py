"""
limpeza.py - Housekeeping do SupplyVision

Critério de retenção: mantém apenas os N arquivos MAIS RECENTES de cada
tipo (com_acordo, sem_acordo, e cada prefixo dentro de logs/: pipeline_,
limpeza_, verificacao_) — não é mais baseado em idade (dias), e sim em
contagem. O restante é movido para logs/archive/<tipo>/AAAA-MM/, onde o
mês vem do timestamp NO NOME do arquivo (não da data de modificação).

Nada é apagado por este script — só MOVIDO. Também remove pastas
__pycache__ (bytecode descartável, que se regenera sozinho).

Cada execução deste script grava seu próprio log unitário
(logs/limpeza_AAAAMMDD_HHMM.log) — não é mais um arquivo único que cresce
para sempre. Esses próprios logs de limpeza entram na mesma dinâmica de
arquivamento acima (prefixo "limpeza", dentro do tipo "logs").

Uso:
    python limpeza.py              -> execução real
    python limpeza.py --dry-run    -> só LISTA o que moveria, nada é movido
"""
import argparse
import re
import shutil
from datetime import datetime
from pathlib import Path

import sv_paths

MANTER_ULTIMOS = 3

_TS_RE = re.compile(r"(\d{8})_(\d{4})(\d{2})?(?:_[0-9a-zA-Z]+)?")


def registrar(log_path: Path, msg: str):
    linha = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(linha)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(linha + "\n")


def extrair_timestamp(nome: str):
    """Extrai (datetime, prefixo) do nome do arquivo, a partir do padrão
    <prefixo>_AAAAMMDD_HHMM(.ext). Retorna None se o nome não tiver esse
    padrão (arquivo não reconhecido — fica de fora da limpeza, por segurança)."""
    m = _TS_RE.search(nome)
    if not m:
        return None
    try:
        hora = m.group(2) + (m.group(3) or "00")
        dt = datetime.strptime(m.group(1) + hora, "%Y%m%d%H%M%S")
    except ValueError:
        return None
    prefixo = nome[:m.start()].rstrip("_") or "sem_prefixo"
    return dt, prefixo


def _fontes():
    """(pasta, tipo) para cada fonte de arquivos a arquivar: logs/ direto
    (sem recursão) e cada subpasta de reports/ (com_acordo, sem_acordo).
    'tipo' é também o nome da subpasta em logs/archive/."""
    fontes = [(sv_paths.LOG_DIR, "logs")]
    if sv_paths.REPORTS.exists():
        for sub in sorted(sv_paths.REPORTS.iterdir()):
            if sub.is_dir():
                fontes.append((sub, sub.name))
    return fontes


def limpar(dry_run: bool):
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    log_path = sv_paths.LOG_DIR / f"limpeza_{stamp}.log"
    modo = "TESTE (dry-run)" if dry_run else "REAL"
    registrar(
        log_path,
        f"===== modo: {modo} | mantém: {MANTER_ULTIMOS} mais recentes por tipo/prefixo | "
        f"acao: MOVER para archive =====",
    )

    for pasta, tipo in _fontes():
        if not pasta.exists():
            continue

        grupos = {}
        for arq in pasta.iterdir():
            if not arq.is_file():
                continue
            info = extrair_timestamp(arq.name)
            if info is None:
                registrar(log_path, f"  [AVISO] nome sem timestamp reconhecível, ignorado: {arq}")
                continue
            dt, prefixo = info
            grupos.setdefault(prefixo, []).append((dt, arq))

        for prefixo, itens in grupos.items():
            itens.sort(key=lambda x: x[0], reverse=True)
            mover = itens[MANTER_ULTIMOS:]

            for dt, arq in mover:
                mes = dt.strftime("%Y-%m")
                dest_dir = sv_paths.ARCHIVE_DIR / tipo / mes
                destino = dest_dir / arq.name

                if dry_run:
                    registrar(log_path, f"  [TESTE] moveria: {arq}  ->  {destino}")
                    continue

                try:
                    dest_dir.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(arq), str(destino))
                    registrar(log_path, f"  [OK] movido: {arq}  ->  {destino}")
                except Exception as e:
                    registrar(log_path, f"  [ERRO] {arq}: {e}")

    for pycache in sv_paths.RAIZ.rglob("__pycache__"):
        if str(sv_paths.ARCHIVE_DIR) in str(pycache):
            continue
        if dry_run:
            registrar(log_path, f"  [TESTE] removeria pasta: {pycache}")
            continue
        try:
            shutil.rmtree(pycache)
            registrar(log_path, f"  [OK] pasta removida: {pycache}")
        except Exception as e:
            registrar(log_path, f"  [ERRO] {pycache}: {e}")

    registrar(log_path, "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Housekeeping do SupplyVision")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Apenas lista o que moveria, sem mover nada",
    )
    args = parser.parse_args()
    limpar(dry_run=args.dry_run)
