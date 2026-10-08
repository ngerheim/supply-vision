// O supervisor le operacao.env e propaga o modo a todos os filhos.
export function modoEnsaio() {
  return process.env.MODO_ENSAIO === '1';
}
