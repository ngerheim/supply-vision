import { pode, type Acao, type UsuarioPermissao } from './permissoes.ts';
import type { Role } from './domain.ts';

export const ABAS_NAVEGACAO = [
  { aba: 'buscar', label: 'Buscar', subabas: [{ chave: 'search', slug: null, label: 'Buscar' }] },
  { aba: 'manutencao', label: 'Manutenção', subabas: [{ chave: 'maintenance', slug: null, label: 'Manutenção' }] },
  { aba: 'chamados', label: 'Chamados', subabas: [
    { chave: 'tickets', slug: 'parcerias', label: 'Acordos' },
    { chave: 'solicitacoes', slug: 'cadastro-fornecedor', label: 'Cadastros' },
    { chave: 'baixas', slug: 'baixa-estoque', label: 'Baixa' },
    { chave: 'pagamentos', slug: 'pagamento', label: 'Pagamentos' },
  ] },
  { aba: 'estoque', label: 'Estoque', subabas: [
    { chave: 'estoque-saldo', slug: 'saldo', label: 'Saldo' },
    { chave: 'estoque-entradas', slug: 'entradas', label: 'Entradas' },
  ] },
  { aba: 'acordos', label: 'Acordos', subabas: [
    { chave: 'agreements', slug: 'acordos', label: 'Acordos' },
    { chave: 'imports', slug: 'importacoes', label: 'Importações' },
    { chave: 'contratos', slug: 'contratos', label: 'Contratos' },
  ] },
  { aba: 'cadastros', label: 'Cadastros', subabas: [
    { chave: 'suppliers', slug: 'fornecedores', label: 'Fornecedores' },
    { chave: 'catalogs', slug: 'catalogos', label: 'Catálogos' },
    { chave: 'mappings', slug: 'de-para', label: 'De/Para' },
    { chave: 'categorias', slug: 'categorias', label: 'Categorias' },
    { chave: 'estoques', slug: 'estoques', label: 'Estoques' },
  ] },
  { aba: 'analise', label: 'Análise', subabas: [{ chave: 'analise', slug: null, label: 'Análise' }] },
  { aba: 'administracao', label: 'Administração', subabas: [
    { chave: 'reports', slug: 'relatorios', label: 'Relatórios' },
    { chave: 'history', slug: 'historico', label: 'Histórico' },
    { chave: 'emails', slug: 'emails', label: 'E-mails' },
    { chave: 'admin', slug: 'usuarios', label: 'Usuários' },
    { chave: 'permissoes', slug: 'permissoes', label: 'Permissões' },
  ] },
] as const;
export type DefinicaoAba = (typeof ABAS_NAVEGACAO)[number];
export type Aba = DefinicaoAba['aba'];
export type DefinicaoSubaba = DefinicaoAba['subabas'][number];
export type Nav = DefinicaoSubaba['chave'];
export type EnderecoNavegacao = { aba: Aba; subaba: DefinicaoSubaba['slug'] };
export const GRUPOS_NAVEGACAO = [
  { nome: 'Consulta', abas: ['buscar', 'manutencao', 'chamados', 'estoque'] },
  { nome: 'Suprimentos', abas: ['acordos', 'cadastros', 'analise'] },
  { nome: 'Administração', abas: ['administracao'] },
] as const;
export const AVISO_AREA_RESTRITA = 'Seu perfil não tem acesso a esta área.';
export const AVISO_CHAMADO_RESTRITO = 'Seu perfil permite consultar preços e acordos. O acesso a chamados é restrito.';
const BUSCAR: EnderecoNavegacao = { aba: 'buscar', subaba: null };

