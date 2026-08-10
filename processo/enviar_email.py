import smtplib
import pathlib
import sys
import re
import json
from email.message import EmailMessage
from datetime import datetime

# O console do Windows abre em cp1252, e as mensagens usam acentos. Chamado
# pelo pipeline.py a codificação vinha ajustada por fora, mas este script
# executado à mão para depurar morria com UnicodeEncodeError. Cada script
# deve se bastar — mesma correção que existe no topo do rodar.py.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# ═══════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO
# ═══════════════════════════════════════════════════════════════════

# --- Servidor SMTP (mesma config do Outlook: saída) ---
# Valores em config/cfg_ambiente.txt — fora do repositório Git.
import sv_paths

SMTP_SERVIDOR  = sv_paths.SMTP_SERVIDOR
SMTP_PORTA     = sv_paths.SMTP_PORTA
SMTP_USUARIO   = sv_paths.SMTP_USUARIO

SMTP_SENHA_PATH = str(sv_paths.CFG_SMTP)
REMETENTE      = sv_paths.REMETENTE

# Destinatários e Cco ficam em destinatarios.txt (seções [PARA] e
# [CCO]) — editar LÁ, não aqui. Vale a partir do disparo seguinte à edição.
DESTINATARIOS_PATH = str(sv_paths.DESTINATARIOS)

def carregar_destinatarios(path=DESTINATARIOS_PATH):
    """Lê destinatarios.txt e devolve (destinatarios, copia_oculta).

    Falha ALTO se o arquivo estiver ausente, sem [PARA] preenchido ou com
    linha inválida — o pipeline registra o erro e o watchdog avisa. Um
    fallback silencioso para lista fixa enviaria e-mail à relação errada
    sem ninguém perceber (mesma classe de bug do anexo obsoleto de 29/06).
    """
    try:
        linhas = pathlib.Path(path).read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError:
        print(f"ERRO: arquivo de destinatários não encontrado: {path}")
        sys.exit(1)
    secao, para, cco = None, [], []
    for ln in linhas:
        t = ln.strip()
        if not t or t.startswith("#"):
            continue
        if t.upper() == "[PARA]":
            secao = para
            continue
        if t.upper() == "[CCO]":
            secao = cco
            continue
        if secao is None or "@" not in t or any(ch in t for ch in " ,;"):
            print(f"ERRO: linha inválida em destinatarios.txt: {t!r}")
            print("      Formato: seções [PARA] e [CCO], UM e-mail por linha.")
            sys.exit(1)
        secao.append(t)
    if not para:
        print("ERRO: nenhum destinatário na seção [PARA] de destinatarios.txt.")
        sys.exit(1)
    return para, cco

DESTINATARIOS, COPIA_OCULTA = carregar_destinatarios()

# ═══════════════════════════════════════════════════════════════════
# CONTEXTO (passado pelo pipeline via argumentos)
# ═══════════════════════════════════════════════════════════════════

def carregar_contexto():
    """Lê contexto e datas passados pelo pipeline via sys.argv."""
    contexto = sys.argv[1] if len(sys.argv) > 1 else "parcial"
    datas    = sys.argv[2].split(",") if len(sys.argv) > 2 else [datetime.now().strftime("%d/%m/%Y")]
    output   = sys.argv[3] if len(sys.argv) > 3 else ""
    return contexto, datas, output

# ═══════════════════════════════════════════════════════════════════
# ASSUNTO
# ═══════════════════════════════════════════════════════════════════

def montar_assunto(contexto, datas):
    if contexto == "segunda_manha":
        return f"Conformidade de Preços — Sexta + Sábado | {datas[0]} e {datas[1]}"
    elif contexto == "manha":
        return f"Conformidade de Preços — Dia Anterior | {datas[0]}"
    elif contexto == "parcial":
        return f"Conformidade de Preços — Parcial | {datas[0]}"
    else:
        return f"Conformidade de Preços — Compilado Final | {datas[0]}"

# ═══════════════════════════════════════════════════════════════════
# RESUMO DO OUTPUT DO rodar.py
# ═══════════════════════════════════════════════════════════════════

