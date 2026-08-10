"""
Caminhos e configuração de ambiente do Supply Vision.

Os caminhos internos derivam de RAIZ, calculada a partir da localização deste
arquivo: mover ou clonar o projeto não exige editar nada aqui.

O que é específico da instalação — tenant do Qlik, servidor SMTP, e-mails,
caminho da planilha de acordos, nome da tarefa agendada — vem de
config/cfg_ambiente.txt, que fica fora do Git. Falta o arquivo ou uma chave,
o pipeline aborta: um default silencioso apontaria para a base errada, ou
mandaria e-mail para a relação errada, sem ninguém perceber.
"""
from pathlib import Path

# sv_paths.py vive em processo/; sobe um nível para a raiz do projeto.
RAIZ = Path(__file__).resolve().parent.parent

CONFIG_DIR   = RAIZ / "config"
PROCESSO_DIR = RAIZ / "processo"
DADOS_DIR    = RAIZ / "dados"
LOG_DIR      = RAIZ / "logs"
REPORTS      = RAIZ / "reports"
ARCHIVE_DIR  = LOG_DIR / "archive"

# base.xlsx é dado, não código: vive em dados/, não junto dos scripts.
# Regerada a cada execução pelo baixar_base.py.
BASE_PATH     = DADOS_DIR / "base.xlsx"

CFG_QLIK      = CONFIG_DIR / "cfg_qlik.txt"
CFG_SMTP      = CONFIG_DIR / "cfg_smtp.txt"
CFG_AMBIENTE  = CONFIG_DIR / "cfg_ambiente.txt"
DESTINATARIOS = CONFIG_DIR / "destinatarios.txt"

SCRIPT_BAIXAR = PROCESSO_DIR / "baixar_base.py"
SCRIPT_RODAR  = PROCESSO_DIR / "rodar.py"
SCRIPT_EMAIL  = PROCESSO_DIR / "enviar_email.py"

# Pasta-pai de parametros/, para o `from parametros import ...` funcionar.
PARAMETROS_SRC = RAIZ
PARAMETROS_DIR = RAIZ / "parametros"


def _carregar_ambiente(path=CFG_AMBIENTE):
    """Lê cfg_ambiente.txt no formato `chave = valor`."""
    try:
        linhas = path.read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError:
        raise SystemExit(
            f"ERRO: arquivo de ambiente não encontrado: {path}\n"
            f"      Copie config/cfg_ambiente.exemplo.txt para "
            f"config/cfg_ambiente.txt e preencha os valores."
        )
    valores = {}
    for n, ln in enumerate(linhas, 1):
        t = ln.strip()
        if not t or t.startswith("#"):
            continue
        if "=" not in t:
            raise SystemExit(
                f"ERRO: linha inválida em cfg_ambiente.txt (linha {n}): {t!r}\n"
                f"      Formato esperado: CHAVE = valor"
            )
        chave, _, valor = t.partition("=")
        valores[chave.strip().upper()] = valor.strip()
    return valores


AMBIENTE = _carregar_ambiente()


def _exigir(chave):
    """Devolve o valor da chave, ou aborta dizendo qual falta."""
    valor = AMBIENTE.get(chave, "")
    if not valor:
        raise SystemExit(
            f"ERRO: chave ausente ou vazia em cfg_ambiente.txt: {chave}\n"
            f"      Ver config/cfg_ambiente.exemplo.txt."
        )
    return valor


# --- Qlik Cloud ---
QLIK_TENANT = _exigir("QLIK_TENANT")
QLIK_APP_ID = _exigir("QLIK_APP_ID")
QLIK_OBJ_ID = _exigir("QLIK_OBJ_ID")

# --- SMTP ---
SMTP_SERVIDOR       = _exigir("SMTP_SERVIDOR")
SMTP_PORTA          = int(_exigir("SMTP_PORTA"))
SMTP_USUARIO        = _exigir("SMTP_USUARIO")
REMETENTE           = _exigir("REMETENTE")
DESTINATARIO_ALERTA = _exigir("DESTINATARIO_ALERTA")

# Nome da tarefa no Agendador de Tarefas do Windows. Fica na configuração
# porque precisa bater exatamente com o que está registrado na máquina.
TAREFA_RELATORIO = _exigir("TAREFA_RELATORIO")

# Planilha de acordos: única dependência fora da pasta do projeto.
ACORDO_PATH = Path(_exigir("ACORDO_PATH"))

# Tempo máximo por subprocesso do pipeline. É opcional para manter
# compatibilidade com instalações existentes, mas valor inválido falha alto.
try:
    PIPELINE_TIMEOUT_S = int(AMBIENTE.get("PIPELINE_TIMEOUT_S", "1800"))
    if PIPELINE_TIMEOUT_S <= 0:
        raise ValueError
except ValueError:
    raise SystemExit("ERRO: PIPELINE_TIMEOUT_S deve ser um inteiro maior que zero.")
