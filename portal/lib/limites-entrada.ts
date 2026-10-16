// Estavam declarados dentro da rota e COPIADOS à mão nos testes. Isso deixava
// o teste passar mesmo se o limite real mudasse — a cópia continuava batendo
// consigo mesma. Agora a rota e os testes importam daqui, então mexer no valor
// de produção quebra o teste correspondente, que é o comportamento desejado.

// Contam CARACTERES, não bytes: em UTF-8 um acento ocupa 2 bytes, e contar
// bytes recusaria texto legítimo em português.
export const LIMITES_CAMPO = {
  nome: 120,
  email: 254,
  numeroAcordo: 80,
  cidade: 80,
  codigo: 30,
  contato: 200,
  escopo: 500,
  observacoes: 2000,
  mensagem: 2000,
  marcas: 500,
  busca: 200,
} as const;

// Limita filtros e o trabalho de cada consulta, preservando o contrato da API.
export const LIMITE_LISTA = 80;

// Tetos de corpo. O login tem o seu porque é o único caminho que gasta CPU
// pesada (PBKDF2) antes de qualquer validação.
export const CORPO_MAX_JSON = 64 * 1024;
export const CORPO_MAX_LOGIN = 2 * 1024;
export const CORPO_MAX_UPLOAD = 2 * 1024 * 1024 + 64 * 1024;

// Erro que o cliente causou e pode corrigir: vira 400 com a mensagem real.
// Qualquer outra exceção é falha nossa e não deve vazar detalhe interno.
export class EntradaInvalida extends Error {}

const textoDe = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function exigeTexto(value: unknown, maximo: number, campo: string) {
  const texto = textoDe(value);
  if (texto.length > maximo) {
    throw new EntradaInvalida(`O campo "${campo}" passa do limite de ${maximo} caracteres.`);
  }
  return texto;
}


export function chaveIdempotencia(request: Request): string | null {
  const chave = request.headers.get('idempotency-key');
  if (chave === null) return null;
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(chave)) throw new EntradaInvalida('Identificador da tentativa inválido.');
  return chave;
}
