"""Caminhos e configuração privada da instalação integrada."""
import os
from pathlib import Path

ALERTAS = Path(__file__).resolve().parent.parent
PRODUTO = ALERTAS.parent
PRIVADO = Path(os.environ.get("SUPPLY_VISION_PRIVADO", PRODUTO / "privado")).resolve()
OPERACAO = PRIVADO / "alertas"
CONFIG_DIR = OPERACAO / "config"
PROCESSO_DIR = ALERTAS / "processo"
DADOS_DIR = OPERACAO / "dados"
LOG_DIR = OPERACAO / "logs"
RELATORIOS_DIARIOS = OPERACAO / "relatorios" / "diarios"
RELATORIOS_HISTORICOS = OPERACAO / "relatorios" / "historicos"
BASE_PATH = DADOS_DIR / "base.xlsx"
CFG_QLIK = CONFIG_DIR / "cfg_qlik.txt"
CFG_AMBIENTE = CONFIG_DIR / "cfg_ambiente.txt"
DESTINATARIOS = CONFIG_DIR / "destinatarios.txt"
SMTP_CONFIG = PRIVADO / "comum" / "smtp.env"
PORTAL_CONFIG = PRIVADO / "portal" / "configuracao" / "portal.env"
SCRIPT_BAIXAR = PROCESSO_DIR / "baixar_base.py"
SCRIPT_RODAR = PROCESSO_DIR / "rodar.py"
SCRIPT_EMAIL = PROCESSO_DIR / "enviar_email.py"
PARAMETROS_SRC = ALERTAS
PARAMETROS_DIR = OPERACAO / "parametros"

def _carregar(path):
    try:
        linhas = path.read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError as exc:
        raise SystemExit(f"ERRO: configuração privada não encontrada: {path}") from exc
    valores = {}
    for numero, linha in enumerate(linhas, 1):
        texto = linha.strip()
        if not texto or texto.startswith("#"):
            continue
        if "=" not in texto:
            raise SystemExit(f"ERRO: linha inválida em {path} ({numero}): {texto!r}")
        chave, _, valor = texto.partition("=")
        valores[chave.strip().upper()] = valor.strip()
    return valores

def _exigir(valores, chave, origem):
    valor = valores.get(chave, "")
    if not valor:
        raise SystemExit(f"ERRO: chave ausente ou vazia em {origem}: {chave}")
    return valor

AMBIENTE = _carregar(CFG_AMBIENTE)
SMTP = _carregar(SMTP_CONFIG)
PORTAL = _carregar(PORTAL_CONFIG)
QLIK_TENANT = _exigir(AMBIENTE, "QLIK_TENANT", CFG_AMBIENTE)
QLIK_APP_ID = _exigir(AMBIENTE, "QLIK_APP_ID", CFG_AMBIENTE)
QLIK_OBJ_ID = _exigir(AMBIENTE, "QLIK_OBJ_ID", CFG_AMBIENTE)
DESTINATARIO_ALERTA = _exigir(AMBIENTE, "DESTINATARIO_ALERTA", CFG_AMBIENTE)
PORTAL_URL = _exigir(PORTAL, "PORTAL_URL", PORTAL_CONFIG).rstrip("/")
PORTAL_API_TOKEN = _exigir(PORTAL, "PORTAL_API_TOKEN", PORTAL_CONFIG)
SMTP_SERVIDOR = _exigir(SMTP, "SMTP_HOST", SMTP_CONFIG)
SMTP_PORTA = int(_exigir(SMTP, "SMTP_PORT", SMTP_CONFIG))
SMTP_USUARIO = _exigir(SMTP, "SMTP_USER", SMTP_CONFIG)
SMTP_SENHA = _exigir(SMTP, "SMTP_PASSWORD", SMTP_CONFIG)
REMETENTE = SMTP_USUARIO
NOME_REMETENTE = _exigir(SMTP, "EMAIL_FROM_NAME", SMTP_CONFIG)
try:
    PIPELINE_TIMEOUT_S = int(AMBIENTE.get("PIPELINE_TIMEOUT_S", "1800"))
    if PIPELINE_TIMEOUT_S <= 0:
        raise ValueError
except ValueError as exc:
    raise SystemExit("ERRO: PIPELINE_TIMEOUT_S deve ser um inteiro maior que zero.") from exc
