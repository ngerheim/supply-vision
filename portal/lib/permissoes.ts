import type { Role } from './domain.ts';

export const ACOES = [
  'baixa:abrir', 'baixa:ver_todas', 'baixa:atender', 'estoque:gerenciar', 'aba:baixas', 'aba:estoques',
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
  // Pagamentos e Estoque usavam as acoes de Solicitacoes e de Baixa. Separadas,
  // cada sub-aba pode receber um nivel proprio no painel de permissoes.
  'aba:pagamentos', 'pagamento:abrir', 'pagamento:ver_todas', 'pagamento:atender',
  'aba:estoque', 'estoque:consultar', 'estoque:lancar',
  'aba:permissoes', 'permissao:gerenciar',
] as const;
export type Acao = (typeof ACOES)[number];

// Guardas gerais preservam a ordem e as mensagens do roteador, inclusive 404.
const consulta: readonly Acao[] = [
  'aba:search', 'aba:maintenance', 'central:marcar', 'solicitacao:abrir', 'aba:solicitacoes', 'baixa:abrir', 'aba:baixas',
  'aba:pagamentos', 'pagamento:abrir', 'aba:estoque', 'estoque:consultar',
];
const suprimentos: readonly Acao[] = [
  ...consulta, 'aba:tickets', 'aba:agreements', 'aba:suppliers', 'aba:imports',
  'aba:catalogs', 'aba:mappings', 'portal:consultar-gestao', 'portal:escrever',
  'acordo:consultar-completo', 'acordo:editar', 'acordo:exportar',
  'importacao:consultar', 'importacao:executar', 'mapeamento:consultar',
  'chamado:consultar', 'chamado:editar', 'catalogo:gerenciar',
  'mapeamento:gerenciar', 'chamado:assumir', 'usuario:consultar',
  'solicitacao:ver_todas', 'solicitacao:atender',
  'baixa:ver_todas', 'baixa:atender',
  'pagamento:ver_todas', 'pagamento:atender', 'estoque:lancar',
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
    'estoque:gerenciar', 'aba:estoques',
    'aba:permissoes', 'permissao:gerenciar',
  ],
};

// Painel de permissoes: uma area por (sub)aba do menu.
export const NIVEIS = ['sem', 'leitura', 'edicao'] as const;
export type Nivel = (typeof NIVEIS)[number];
export const ROTULO_NIVEL: Record<Nivel, string> = { sem: 'Sem acesso', leitura: 'Somente leitura', edicao: 'Ler e editar' };

export const AREAS = [
  { area: 'buscar', aba: 'Buscar', label: 'Buscar' },
  { area: 'manutencao', aba: 'Manutenção', label: 'Manutenção' },
  { area: 'parcerias', aba: 'Chamados', label: 'Acordos' },
  { area: 'solicitacoes', aba: 'Chamados', label: 'Cadastros' },
  { area: 'baixas', aba: 'Chamados', label: 'Baixa' },
  { area: 'pagamentos', aba: 'Chamados', label: 'Pagamentos' },
  { area: 'estoque', aba: 'Estoque', label: 'Estoque' },
  { area: 'acordos', aba: 'Acordos', label: 'Acordos' },
  { area: 'importacoes', aba: 'Acordos', label: 'Importações' },
  { area: 'fornecedores', aba: 'Cadastros', label: 'Fornecedores' },
  { area: 'catalogos', aba: 'Cadastros', label: 'Catálogos' },
  { area: 'depara', aba: 'Cadastros', label: 'De/Para' },
  { area: 'categorias', aba: 'Cadastros', label: 'Categorias' },
  { area: 'estoques', aba: 'Cadastros', label: 'Estoques' },
  { area: 'relatorios', aba: 'Administração', label: 'Relatórios' },
  { area: 'historico', aba: 'Administração', label: 'Histórico' },
  { area: 'emails', aba: 'Administração', label: 'E-mails' },
] as const;
export type Area = (typeof AREAS)[number]['area'];
export const AREAS_IDS: readonly Area[] = AREAS.map(a => a.area);

