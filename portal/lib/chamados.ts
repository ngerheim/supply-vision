import { EntradaInvalida, exigeTexto, LIMITES_CAMPO } from './limites-entrada.ts';

export function tituloChamado(value: unknown) {
  const titulo = exigeTexto(value, LIMITES_CAMPO.nome, 'título');
  if (!titulo) throw new EntradaInvalida('Informe o título do chamado.');
  return titulo;
}

// Registros antigos nao tinham titulo. Preserva uma identificacao util sem
// remover fornecedor, CNPJ ou contato do historico existente.
export const MIGRAR_TITULOS_CHAMADOS_SQL = `UPDATE tickets SET title =
  CASE WHEN trim(supplier_name) <> '' THEN supplier_name ELSE code END
  WHERE trim(title) = ''`;
