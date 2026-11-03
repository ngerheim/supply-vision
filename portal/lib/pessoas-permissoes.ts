import { lerPermissoes, type Permissoes } from './permissoes.ts';
import type { Role } from './domain.ts';

export type PessoaAtiva = { id: string; name: string; email: string; role: Role; active: number; permissoes: Permissoes };
type Consultar = <T>(sql: string, values?: unknown[]) => Promise<T[]>;

// Usuarios ativos com os ajustes do painel de permissoes. Quem escolhe
// destinatario de aviso usa isto com pode(): o perfil sozinho nao basta.
export async function pessoasAtivas(all: Consultar, ids?: readonly string[]): Promise<PessoaAtiva[]> {
  const filtro = ids ? ` AND id IN (${ids.map(() => '?').join(',') || "''"})` : '';
  const [usuarios, ajustes] = await Promise.all([
    all<Omit<PessoaAtiva, 'permissoes'>>(`SELECT id,name,email,role,active FROM users WHERE active=1${filtro} ORDER BY name`, ids ? [...ids] : []),
    all<{ user_id: string; area: string; nivel: string }>('SELECT user_id,area,nivel FROM permissoes_usuario'),
  ]);
  return usuarios.map(u => ({ ...u, permissoes: lerPermissoes(ajustes.filter(a => a.user_id === u.id)) }));
}
