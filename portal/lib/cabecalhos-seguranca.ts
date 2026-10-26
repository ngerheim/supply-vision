// Cabecalhos de seguranca em um lugar so.
//
// Estavam declarados duas vezes, com strings identicas, em middleware.ts e
// next.config.ts. Editar um e esquecer o outro nao daria erro nenhum: a
// pagina continuaria servida, com a politica antiga em algum dos caminhos.
//
// frame-src libera o app.powerbi.com porque a aba "Manutencao" emoldura um
// relatorio publicado la. O middleware fornece o nonce por requisicao ao runtime.
export const CABECALHOS_SEGURANCA: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-src https://app.powerbi.com",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export const CABECALHOS_MARCA = {
  'content-type': 'image/svg+xml',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'cache-control': 'public, max-age=60',
};

export function cabecalhosComNonce(nonce: string): Record<string, string> {
  if (!/^[A-Za-z0-9+/_=-]+$/.test(nonce)) throw new Error('Nonce invalido.');
  return { ...CABECALHOS_SEGURANCA,
    'Content-Security-Policy': CABECALHOS_SEGURANCA['Content-Security-Policy'].replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`),
  };
}
