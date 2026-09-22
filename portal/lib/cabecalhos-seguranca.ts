// Cabecalhos de seguranca em um lugar so.
//
// Estavam declarados duas vezes, com strings identicas, em middleware.ts e
// next.config.ts. Editar um e esquecer o outro nao daria erro nenhum: a
// pagina continuaria servida, com a politica antiga em algum dos caminhos.
//
// frame-src libera o app.powerbi.com porque a aba "Manutencao" emoldura um
// relatorio publicado la. 'unsafe-inline' em script-src e exigido pelo
// runtime de componentes do servidor; sair dele depende de nonce por
// requisicao, que o vinext ainda nao expoe.
export const CABECALHOS_SEGURANCA: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; frame-src https://app.powerbi.com",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
