"""Casca visual dos e-mails do Supply Vision.

Mesma identidade dos e-mails do Portal: cabecalho escuro, corpo branco e
rodape discreto. A paleta vem de portal/lib/email-chamados.ts.

Por que HTML de tabela e estilo inline: cliente de e-mail nao e navegador. O
Outlook renderiza com o motor do Word, que ignora JavaScript, folhas de estilo
externas, flexbox, grid e SVG. Tabela aninhada com CSS inline e imagem PNG e o
que chega inteiro em todos os clientes.
"""

# Paleta compartilhada com o Portal
FUNDO = "#f3f6f8"
CARTAO = "#ffffff"
BORDA = "#dde4e8"
CABECALHO = "#0a1420"
DESTAQUE = "#81e6d9"
TEXTO = "#17212b"
SECUNDARIO = "#52606d"
RODAPE_FUNDO = "#f7f9fa"
RODAPE_TEXTO = "#687782"

_ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}


def escapar(valor):
    return "".join(_ESCAPES.get(c, c) for c in str(valor if valor is not None else ""))


def montar_html(titulo, linhas, rodape="Mensagem automática do Supply Vision."):
    """Monta o HTML do e-mail.

    titulo  cabecalho do cartao (ex.: "Conformidade de Preços")
    linhas  lista de paragrafos do corpo, ja em texto puro
    """
    paragrafos = "".join(
        f'<p style="margin:0 0 14px;line-height:1.55;font-size:15px">{escapar(l)}</p>'
        for l in linhas if l
    )
    return (
        '<!doctype html><html lang="pt-BR"><body style="margin:0;background:'
        f'{FUNDO};font-family:Arial,sans-serif;color:{TEXTO}">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        f'style="background:{FUNDO};padding:24px"><tr><td align="center">'
        '<table role="presentation" width="620" cellspacing="0" cellpadding="0" '
        f'style="max-width:620px;width:100%;background:{CARTAO};border:1px solid '
        f'{BORDA};border-radius:14px;overflow:hidden">'
        f'<tr><td style="background:{CABECALHO};padding:22px 28px;color:#fff">'
        '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;'
        f'color:{DESTAQUE}">Ambiente corporativo</div>'
        '<div style="margin-top:5px;font-size:20px;font-weight:700">Supply Vision</div>'
        '</td></tr>'
        f'<tr><td style="padding:28px"><h1 style="margin:0 0 18px;font-size:20px">'
        f'{escapar(titulo)}</h1>{paragrafos}</td></tr>'
        f'<tr><td style="padding:18px 28px;background:{RODAPE_FUNDO};'
        f'color:{RODAPE_TEXTO};font-size:12px">{escapar(rodape)}</td></tr>'
        '</table></td></tr></table></body></html>'
    )