const ACAO_ABA: Partial<Record<Nav, Acao>> = { 'estoque-saldo': 'aba:estoque', 'estoque-entradas': 'aba:estoque', contratos: 'acordo:consultar-completo' };
export function podeAcessarAba(usuario: UsuarioPermissao, chave: Nav): boolean {
  return pode(usuario, ACAO_ABA[chave] ?? (`aba:${chave}` as Acao));

}
export function abaDaChave(chave: Nav): DefinicaoAba {
  return ABAS_NAVEGACAO.find(aba => aba.subabas.some(sub => sub.chave === chave))!;
}
export function enderecoDaChave(chave: Nav): EnderecoNavegacao {
  const aba = abaDaChave(chave);
  return { aba: aba.aba, subaba: aba.subabas.find(sub => sub.chave === chave)!.slug };
}
export function subabasPermitidas(usuario: UsuarioPermissao, aba: DefinicaoAba): DefinicaoSubaba[] {
  return aba.subabas.filter(sub => podeAcessarAba(usuario, sub.chave));
}
export function gruposVisiveis(usuario: UsuarioPermissao) {
  return GRUPOS_NAVEGACAO.map(grupo => ({ nome: grupo.nome, abas: grupo.abas.flatMap(slug => {
    const aba = ABAS_NAVEGACAO.find(item => item.aba === slug)!;
    const subabas = subabasPermitidas(usuario, aba);
    return subabas.length ? [{ ...aba, subabas }] : [];
  }) })).filter(grupo => grupo.abas.length > 0);
}

export function lerEndereco(busca: string): EnderecoNavegacao {
  const params = new URLSearchParams(busca);
  const aba = ABAS_NAVEGACAO.find(item => item.aba === params.get('aba'));
  if (!aba) return { ...BUSCAR };
  const subaba = params.get('sub');
  if (subaba !== null && !aba.subabas.some(sub => sub.slug === subaba)) return { ...BUSCAR };
  return { aba: aba.aba, subaba: subaba as EnderecoNavegacao['subaba'] };
}
export function enderecoParaBusca({ aba, subaba }: EnderecoNavegacao): string {
  const params = new URLSearchParams({ aba });
  if (subaba !== null) params.set('sub', subaba);
  return `?${params}`;
}
export function resolverEndereco(usuario: UsuarioPermissao, busca: string) {
  const baixa = new URLSearchParams(busca).get('baixa');
  if (baixa) {
    return podeAcessarAba(usuario, 'baixas')
      ? { nav: 'baixas' as Nav, endereco: enderecoDaChave('baixas'), chamado: null, solicitacao: null, baixa, aviso: '' }
      : { nav: 'search' as Nav, endereco: { ...BUSCAR }, chamado: null, solicitacao: null, baixa: null, aviso: AVISO_AREA_RESTRITA };
  }
  const solicitacao = new URLSearchParams(busca).get('solicitacao');
  if (solicitacao) {
    return podeAcessarAba(usuario, 'solicitacoes')
      ? { nav: 'solicitacoes' as Nav, endereco: enderecoDaChave('solicitacoes'), chamado: null, solicitacao, aviso: '' }
      : { nav: 'search' as Nav, endereco: { ...BUSCAR }, chamado: null, solicitacao: null, aviso: AVISO_AREA_RESTRITA };
  }
  const chamado = new URLSearchParams(busca).get('chamado');
  if (chamado) {
    return podeAcessarAba(usuario, 'tickets')
      ? { nav: 'tickets' as Nav, endereco: enderecoDaChave('tickets'), chamado, solicitacao: null, aviso: '' }
      : { nav: 'search' as Nav, endereco: { ...BUSCAR }, chamado: null, solicitacao: null, aviso: AVISO_CHAMADO_RESTRITO };
  }
  const endereco = lerEndereco(busca);
  const aba = ABAS_NAVEGACAO.find(item => item.aba === endereco.aba)!;
  const permitidas = subabasPermitidas(usuario, aba);
  const sub = endereco.subaba === null ? permitidas[0] : permitidas.find(item => item.slug === endereco.subaba);
  return sub
    ? { nav: sub.chave, endereco: enderecoDaChave(sub.chave), chamado: null, solicitacao: null, aviso: '' }
    : { nav: 'search' as Nav, endereco: { ...BUSCAR }, chamado: null, solicitacao: null, aviso: AVISO_AREA_RESTRITA };
}
export const NOMES_PERFIL: Record<Role, string> = {
  viewer: 'Consulta',
  editor: 'Suprimentos',
  admin: 'Administrador',
};
