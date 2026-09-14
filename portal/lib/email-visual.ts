/**
 * Casca visual dos e-mails do Supply Vision.
 *
 * Espelho de alertas/processo/email_visual.py — os dois precisam andar juntos.
 * Se a paleta mudar aqui, mude lá também.
 *
 * Por que HTML de tabela com estilo inline: cliente de e-mail não é navegador.
 * O Outlook renderiza com o motor do Word, que descarta JavaScript, CSS
 * externo, flexbox, grid, SVG e media queries. Bibliotecas web não funcionam
 * neste contexto.
 */

export const paleta = {
  fundo: '#f3f6f8',
  cartao: '#ffffff',
  borda: '#dde4e8',
  cabecalho: '#0a1420',
  destaque: '#81e6d9',
  texto: '#17212b',
  secundario: '#52606d',
  rodapeFundo: '#f7f9fa',
  rodapeTexto: '#687782',
  acao: '#0f766e',
} as const;

export const escapar = (valor: string | number | null | undefined) =>
  String(valor ?? '').replace(/[&<>'"]/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[caractere]!));

export type BotaoEmail = { texto: string; url: string };

/** Envolve o conteúdo já montado (e já escapado) na casca do produto. */
export function montarCasca(
  titulo: string,
  subtitulo: string,
  conteudo: string,
  botao?: BotaoEmail,
  rodape = 'Mensagem automática do Supply Vision.',
) {
  const linhaBotao = botao
    ? `<p style="margin:26px 0 0"><a href="${escapar(botao.url)}" style="display:inline-block;background:${paleta.acao};color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px">${escapar(botao.texto)}</a></p>`
    : '';
  const linhaSubtitulo = subtitulo
    ? `<p style="margin:0 0 24px;color:${paleta.secundario}">${escapar(subtitulo)}</p>`
    : '';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:${paleta.fundo};font-family:Arial,sans-serif;color:${paleta.texto}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${paleta.fundo};padding:24px"><tr><td align="center"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;width:100%;background:${paleta.cartao};border:1px solid ${paleta.borda};border-radius:14px;overflow:hidden"><tr><td style="background:${paleta.cabecalho};padding:22px 28px;color:#fff"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${paleta.destaque}">Ambiente corporativo</div><div style="margin-top:5px;font-size:20px;font-weight:700">Supply Vision</div></td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 8px;font-size:22px">${escapar(titulo)}</h1>${linhaSubtitulo}${conteudo}${linhaBotao}</td></tr><tr><td style="padding:18px 28px;background:${paleta.rodapeFundo};color:${paleta.rodapeTexto};font-size:12px">${escapar(rodape)}</td></tr></table></td></tr></table></body></html>`;
}