def extrair_resumo(output):
    """Extrai o marcador estruturado; não depende de frases humanas."""
    filtros  = re.findall(r"Filtro (.+?): ([\d,]+) linhas removidas", output)
    marcador = re.search(r"^RESUMO_JSON=(.+)$", output, re.MULTILINE)
    if not marcador:
        raise ValueError("RESUMO_JSON ausente no output de rodar.py")
    resumo_dados = json.loads(marcador.group(1))

    linhas_filtros = ""
    for motivo, qtd in filtros:
        linhas_filtros += f"  {motivo}: {qtd} linhas removidas\n"

    resumo = ""
    if linhas_filtros:
        resumo += "FILTROS APLICADOS\n"
        resumo += "─" * 40 + "\n"
        resumo += linhas_filtros + "\n"

    resumo += "RESUMO\n"
    resumo += "─" * 40 + "\n"
    c = resumo_dados["contagens"]
    p = resumo_dados["percentuais_elegiveis"]
    resumo += f"  Total bruto:        {resumo_dados['total_bruto']} linhas\n"
    resumo += f"  Linhas comparáveis: {resumo_dados['total_elegivel']} linhas\n"
    resumo += f"  Conformes:          {c['CONFORME']}  ({p['CONFORME']}% dos elegíveis)\n"
    resumo += f"  Acima do acordo:    {c['ACIMA DO ACORDO']}  ({p['ACIMA DO ACORDO']}% dos elegíveis)\n"
    resumo += f"  Abaixo do acordo:   {c['ABAIXO DO ACORDO']}  ({p['ABAIXO DO ACORDO']}% dos elegíveis)\n"
    resumo += f"  Sem cobertura:      {c['SEM ACORDO']}  ({p['SEM ACORDO']}% dos elegíveis)\n"
    resumo += f"  Pendências:         {resumo_dados['total_quarentena']}  ({resumo_dados['percentual_quarentena_bruto']}% do bruto)\n"
    if not resumo_dados["comparavel"]:
        resumo += "\n  Nenhuma linha ficou comparável devido a referências inconclusivas.\n"
    if resumo_dados["alerta_sem_acordo"]:
        resumo += (f"\nALERTA: ausência de cobertura em {p['SEM ACORDO']}% dos elegíveis, "
                   f"acima do limite de {resumo_dados['limite_alerta_sem_acordo']}%.\n")
    return resumo, resumo_dados

# ═══════════════════════════════════════════════════════════════════
# CORPO
# ═══════════════════════════════════════════════════════════════════

def montar_corpo(contexto, datas, output, com_acordo=None, sem_acordo=None, pendencias=None):
    agora = datetime.now().strftime("%d/%m/%Y às %H:%M")

    if contexto == "segunda_manha":
        intro = f"Seguem os relatórios referentes a sexta-feira ({datas[0]}) e sábado ({datas[1]})."
    elif contexto == "manha":
        intro = f"Seguem os relatórios referentes ao dia anterior ({datas[0]})."
    elif contexto == "parcial":
        intro = f"Seguem os relatórios parciais de {datas[0]} até o momento ({agora})."
    else:
        intro = f"Seguem os relatórios compilados de {datas[0]} (fechamento do dia)."

    resumo, dados = extrair_resumo(output)

    obs = ""
    if not dados["comparavel"]:
        obs = ("Obs.: nenhuma linha ficou comparável porque todas dependiam de "
               "referências inconclusivas; consulte o relatório de pendências.\n\n")
    elif not com_acordo:
        obs = ("Obs.: nenhum item do período casou com acordo de preço — "
               "o relatório \"Com acordo\" não foi gerado; segue apenas o \"Sem acordo\".\n\n")
    elif not sem_acordo:
        obs = ("Obs.: todos os itens do período casaram com acordos de preço — "
               "o relatório \"Sem acordo\" não foi gerado; segue apenas o \"Com acordo\".\n\n")

    corpo = (
        f"Olá,\n\n"
        f"{intro}\n\n"
        f"{resumo}\n"
        f"{obs}"
    ).rstrip() + "\n"
    return corpo

# ═══════════════════════════════════════════════════════════════════
# ANEXOS
# ═══════════════════════════════════════════════════════════════════

class RelatorioAusente(RuntimeError):
    """O pipeline indicou um relatório que não existe no disco."""


def anexo_da_execucao(caminho, rotulo):
    """Valida o caminho de relatório passado pelo pipeline (gerado NESTA execução).

    Três estados, e confundir os dois últimos já produziu e-mail falso:

      caminho vazio      o rodar.py não gerou este relatório — não havia item
                         na categoria. Devolve None, e o corpo explica.
      caminho inexistente o pipeline disse que gerou e o arquivo não está lá.
                         Isso é falha, não ausência de dados: abortar. Enviar
                         mesmo assim faria o corpo afirmar que a categoria
                         estava vazia, o que é mentira.
      caminho válido     devolve o Path.

    NUNCA busca arquivo antigo na pasta — era isso que fazia o e-mail sair com
    anexo obsoleto (caso de 29/06 12:00).
    """
    if not caminho:
        return None
    p = pathlib.Path(caminho)
    if not p.is_file():
        raise RelatorioAusente(
            f"O pipeline indicou o relatório '{rotulo}' em {caminho}, "
            f"mas o arquivo não existe.\n"
            f"   E-mail não enviado: o corpo diria que não houve item nessa "
            f"categoria, e isso seria falso."
        )
    return p

