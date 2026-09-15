import smtplib
import os
import pathlib
import sys
import re
import json
from email.message import EmailMessage
from datetime import datetime

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


import sv_paths
import email_visual

SMTP_SERVIDOR  = sv_paths.SMTP_SERVIDOR
SMTP_PORTA     = sv_paths.SMTP_PORTA
SMTP_USUARIO   = sv_paths.SMTP_USUARIO

SMTP_SENHA      = sv_paths.SMTP_SENHA
REMETENTE      = sv_paths.REMETENTE
NOME_REMETENTE = sv_paths.NOME_REMETENTE

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


def carregar_contexto():
    """Lê contexto e datas passados pelo pipeline via sys.argv."""
    contexto = sys.argv[1] if len(sys.argv) > 1 else "parcial"
    datas    = sys.argv[2].split(",") if len(sys.argv) > 2 else [datetime.now().strftime("%d/%m/%Y")]
    output   = sys.argv[3] if len(sys.argv) > 3 else ""
    return contexto, datas, output


def montar_assunto(contexto, datas):
    if contexto == "segunda_manha":
        return f"Conformidade de Preços — Sexta + Sábado | {datas[0]} e {datas[1]}"
    elif contexto == "manha":
        return f"Conformidade de Preços — Dia Anterior | {datas[0]}"
    elif contexto == "parcial":
        return f"Conformidade de Preços — Parcial | {datas[0]}"
    else:
        return f"Conformidade de Preços — Compilado Final | {datas[0]}"


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


def montar_corpo(contexto, datas, output, com_acordo=None):
    """Corpo enxuto: quantas linhas estao fora do acordo, e nada mais.

    A analise detalhada e feita no recorte historico, que compila os problemas
    a sanar. Repeti-la aqui so produzia um corpo descartavel: tabela de zeros,
    percentuais e alertas que ninguem acionava.
    """
    agora = datetime.now().strftime("%d/%m/%Y às %H:%M")

    if contexto == "segunda_manha":
        periodo = f"sexta-feira ({datas[0]}) e sábado ({datas[1]})"
    elif contexto == "manha":
        periodo = f"o dia anterior ({datas[0]})"
    elif contexto == "parcial":
        periodo = f"{datas[0]}, até {agora}"
    else:
        periodo = f"{datas[0]} (fechamento do dia)"

    _, dados = extrair_resumo(output)
    c = dados["contagens"]
    fora = c["ACIMA DO ACORDO"] + c["ABAIXO DO ACORDO"]

    if fora == 0:
        linha = f"Nenhum registro fora do acordo em {periodo}."
    elif fora == 1:
        linha = f"1 registro fora do acordo em {periodo}. Detalhes no anexo."
    else:
        linha = f"{fora} registros fora do acordo em {periodo}. Detalhes no anexo."

    return linha + "\n"


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

    Nunca busca arquivo antigo na pasta, evitando anexos obsoletos.
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


def enviar_email(assunto, corpo, anexos, destinatarios, html=None):
    senha = SMTP_SENHA

    msg = EmailMessage()
    msg["From"]    = f"{NOME_REMETENTE} <{REMETENTE}>"
    msg["To"]      = ", ".join(destinatarios)
    msg["Subject"] = assunto
    # O texto puro continua sendo a versao principal: e o que aparece em
    # cliente sem HTML e em pre-visualizacao. O HTML e alternativa.
    msg.set_content(corpo)
    if html:
        msg.add_alternative(html, subtype="html")

    # O tipo vem da extensao: rotular um CSV como planilha xlsx fazia o Excel
    # recusar o anexo de qualidade dos acordos.
    tipos = {
        ".xlsx": ("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ".xls": ("application", "vnd.ms-excel"),
        ".csv": ("text", "csv"),
    }
    for anexo in anexos:
        if anexo:
            caminho = pathlib.Path(anexo)
            maintype, subtype = tipos.get(caminho.suffix.lower(), ("application", "octet-stream"))
            msg.add_attachment(
                caminho.read_bytes(),
                maintype=maintype,
                subtype=subtype,
                filename=caminho.name
            )
            print(f"  Anexo adicionado: {caminho.name}")

    entrega = list(destinatarios) + list(COPIA_OCULTA)

    if os.environ.get("SUPPLY_VISION_SEM_ENVIO") == "1":
        pasta = pathlib.Path(getattr(sv_paths, "RELATORIOS_DIARIOS", pathlib.Path.cwd())) / "previews-email"
        pasta.mkdir(parents=True, exist_ok=True)
        run_id = re.sub(r"[^0-9A-Za-z_-]", "_", os.environ.get("SUPPLY_VISION_RUN_ID", datetime.now().strftime("%Y%m%d_%H%M%S")))
        destino = pasta / f"email_{run_id}.eml"
        destino.write_bytes(msg.as_bytes())
        print(f"MODO SEM ENVIO: e-mail salvo para conferencia em {destino}")
        return destino

    with smtplib.SMTP(SMTP_SERVIDOR, SMTP_PORTA, timeout=60) as servidor:
        servidor.ehlo()
        servidor.starttls()
        servidor.ehlo()
        servidor.login(SMTP_USUARIO, senha)
        servidor.send_message(msg, to_addrs=entrega)

    print(f"E-mail enviado para: {', '.join(destinatarios)}")
    if COPIA_OCULTA:
        print(f"  (Cco: {', '.join(COPIA_OCULTA)})")


def montar_aviso(situacao, datas):
    """Avisos sem anexo: uma frase, sem analise."""
    periodo = " e ".join(datas)

    if situacao == "SEM_DADOS_QLIK":
        assunto = f"Conformidade de Preços — Sem dados no Qlik | {periodo}"
        corpo = f"Não havia dados no Qlik para {periodo}.\n"
    else:
        assunto = f"Conformidade de Preços — Nada dentro dos filtros | {periodo}"
        corpo = f"Não havia nada dentro dos filtros para {periodo}.\n"
    return assunto, corpo


if __name__ == "__main__":
    contexto, datas, output = carregar_contexto()

    situacao = sys.argv[4] if len(sys.argv) > 4 else ""

    if situacao in ("SEM_DADOS_QLIK", "SEM_DADOS_FILTRO"):
        print(f"Nenhum e-mail enviado: {situacao}.")
        sys.exit(0)

    try:
        com_acordo = anexo_da_execucao(sys.argv[5] if len(sys.argv) > 5 else "", "com_acordo")
        # Qualidade dos acordos: o pipeline so informa o caminho quando ha
        # pendencias a corrigir. Vazio aqui significa base limpa, nao falha.
        qualidade = anexo_da_execucao(sys.argv[6] if len(sys.argv) > 6 else "", "qualidade_acordos")
    except RelatorioAusente as e:
        print(f"ERRO: {e}")
        sys.exit(1)

    assunto = montar_assunto(contexto, datas)
    corpo   = montar_corpo(contexto, datas, output, com_acordo)

    print(f"Assunto: {assunto}")
    avisos = []
    if qualidade:
        avisos.append("A base de acordos tem pendências a corrigir; veja o CSV anexo.")
    html = email_visual.montar_html("Conformidade de Preços", [corpo.strip()] + avisos)
    enviar_email(assunto, corpo, [com_acordo, qualidade], DESTINATARIOS, html=html)
