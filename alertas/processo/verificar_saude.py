"""
Verificador de saúde do pipeline.

Executado pelo supervisor residente, alguns minutos depois de cada horário
esperado de disparo. Confere se o pipeline concluiu naquele horário; se não
(log ausente ou log com erro), manda e-mail de alerta só para o responsável —
nunca para os destinatários do relatório nem para a cópia oculta.

LIMITE: roda no mesmo host e usa o mesmo SMTP do pipeline. Detecta pipeline
que não concluiu enquanto máquina, agendador, rede e SMTP continuam de pé.
Não cobre indisponibilidade do próprio host: máquina desligada ou sessão
encerrada param os dois, e nenhum alerta sai. Cobrir isso exigiria um monitor
em outro host.

Uso:
    python verificar_saude.py 0800
    python verificar_saude.py 1200
    python verificar_saude.py 1700
    python verificar_saude.py 1600

O argumento é o horário ESPERADO do disparo do pipeline (formato HHMM,
mesmo padrão do timestamp usado nos nomes de arquivo de log).
"""

import sys
import re
import pathlib
import smtplib
from email.message import EmailMessage
from datetime import datetime, date


import sv_paths

LOG_DIR      = str(sv_paths.LOG_DIR)
LOG_VERIF    = str(pathlib.Path(LOG_DIR) / f"verificacao_{datetime.now().strftime('%Y%m%d_%H%M')}.log")

SMTP_SERVIDOR   = sv_paths.SMTP_SERVIDOR
SMTP_PORTA      = sv_paths.SMTP_PORTA
SMTP_USUARIO    = sv_paths.SMTP_USUARIO
SMTP_SENHA      = sv_paths.SMTP_SENHA
REMETENTE       = sv_paths.REMETENTE
NOME_REMETENTE = sv_paths.NOME_REMETENTE
NOME_REMETENTE  = sv_paths.NOME_REMETENTE

DESTINATARIO_ALERTA = sv_paths.DESTINATARIO_ALERTA

TOLERANCIA_SEGUNDOS = 90

CHAVE_QLIK_EXPIRA = date(2027, 6, 23)
DIAS_AVISO_CHAVE  = {30, 15, 7, 3, 1}


def registrar(msg):
    linha = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(linha)
    pathlib.Path(LOG_DIR).mkdir(parents=True, exist_ok=True)
    with open(LOG_VERIF, "a", encoding="utf-8") as f:
        f.write(linha + "\n")


def _enviar_email(assunto, corpo):
    """Envia e-mail pela mesma infra SMTP do pipeline. Retorna True se saiu.
    Falha nunca sobe sem rastro: fica registrada no _verificacao.log."""
    try:
        senha = SMTP_SENHA

        msg = EmailMessage()
        msg["From"]    = f"{NOME_REMETENTE} <{REMETENTE}>"
        msg["To"]      = DESTINATARIO_ALERTA
        msg["Subject"] = assunto
        msg.set_content(corpo)

        with smtplib.SMTP(SMTP_SERVIDOR, SMTP_PORTA, timeout=60) as servidor:
            servidor.ehlo()
            servidor.starttls()
            servidor.ehlo()
            servidor.login(SMTP_USUARIO, senha)
            servidor.send_message(msg, to_addrs=[DESTINATARIO_ALERTA])
        return True
    except Exception as e:
        registrar(f"FALHA AO ENVIAR E-MAIL ({type(e).__name__}: {e}) — assunto: {assunto}")
        return False


def enviar_alerta(hhmm_esperado, motivo, detalhe):
    hh, mm = hhmm_esperado[:2], hhmm_esperado[2:]
    hoje = datetime.now().strftime("%d/%m/%Y")

    assunto = f"[ALERTA SUPPLYVISION] Pipeline não concluiu — {hh}:{mm} de {hoje}"
    corpo = (
        f"O verificador de saúde do SupplyVision não confirmou a conclusão "
        f"do pipeline agendado para {hh}:{mm} de hoje ({hoje}).\n\n"
        f"Motivo: {motivo}\n\n"
        f"{detalhe}\n\n"
        f"— Verificação automática, sem intervenção humana."
    )

    if _enviar_email(assunto, corpo):
        registrar(f"ALERTA ENVIADO — {motivo} — {hh}:{mm}")