# ═══════════════════════════════════════════════════════════════════
# ENVIO VIA SMTP
# ═══════════════════════════════════════════════════════════════════

def enviar_email(assunto, corpo, anexos, destinatarios):
    senha = pathlib.Path(SMTP_SENHA_PATH).read_text(encoding="utf-8-sig").strip()

    msg = EmailMessage()
    msg["From"]    = REMETENTE
    msg["To"]      = ", ".join(destinatarios)
    msg["Subject"] = assunto
    msg.set_content(corpo)
    # OBS: a cópia oculta (Cco) NÃO entra no cabeçalho — assim os destinatários
    # não a enxergam. Ela só é incluída na lista de entrega do servidor abaixo.

    # Anexos
    for anexo in anexos:
        if anexo:
            dados = pathlib.Path(anexo).read_bytes()
            msg.add_attachment(
                dados,
                maintype="application",
                subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                filename=pathlib.Path(anexo).name
            )
            print(f"  Anexo adicionado: {pathlib.Path(anexo).name}")

    # Lista completa de entrega = destinatários visíveis + cópia oculta
    entrega = list(destinatarios) + list(COPIA_OCULTA)

    # Conexão na porta 587 (submissão) com STARTTLS — autenticação cifrada
    with smtplib.SMTP(SMTP_SERVIDOR, SMTP_PORTA, timeout=60) as servidor:
        servidor.ehlo()
        servidor.starttls()   # sobe a conexão pra TLS ANTES de autenticar
        servidor.ehlo()       # re-apresenta sobre o canal já cifrado
        servidor.login(SMTP_USUARIO, senha)
        servidor.send_message(msg, to_addrs=entrega)

    print(f"E-mail enviado para: {', '.join(destinatarios)}")
    if COPIA_OCULTA:
        print(f"  (Cco: {', '.join(COPIA_OCULTA)})")

# ═══════════════════════════════════════════════════════════════════
# AVISO — quando não há nada a reportar
# ═══════════════════════════════════════════════════════════════════

def montar_aviso(situacao, datas):
    """Monta assunto e corpo do e-mail de aviso (sem anexos)."""
    agora = datetime.now().strftime("%d/%m/%Y às %H:%M")
    periodo = " e ".join(datas)

    if situacao == "SEM_DADOS_QLIK":
        assunto = f"Conformidade de Preços — Sem dados no Qlik | {periodo}"
        corpo = (
            f"Olá,\n\n"
            f"Não foram encontrados lançamentos no Qlik para {periodo} "
            f"até o momento ({agora}). Nenhum relatório foi gerado.\n"
        )
    else:  # SEM_DADOS_FILTRO
        assunto = f"Conformidade de Preços — Nada dentro dos filtros | {periodo}"
        corpo = (
            f"Olá,\n\n"
            f"Foram encontrados lançamentos no Qlik para {periodo}, mas nenhum "
            f"se enquadrou nos critérios de análise (filtros de grupo, modelo, "
            f"fornecedor e item). Nenhum relatório foi gerado.\n"
        )
    return assunto, corpo

# ═══════════════════════════════════════════════════════════════════
# EXECUÇÃO
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    contexto, datas, output = carregar_contexto()

    # 4º argumento opcional: situação de aviso (SEM_DADOS_QLIK / SEM_DADOS_FILTRO)
    situacao = sys.argv[4] if len(sys.argv) > 4 else ""

    if situacao in ("SEM_DADOS_QLIK", "SEM_DADOS_FILTRO"):
        assunto, corpo = montar_aviso(situacao, datas)
        print(f"Assunto (aviso): {assunto}")
        enviar_email(assunto, corpo, [], DESTINATARIOS)
        sys.exit(0)

    # Caminhos dos relatórios gerados NESTA execução (argv 5 a 7, via pipeline).
    try:
        com_acordo = anexo_da_execucao(sys.argv[5] if len(sys.argv) > 5 else "", "com_acordo")
        sem_acordo = anexo_da_execucao(sys.argv[6] if len(sys.argv) > 6 else "", "sem_acordo")
        pendencias = anexo_da_execucao(sys.argv[7] if len(sys.argv) > 7 else "", "pendencias")
    except RelatorioAusente as e:
        print(f"ERRO: {e}")
        sys.exit(1)

    if not com_acordo and not sem_acordo and not pendencias:
        print("ERRO: Nenhum relatório desta execução foi informado. E-mail não enviado.")
        print("      (Este script deve ser chamado pelo pipeline.py, que passa os caminhos.)")
        sys.exit(1)

    assunto = montar_assunto(contexto, datas)
    corpo   = montar_corpo(contexto, datas, output, com_acordo, sem_acordo, pendencias)

    print(f"Assunto: {assunto}")
    enviar_email(assunto, corpo, [com_acordo, sem_acordo, pendencias], DESTINATARIOS)
