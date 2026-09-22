// Custo do PBKDF2. A recomendacao atual da OWASP para PBKDF2-HMAC-SHA256 e
// 600 mil iteracoes; medido nesta maquina, 600k leva ~220ms, o que cabe no
// login sem incomodar.
//
// O numero de iteracoes fica gravado JUNTO de cada hash. Sem isso, elevar o
// custo invalidaria todas as senhas existentes de uma vez -- ninguem
// conseguiria mais entrar. Assim, hashes antigos continuam sendo conferidos
// com o custo antigo e sao regravados no proximo login bem-sucedido.
export const PBKDF2_ITERACOES_ATUAL = 600000;
export const PBKDF2_ITERACOES_LEGADO = 120000;

const hex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

export async function passwordHash(password: string, salt: string, iterations = PBKDF2_ITERACOES_ATUAL) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations }, key, 256);
  return hex(new Uint8Array(bits));
}

// O token da sessao passa a ser guardado apenas como hash. Se o banco vazar,
// os tokens nao podem ser reaproveitados: o valor real so existe no cookie.
// SHA-256 simples basta porque o token ja tem 256 bits de entropia aleatoria,
// entao nao ha o que forcar por dicionario.
export async function tokenHash(token: string) {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return hex(new Uint8Array(bits));
}

