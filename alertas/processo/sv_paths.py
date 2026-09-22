"""Caminhos e configuração privada da instalação integrada."""
import os
from datetime import datetime
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

def _carregar_opcional(path):
    """Configuração de integração pode não existir em testes isolados/CI."""
    try:
        return _carregar(path)
    except SystemExit:
        return {}

def _exigir(valores, chave, origem):
    valor = valores.get(chave, "")
    if not valor:
        raise SystemExit(f"ERRO: chave ausente ou vazia em {origem}: {chave}")
    return valor

AMBIENTE = _carregar(CFG_AMBIENTE)
SMTP = _carregar(SMTP_CONFIG)
PORTAL = _carregar_opcional(PORTAL_CONFIG)
QLIK_TENANT = _exigir(AMBIENTE, "QLIK_TENANT", CFG_AMBIENTE)
QLIK_APP_ID = _exigir(AMBIENTE, "QLIK_APP_ID", CFG_AMBIENTE)
QLIK_OBJ_ID = _exigir(AMBIENTE, "QLIK_OBJ_ID", CFG_AMBIENTE)
DESTINATARIO_ALERTA = _exigir(AMBIENTE, "DESTINATARIO_ALERTA", CFG_AMBIENTE)
PORTAL_URL = PORTAL.get("PORTAL_URL", "").rstrip("/")
PORTAL_API_TOKEN = PORTAL.get("PORTAL_API_TOKEN", "")
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


def _data_de(chave, padrao):
    """Data de configuracao no formato AAAA-MM-DD.

    Regra de negocio com data fixa dentro do codigo e invisivel para quem
    opera: quando chega o dia, o comportamento muda e ninguem sabe por que.
    O padrao preserva o valor que ja valia.
    """
    texto = AMBIENTE.get(chave, "").strip() or padrao
    try:
        return datetime.strptime(texto, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit(f"ERRO: {chave} deve estar no formato AAAA-MM-DD; veio {texto!r}.") from exc


# A partir desta data, situacao e intervalo de vigencia dos acordos passam a
# ser respeitados no cruzamento. Antes dela, vale a tabela vigente atual.
CORTE_VIGENCIA_ACORDOS = _data_de("CORTE_VIGENCIA_ACORDOS", "2026-09-18")
# Expiracao da chave de API do Qlik, usada so para avisar com antecedencia.
CHAVE_QLIK_EXPIRA = _data_de("CHAVE_QLIK_EXPIRA", "2027-06-23")
