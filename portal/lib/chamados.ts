import { pode } from './permissoes.ts';
import { EntradaInvalida, exigeTexto, LIMITES_CAMPO } from './limites-entrada.ts';
import { normalizeText } from './domain.ts';

export function responsavelElegivel(usuario: { role?: unknown; active?: unknown } | null | undefined) {
  return usuario?.active === 1 && pode(usuario, 'chamado:assumir');
}

export function opcoesResponsavelChamado(
  usuarios: { id: string; name: string; role?: unknown; active?: unknown }[],
  atual: { id: string; name: string } | null = null,
) {
  const opcoes = usuarios.filter(usuario => responsavelElegivel(usuario) || usuario.id === atual?.id);
  // A lista recebida por editores omite inativos; o detalhe conserva seu nome.
  if (atual && !opcoes.some(usuario => usuario.id === atual.id)) opcoes.push(atual);
  return opcoes;
}

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