def checar_expiracao_chave(hhmm_esperado):
    """Aviso proativo da expiração da chave de API do Qlik.
    Só roda no slot das 08:00 e só em dias-marco (ou diariamente se expirada)."""
    if hhmm_esperado != "0800":
        return
    dias = (CHAVE_QLIK_EXPIRA - date.today()).days
    if dias > 0 and dias not in DIAS_AVISO_CHAVE:
        return

    if dias > 0:
        assunto = f"[SUPPLYVISION] Chave Qlik expira em {dias} dia(s) — {CHAVE_QLIK_EXPIRA.strftime('%d/%m/%Y')}"
        corpo = (
            f"Lembrete proativo: a chave de API do Qlik Cloud expira em "
            f"{CHAVE_QLIK_EXPIRA.strftime('%d/%m/%Y')} — faltam {dias} dia(s).\n\n"
            f"Renovar ANTES da data, para o pipeline não parar:\n"
            f"  1. Gerar nova chave em https://{sv_paths.QLIK_TENANT}/settings/api-keys\n"
            f"  2. Substituir o conteúdo de config\\cfg_qlik.txt\n\n"
            f"Detalhes na seção sobre a chave de API do Qlik, no README.\n\n"
            f"— Verificação automática, sem intervenção humana."
        )
    else:
        assunto = f"[ALERTA SUPPLYVISION] Chave Qlik EXPIRADA desde {CHAVE_QLIK_EXPIRA.strftime('%d/%m/%Y')}"
        corpo = (
            f"A chave de API do Qlik Cloud expirou em {CHAVE_QLIK_EXPIRA.strftime('%d/%m/%Y')}. "
            f"O pipeline vai falhar na autenticação até a chave ser renovada.\n\n"
            f"  1. Gerar nova chave em https://{sv_paths.QLIK_TENANT}/settings/api-keys\n"
            f"  2. Substituir o conteúdo de config\\cfg_qlik.txt\n\n"
            f"— Verificação automática, sem intervenção humana."
        )

    if _enviar_email(assunto, corpo):
        registrar(f"AVISO DE EXPIRAÇÃO DA CHAVE QLIK enviado — {dias} dia(s) restante(s)")


def encontrar_log(hhmm_esperado, run_id=None):
    """Procura, entre os logs de HOJE, um cujo timestamp esteja dentro da
    tolerância do horário esperado. Ignora execuções manuais fora da janela
    (ex.: um disparo às 08:41 não deve mascarar a ausência do de 08:00)."""
    if run_id is not None:
        if not re.fullmatch(r"\d{8}_\d{6}_[0-9A-Za-z]+", run_id):
            return None
        log_exato = pathlib.Path(LOG_DIR) / f"pipeline_{run_id}.log"
        return log_exato if log_exato.is_file() else None

    hoje = datetime.now().strftime("%Y%m%d")
    pasta = pathlib.Path(LOG_DIR)
    esperado_dt = datetime.strptime(hhmm_esperado, "%H%M")

    for arq in pasta.glob(f"pipeline_{hoje}_*.log"):
        m = re.fullmatch(
            r"pipeline_\d{8}_(\d{4})(\d{2})?(?:_[0-9A-Za-z]+)?\.log",
            arq.name,
        )
        if not m:
            continue
        stamp_dt = datetime.strptime(m.group(1) + (m.group(2) or "00"), "%H%M%S")
        if abs((stamp_dt - esperado_dt).total_seconds()) <= TOLERANCIA_SEGUNDOS:
            return arq
    return None


def verificar(hhmm_esperado, run_id=None):
    hh, mm = hhmm_esperado[:2], hhmm_esperado[2:]

    log = encontrar_log(hhmm_esperado, run_id)

    if log is None:
        registrar(f"FALHA — nenhum log encontrado para {hh}:{mm}")
        enviar_alerta(
            hhmm_esperado,
            motivo="Log ausente",
            detalhe=(
                "Nenhum arquivo de log foi encontrado para este horário, dentro "
                f"de uma tolerância de {TOLERANCIA_SEGUNDOS}s. Causa mais "
                "provável: máquina desligada ou sessão encerrada no horário do "
                "disparo. O supervisor residente pode ter sido interrompido ou "
                "a execução pode ter falhado antes de criar o log."
            )
        )
        return

    conteudo = log.read_text(encoding="utf-8", errors="replace")

    if "CONCLUÍDO COM SUCESSO" in conteudo or "AVISO ENVIADO" in conteudo:
        registrar(f"OK — {log.name}")
        return

    linhas = conteudo.strip().splitlines()
    trecho = "\n".join(linhas[-15:])
    registrar(f"FALHA — {log.name} não confirma sucesso")
    enviar_alerta(
        hhmm_esperado,
        motivo=f"Pipeline rodou mas não concluiu (log: {log.name})",
        detalhe=f"Últimas linhas do log:\n\n{trecho}"
    )


if __name__ == "__main__":
    if len(sys.argv) < 2 or not re.match(r"^\d{4}$", sys.argv[1]):
        registrar("ERRO: argumento de horário esperado ausente ou inválido (formato HHMM).")
        sys.exit(1)

    dow = datetime.now().weekday()
    if dow > 4:
        registrar("Fim de semana — verificação não se aplica, encerrando.")
        sys.exit(0)

    checar_expiracao_chave(sys.argv[1])
    verificar(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
