import { EntradaInvalida, exigeTexto, LIMITES_CAMPO } from './limites-entrada.ts';
import { normalizeText } from './domain.ts';

export function fornecedorChamado(value: unknown) {
  const fornecedor = exigeTexto(value, LIMITES_CAMPO.nome, 'fornecedor');
  if (!fornecedor) throw new EntradaInvalida('Informe o fornecedor do chamado.');
  return normalizeText(fornecedor);
}

// A coluna title fica como dado legado: nao apagar o que ja foi cadastrado.
// Chamados criados quando fornecedor era opcional precisam de identificacao.
export const MIGRAR_FORNECEDORES_CHAMADOS_SQL = `UPDATE tickets SET supplier_name =
  CASE WHEN trim(title) <> '' THEN title ELSE code END
  WHERE trim(supplier_name) = ''`;
