import type { Role } from './domain.ts';

export const ACOES = [
  'aba:solicitacoes', 'aba:categorias',
  'aba:search', 'aba:maintenance', 'aba:tickets', 'aba:agreements',
  'aba:suppliers', 'aba:imports', 'aba:catalogs', 'aba:mappings',
  'aba:reports', 'aba:history', 'aba:emails', 'aba:admin',
  'portal:consultar-gestao', 'portal:escrever',
  'acordo:consultar-completo', 'acordo:editar', 'acordo:excluir',
  'importacao:consultar', 'importacao:executar', 'mapeamento:consultar',
  'mapeamento:gerenciar', 'chamado:assumir', 'chamado:consultar', 'chamado:editar',
  'catalogo:gerenciar', 'acordo:exportar',
  'usuario:consultar', 'usuario:gerenciar',
  'relatorio:consultar', 'relatorio:executar', 'relatorio:cancelar',
  'auditoria:consultar', 'email:consultar', 'email:reenviar', 'base:exportar',
  'central:marcar', 'solicitacao:abrir', 'solicitacao:ver_todas',
  'solicitacao:atender', 'categoria:gerenciar',
] as const;
export type Acao = (typeof ACOES)[number];

// Guardas gerais preservam a ordem e as mensagens do roteador, inclusive 404.
const consulta: readonly Acao[] = ['aba:search', 'aba:maintenance', 'central:marcar', 'solicitacao:abrir', 'aba:solicitacoes'];
const suprimentos: readonly Acao[] = [
  ...consulta, 'aba:tickets', 'aba:agreements', 'aba:suppliers', 'aba:imports',
  'aba:catalogs', 'aba:mappings', 'portal:consultar-gestao', 'portal:escrever',
  'acordo:consultar-completo', 'acordo:editar', 'acordo:exportar',
  'importacao:consultar', 'importacao:executar', 'mapeamento:consultar',
  'chamado:consultar', 'chamado:editar', 'catalogo:gerenciar',
  'mapeamento:gerenciar', 'chamado:assumir', 'usuario:consultar',
  'solicitacao:ver_todas', 'solicitacao:atender',
];
const acoesPorPerfil: Record<Role, readonly Acao[]> = {
  viewer: consulta,
  editor: suprimentos,
  admin: [
    ...suprimentos, 'aba:reports', 'aba:history', 'aba:emails', 'aba:admin',
    'acordo:excluir', 'usuario:gerenciar', 'relatorio:consultar',
    'relatorio:executar', 'relatorio:cancelar', 'auditoria:consultar',
    'email:consultar', 'email:reenviar', 'base:exportar',
    'categoria:gerenciar', 'aba:categorias',
  ],
};

// A sessao autenticada ja filtra active=1 e nao expoe a coluna active.
// Registros vindos de listas/banco podem informar explicitamente a situacao.
export type UsuarioPermissao = { role?: unknown; active?: unknown };
export function pode(usuario: UsuarioPermissao | null | undefined, acao: Acao): boolean {
  if (!usuario || (usuario.active !== undefined && usuario.active !== 1 && usuario.active !== true)) return false;
  if (typeof usuario.role !== 'string' || !Object.hasOwn(acoesPorPerfil, usuario.role)) return false;
  return acoesPorPerfil[usuario.role as Role].includes(acao);
}