// Cada acao pertence a uma ou mais areas, com o nivel minimo exigido. Nas
// sub-abas de pedidos, leitura = abrir e acompanhar os proprios pedidos;
// edicao = ver todos e atender. Acoes com varias areas valem se qualquer uma
// delas tiver o nivel minimo (ex.: consulta de gestao usada por varias telas).
type Minimo = Exclude<Nivel, 'sem'>;
type Exigencia = readonly (readonly [Area, Minimo])[];
const L = (...areas: Area[]): Exigencia => areas.map(a => [a, 'leitura'] as const);
const E = (...areas: Area[]): Exigencia => areas.map(a => [a, 'edicao'] as const);
export const EXIGENCIAS: Partial<Record<Acao, Exigencia>> = {
  'aba:search': L('buscar'),
  'aba:maintenance': L('manutencao'),
  'aba:tickets': L('parcerias'), 'chamado:consultar': L('parcerias'),
  'chamado:editar': E('parcerias'), 'chamado:assumir': E('parcerias'),
  'aba:solicitacoes': L('solicitacoes'), 'solicitacao:abrir': L('solicitacoes'),
  'solicitacao:ver_todas': E('solicitacoes'), 'solicitacao:atender': E('solicitacoes'),
  'aba:baixas': L('baixas'), 'baixa:abrir': L('baixas'),
  'baixa:ver_todas': E('baixas'), 'baixa:atender': E('baixas'),
  'aba:pagamentos': L('pagamentos'), 'pagamento:abrir': L('pagamentos'),
  'pagamento:ver_todas': E('pagamentos'), 'pagamento:atender': E('pagamentos'),
  'aba:estoque': L('estoque'), 'estoque:consultar': L('estoque'), 'estoque:lancar': E('estoque'),
  'aba:agreements': L('acordos'), 'acordo:consultar-completo': L('acordos'),
  'acordo:exportar': L('acordos'), 'acordo:editar': E('acordos'),
  'aba:imports': L('importacoes'), 'importacao:consultar': L('importacoes'), 'importacao:executar': E('importacoes'),
  'aba:suppliers': L('fornecedores'),
  'aba:catalogs': L('catalogos'), 'catalogo:gerenciar': E('catalogos'),
  'aba:mappings': L('depara'), 'mapeamento:consultar': L('depara'), 'mapeamento:gerenciar': E('depara'),
  'aba:categorias': L('categorias'), 'categoria:gerenciar': E('categorias'),
  'aba:estoques': L('estoques'), 'estoque:gerenciar': E('estoques'),
  'aba:reports': L('relatorios'), 'relatorio:consultar': L('relatorios'),
  'relatorio:executar': E('relatorios'), 'relatorio:cancelar': E('relatorios'),
  'aba:history': L('historico'), 'auditoria:consultar': L('historico'),
  'aba:emails': L('emails'), 'email:consultar': L('emails'), 'email:reenviar': E('emails'),
  'portal:consultar-gestao': L('acordos', 'importacoes', 'fornecedores', 'catalogos', 'depara'),
  'portal:escrever': E('acordos', 'fornecedores', 'catalogos'),
  'usuario:consultar': L('parcerias'),
};
// Fora do painel: so o perfil admin. Evita que alguem amplie os proprios poderes.
// central:marcar nao pertence a area nenhuma e segue o perfil.
export const ACOES_SO_ADMIN: readonly Acao[] = [
  'acordo:excluir', 'usuario:gerenciar', 'base:exportar', 'aba:admin', 'aba:permissoes', 'permissao:gerenciar',
];

export type Permissoes = Partial<Record<Area, Nivel>>;

const atende = (nivel: Nivel, minimo: Minimo) => nivel === 'edicao' || (nivel === 'leitura' && minimo === 'leitura');
const ehRole = (role: unknown): role is Role => typeof role === 'string' && Object.hasOwn(acoesPorPerfil, role);

// Nivel que o perfil ja concede sem ajuste individual: edicao se o perfil
// tem alguma acao de edicao da area; leitura se tem alguma de leitura.
export function nivelPadrao(role: Role, area: Area): Nivel {
  let nivel: Nivel = 'sem';
  for (const acao of acoesPorPerfil[role]) {
    for (const [a, minimo] of EXIGENCIAS[acao] ?? []) {
      if (a !== area) continue;
      if (minimo === 'edicao') return 'edicao';
      nivel = 'leitura';
    }
  }
  return nivel;
}

// A sessao autenticada ja filtra active=1 e nao expoe a coluna active.
// Registros vindos de listas/banco podem informar explicitamente a situacao.
// permissoes traz apenas os ajustes individuais gravados pelo admin.
export type UsuarioPermissao = { role?: unknown; active?: unknown; permissoes?: Permissoes | null };
export function pode(usuario: UsuarioPermissao | null | undefined, acao: Acao): boolean {
  if (!usuario || (usuario.active !== undefined && usuario.active !== 1 && usuario.active !== true)) return false;
  if (!ehRole(usuario.role)) return false;
  const role = usuario.role;
  const doPerfil = acoesPorPerfil[role].includes(acao);
  if (role === 'admin' || ACOES_SO_ADMIN.includes(acao)) return doPerfil;
  const exigencia = EXIGENCIAS[acao];
  const ajustes = usuario.permissoes;
  // Sem ajuste nas areas da acao, vale exatamente o perfil de antes.
  if (!exigencia || !ajustes || !exigencia.some(([area]) => ajustes[area] !== undefined)) return doPerfil;
  return exigencia.some(([area, minimo]) => atende(ajustes[area] ?? nivelPadrao(role, area), minimo));
}

export function nivelEfetivo(usuario: { role: Role; permissoes?: Permissoes | null }, area: Area): Nivel {
  if (usuario.role === 'admin') return 'edicao';
  return usuario.permissoes?.[area] ?? nivelPadrao(usuario.role, area);
}

// Ajustes que fogem do padrao do perfil; so eles sao gravados.
export function ajustesDiferentesDoPadrao(role: Role, niveis: Permissoes): Permissoes {
  const resultado: Permissoes = {};
  if (role === 'admin') return resultado;
  for (const area of AREAS_IDS) {
    const nivel = niveis[area];
    if (nivel && nivel !== nivelPadrao(role, area)) resultado[area] = nivel;
  }
  return resultado;
}

export function lerPermissoes(linhas: readonly { area: unknown; nivel: unknown }[]): Permissoes {
  const resultado: Permissoes = {};
  for (const { area, nivel } of linhas) {
    if (AREAS_IDS.includes(area as Area) && NIVEIS.includes(nivel as Nivel)) resultado[area as Area] = nivel as Nivel;
  }
  return resultado;
}
