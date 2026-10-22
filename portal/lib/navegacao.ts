import { pode, type UsuarioPermissao } from './permissoes.ts';
import type { Role } from './domain.ts';

export const GRUPOS_NAVEGACAO = [
  { nome: 'Consulta', perfil: 'viewer', abas: ['search', 'maintenance'] },
  {
    nome: 'Suprimentos',
    perfil: 'editor',
    abas: [
      'tickets',
      'agreements',
      'suppliers',
      'imports',
      'catalogs',
      'mappings',
    ],
  },
  {
    nome: 'Administração',
    perfil: 'admin',
    abas: ['reports', 'history', 'notifications', 'admin'],
  },
] as const;
export type Nav = (typeof GRUPOS_NAVEGACAO)[number]['abas'][number];
export function podeAcessarAba(usuario: UsuarioPermissao, aba: Nav): boolean {
  return pode(usuario, `aba:${aba}`);
}
export const NOMES_PERFIL: Record<Role, string> = {
  viewer: 'Consulta',
  editor: 'Suprimentos',
  admin: 'Administrador',
};
