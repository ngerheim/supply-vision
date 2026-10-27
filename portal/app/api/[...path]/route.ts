import { comContextoEscrita, definirAutorEscrita, SessaoRevogada } from '@/lib/autor-escrita';
import { tokenHash } from '@/lib/criptografia';
import { NextRequest, NextResponse } from 'next/server';
import { env } from '../../../scripts/configuracao-servidor.mjs';
import * as banco from '@/lib/database';
import { currentUser, ensureDatabase, rawDb } from '@/lib/database';
import { pode, type Acao } from '@/lib/permissoes';
import { VALIDACAO_ATIVA_SQL } from '@/lib/operacao-validacao';
import { consultarRelatorios, solicitarRelatorio, cancelarRelatorio } from '@/lib/relatorios-api';
import { TravaPerdida, revisaoDaQuery } from '@/lib/controle-escrita';
import { CorpoExpirado, corpoBinarioLimitado, corpoLimitado } from '@/lib/corpo-limitado';
import { CORPO_MAX_JSON, EntradaInvalida } from '@/lib/limites-entrada';
import { isRecord } from '@/lib/domain';
import { sessaoApi } from '@/lib/sessao-api';
import { acordosApi } from '@/lib/acordos-api';
import { catalogosApi } from '@/lib/catalogos-api';
import { mapeamentosApi } from '@/lib/mapeamentos-api';
import { importacoesApi } from '@/lib/importacoes-api';
import { chamadosApi } from '@/lib/chamados-api';
import { usuariosApi } from '@/lib/usuarios-api';
import { auditoriaApi } from '@/lib/auditoria-api';
import { notificacoesApi } from '@/lib/notificacoes-api';
import { logoMarca } from '@/lib/marca-api';
import { centralApi } from '@/lib/central-api';
import { solicitacoesApi } from '@/lib/solicitacoes-api';
import { baixasApi } from '@/lib/baixas-api';
import { exportacoesApi } from '@/lib/exportacoes-api';
import { bootstrapApi } from '@/lib/bootstrap-api';
import { PORTAL_BUILD, TELA_DESATUALIZADA, buildDivergente, ehEscrita } from '@/lib/portal-build';

export const dynamic = 'force-dynamic';

const ok = (data: unknown, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return NextResponse.json(data, { ...init, headers });
};
const fail = (message: string, status = 400, codigo?: string) => ok({ error: message, ...(status === 409 ? { codigo: codigo || 'conflito' } : {}) }, { status });
const CONSULTAS_POR_MINUTO = 20;
const LIMITE_CONSULTAS_MENSAGEM = 'Limite de 20 consultas de CNPJ e CEP por minuto atingido. Aguarde antes de tentar novamente.';
const consultasPorUsuario = new Map<string, number[]>();
let ultimaConsulta = 0;
function excedeuLimiteConsultas(userId: string) {
  const agora = Math.max(Date.now(), ultimaConsulta + 1), recentes = (consultasPorUsuario.get(userId) ?? []).filter(t => t > agora - 60_000);
  ultimaConsulta = agora;
  if (recentes.length >= CONSULTAS_POR_MINUTO) { consultasPorUsuario.set(userId, recentes); return true; }
  recentes.push(agora); consultasPorUsuario.set(userId, recentes);
  if (consultasPorUsuario.size > 1000) for (const [id, tempos] of consultasPorUsuario) if (!tempos.some(t => t > agora - 60_000)) consultasPorUsuario.delete(id);
  return false;
}
// Respostas antecipadas a escritas precisam finalizar o corpo HTTP. No runtime
// local, deixar um corpo pequeno pendente pode derrubar a conexão reutilizada.
// Mantém o limite mesmo em pedidos não autorizados.
async function denyWrite(request: Request, message: string, status = 403) {
  if (request.body) await corpoBinarioLimitado(request, CORPO_MAX_JSON);
  return fail(message, status);
}
const partsOf = (request: Request) => new URL(request.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (user && request.method !== 'GET') definirAutorEscrita({ id: user.id, role: user.role, token: await tokenHash(banco.parseCookies(request).acordos_session || '') });
  return user;
}

function rejectCrossOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return null;
  try {
    return new URL(origin).host === host ? null : fail('Origem da solicitação não autorizada.', 403);
  } catch {
    return fail('Origem da solicitação inválida.', 403);
  }
}

// A credencial interna vem da configuracao do servidor, lida pelo
// scripts/iniciar-portal.mjs a partir do portal.env -- o mesmo arquivo que o
// rodar.py dos Alertas le a cada execucao.
//
// Nao ha mais valor compilado de reserva: ele deixava o segredo em texto puro
// em dist/server, e qualquer copia da pasta levava o token junto. Sem a
// variavel, a rota interna recusa tudo com 401.
function credencialInterna() {
  return String((env as unknown as { PORTAL_API_TOKEN?: string }).PORTAL_API_TOKEN || '').trim();
}

function tokenInternoValido(request: Request) {
  const esperado = credencialInterna();
  const recebido = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!esperado || recebido.length !== esperado.length) return false;
  let diferenca = 0;
  for (let i = 0; i < recebido.length; i++) diferenca |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diferenca === 0;
}

// Erro com codigo proprio para corpo excessivo: quem chama devolve 413 em vez
// de tratar como JSON invalido.
class CorpoGrandeDemais extends Error {
  readonly maximo: number;
  constructor(maximo: number) {
    super(`Corpo da requisição acima do limite de ${Math.round(maximo / 1024)} KB.`);
    this.maximo = maximo;
  }
}

// Toda rota JSON passa por aqui, entao o teto vale para todas de uma vez, sem
// repetir a checagem em cada uma. Antes, request.json() lia o corpo inteiro na
// memoria antes de qualquer limite -- so o login tinha protecao.
async function jsonBody<T>(request: Request, maximo = CORPO_MAX_JSON) {
  const texto = await corpoLimitado(request, maximo);
  if (texto === null) throw new CorpoGrandeDemais(maximo);
  if (!texto.trim()) return {} as T;
  let value: unknown;
  try { value = JSON.parse(texto); }
  catch { throw new EntradaInvalida('O conteúdo enviado não é um JSON válido.'); }
  // Lista, texto ou numero sao JSON valido, mas nenhuma rota espera isso.
  // Converter em {} fazia a resposta acusar "campo obrigatorio" em vez do
  // problema real.
  if (!isRecord(value)) throw new EntradaInvalida('O conteúdo enviado deve ser um objeto JSON.');
  return value as T;
}

const all = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await rawDb().prepare(sql).bind(...values).all<T>()).results;
const first = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => rawDb().prepare(sql).bind(...values).first<T>();

const contexto = { ...banco, env, NextResponse, ok, fail, denyWrite, jsonBody, CorpoGrandeDemais, all, first };
const sessao = sessaoApi(contexto);
const acordos = acordosApi(contexto);
const catalogos = catalogosApi(contexto);
const mapeamentos = mapeamentosApi(contexto);
const importacoes = importacoesApi(contexto, acordos);
const chamados = chamadosApi(contexto);
const usuarios = usuariosApi(contexto);
const auditoria = auditoriaApi(contexto);
const notificacoes = notificacoesApi(contexto);
const central = centralApi(contexto);
const solicitacoes = solicitacoesApi(contexto);
const baixas = baixasApi(contexto);
const exportacoes = exportacoesApi(contexto);
const inicializacao = bootstrapApi(contexto, acordos, importacoes);

const { login, logout } = sessao;
const { agreementDetail, createAgreement, updateAgreement, addAgreementItems, updateItem, deleteItem, deleteAgreement, comTravaDoAcordo, acordoDaCondicao, search, searchOptions, internalAgreements } = acordos;
const { createCatalog, updateCatalog, deleteCatalog } = catalogos;
const { mappingList, createMapping, updateMapping, deleteMapping } = mapeamentos;
const { importWorkbook, importDetail, importList, totalImportacoes } = importacoes;
const { comTravaDoChamado, ticketDetail, ticketList, ticketStats, createTicket, updateTicket, addTicketEvent } = chamados;
const { createUser, updateUser, userList } = usuarios;
const { auditList, exportAudit } = auditoria;
const { emailNotificationList, retryEmailNotification } = notificacoes;
const { downloadDatabase, downloadAgreements } = exportacoes;
const { bootstrap } = inicializacao;

export async function GET(request: NextRequest) {
  return responder(request, () => GETInterno(request));
}

// Antes de ensureDatabase/currentUser: ate migracoes e atividade de sessao
// sao escritas. Downloads e erros tambem recebem o cabecalho comum.
async function responder(request: NextRequest, executar: () => Promise<Response>) {
  let resposta: Response;
  try {
    if (ehEscrita(request.method) && buildDivergente(request.headers.get('x-portal-build'), PORTAL_BUILD)) {
      // Drenar e apenas higiene HTTP: um corpo interrompido nao muda a
      // recusa de build nem permite chegar ao banco.
      try { if (request.body) await corpoBinarioLimitado(request, CORPO_MAX_JSON); }
      catch { /* A recusa de build permanece mesmo com corpo interrompido. */ }
      resposta = ok({ error: TELA_DESATUALIZADA, codigo: 'build_desatualizado' }, { status: 409 });
    } else resposta = await comContextoEscrita(executar);
  } catch (erro: unknown) { resposta = respostaDeErro(erro); }
  resposta.headers.set('x-portal-build', PORTAL_BUILD);
  return resposta;
}

export async function PATCH(request: NextRequest) {
  return responder(request, async () => fail('Método não permitido.', 405));
}

// Seleciona a operacao da rota, sem conhecer perfis. Os casos restritos
// conservam a guarda geral antes da especifica para manter a mensagem HTTP.
function acaoConsulta(parts: string[]): Acao {
  switch (parts[0]) {
    case 'imports': return 'importacao:consultar';
    case 'mappings': return 'mapeamento:consultar';
    case 'tickets': return 'chamado:consultar';
    case 'users': return 'usuario:consultar';
    case 'export': if (parts[1] === 'agreements') return 'acordo:exportar';
  }
  return 'portal:consultar-gestao';
}
function acaoEscrita(parts: string[]): Acao {
  switch (parts[0]) {
    case 'agreements': case 'items': return 'acordo:editar';
    case 'catalogs': return 'catalogo:gerenciar';
    case 'tickets': return 'chamado:editar';
    case 'imports': return 'importacao:executar';
    case 'mappings': return 'mapeamento:gerenciar';
  }
  return 'portal:escrever';
}

async function GETInterno(request: NextRequest) {
  const parts = partsOf(request);
  if (parts.length === 2 && parts[0] === 'marca' && parts[1] === 'logo') return logoMarca();
  await ensureDatabase();
  if (parts[0] === 'health') { await first('SELECT COUNT(*) n FROM schema_migrations'); return ok({ app: 'portal-suprimentos', status: 'ok' }); }
  if (parts[0] === 'session') return ok({ user: await currentUser(request) });
  if (parts[0] === 'internal' && parts[1] === 'agreements') {
    if (!tokenInternoValido(request)) return fail('Credencial interna inválida.', 401);
    return internalAgreements();
  }
  const user = await requireUser(request);
  if (!user) return fail('Sessão expirada.', 401);

  if (parts[0] === 'baixas') {
    if (!pode(user, 'baixa:abrir')) return fail('Seu perfil não permite consultar baixas.', 403);
    if (parts.length === 1) return baixas.listar(user, request.nextUrl.searchParams);
    return parts.length === 2 ? baixas.detalhe(user, parts[1]) : fail('Rota não encontrada.', 404);
  }
  if (parts[0] === 'estoques') {
    if (!pode(user, 'baixa:abrir') && !pode(user, 'estoque:gerenciar')) return fail('Seu perfil não permite consultar estoques.', 403);
    return parts.length === 1 ? baixas.listarEstoques(user) : fail('Rota não encontrada.', 404);
  }
  if (parts[0] === 'itens') {
    if (!pode(user, 'baixa:abrir') && !pode(user, 'estoque:gerenciar')) return fail('Seu perfil não permite consultar itens.',403);
    return parts.length === 1 ? baixas.listarItens(user,request.nextUrl.searchParams) : fail('Rota não encontrada.',404);
  }
  if (parts[0] === 'solicitacoes') {
    if (!pode(user, 'solicitacao:abrir')) return fail('Seu perfil não permite consultar solicitações.', 403);
    if (parts.length === 1) return solicitacoes.listar(user, request.nextUrl.searchParams);
    if (parts.length === 3 && parts[1] === 'cnpj') {
      if (await first(VALIDACAO_ATIVA_SQL)) return ok({ error: 'Sistema em atualização, aguarde alguns instantes', codigo: 'validacao' }, { status: 503 });
      if (excedeuLimiteConsultas(user.id)) return fail(LIMITE_CONSULTAS_MENSAGEM, 429);
      // Este GET persiste a consulta; o handler declara solicitacao:abrir.
      definirAutorEscrita({ id: user.id, role: user.role, token: await tokenHash(banco.parseCookies(request).acordos_session || '') });
      return solicitacoes.consultarCnpj(user, parts[2]);
    }
    if (parts.length === 3 && parts[1] === 'cep') return excedeuLimiteConsultas(user.id) ? fail(LIMITE_CONSULTAS_MENSAGEM, 429) : solicitacoes.consultarCep(parts[2]);
    if (parts.length === 2) return solicitacoes.detalhe(user, parts[1]);
    return fail('Rota não encontrada.', 404);
  }
  if (parts[0] === 'categorias-fornecedor') {
    if (!pode(user, 'solicitacao:abrir')) return fail('Seu perfil não permite consultar categorias.', 403);
    return parts.length === 1 ? solicitacoes.listarCategorias(user) : fail('Rota não encontrada.', 404);
  }
  if (parts[0] === 'central') {
    if (parts.length === 1) return central.listar(user, request.nextUrl.searchParams);
    if (parts.length === 2) return parts[1] === 'nao-lidas' ? central.contar(user) : central.detalhe(user, parts[1]);
    return fail('Rota não encontrada.', 404);
  }
  if (parts[0] === 'bootstrap') return bootstrap(user);
  if (parts[0] === 'search') return parts[1] === 'options' ? searchOptions(request.nextUrl.searchParams) : search(request.nextUrl.searchParams);
  if (parts[0] === 'agreements' && parts[1]) return agreementDetail(parts[1], user, request.nextUrl.searchParams);

  // Guarda geral antes das permissoes especificas; preserva as respostas HTTP.
  // Consulta simples permanece disponivel acima desta guarda.
  if (!pode(user, acaoConsulta(parts))) return fail('Seu perfil permite apenas consultar acordos e preços.', 403);

  if (parts[0] === 'reports') {
    if (!pode(user, 'relatorio:consultar')) return fail('Somente administradores podem executar e consultar relatórios.', 403);
    return consultarRelatorios(parts[1], parts[2]);
  }
  if (parts[0] === 'imports' && parts[1]) return importDetail(parts[1]);
  if (parts[0] === 'imports') return ok({ imports: await importList(), total: await totalImportacoes() });
  if (parts[0] === 'mappings') {
    return mappingList();
  }
  if (parts[0] === 'audit') {
    if (!pode(user, 'auditoria:consultar')) return fail('Somente administradores podem consultar a auditoria.', 403);
    if (parts[1] === 'export') return exportAudit(request.nextUrl.searchParams);
    return ok(await auditList(request.nextUrl.searchParams));
  }
  if (parts[0] === 'email-notifications') {
    if (!pode(user, 'email:consultar')) return fail('Somente administradores podem consultar os envios de e-mail.', 403);
    return ok(await emailNotificationList(request.nextUrl.searchParams));
  }
  if (parts[0] === 'users') return userList(user);
  if (parts[0] === 'tickets' && parts[1]) return ticketDetail(parts[1]);
  if (parts[0] === 'tickets') return ok({ ...await ticketList(request.nextUrl.searchParams), stats: await ticketStats() });
  if (parts[0] === 'export' && parts[1] === 'agreements') {
    return downloadAgreements(user);
  }
  if (parts[0] === 'export') {
    if (!pode(user, 'base:exportar')) return fail('Somente administradores podem exportar a base.', 403);
    return downloadDatabase(user);
  }
  return fail('Rota não encontrada.', 404);
}


// Traduz a excecao em resposta. So mensagens de erros conhecidos chegam ao
// cliente; o resto vira 500 generico e fica registrado no log do servidor.
function respostaDeErro(erro: unknown) {
  if (erro instanceof SessaoRevogada) return fail(erro.message, 403);
  if (erro instanceof CorpoExpirado) return fail(erro.message, 408);
  if (erro instanceof TravaPerdida) return fail(erro.message, 409);
  if (erro instanceof CorpoGrandeDemais) return fail(erro.message, 413);
  if (erro instanceof EntradaInvalida) return fail(erro.message, 400);
  console.error('[portal] erro nao tratado:', erro);
  return fail('Não foi possível concluir a operação. Tente de novo; se persistir, avise o administrador.', 500);
}

export async function POST(request: NextRequest) {
  return responder(request, () => POSTInterno(request));
}

async function POSTInterno(request: NextRequest) {
  await ensureDatabase();
  const originFailure = rejectCrossOrigin(request);
  if (originFailure) return originFailure;
  const parts = partsOf(request);
  if (parts[0] === 'login') return login(request);
  if (parts[0] === 'logout') return logout(request);
  const user = await requireUser(request);
  if (!user) return fail('Sessão expirada.', 401);
  if (await first(VALIDACAO_ATIVA_SQL)) { if (request.body) await corpoBinarioLimitado(request, CORPO_MAX_JSON); return ok({ error: 'Sistema em atualização, aguarde alguns instantes', codigo: 'validacao' }, { status: 503 }); }
  if (parts[0] === 'baixas') {
    if (!pode(user, parts.length === 1 ? 'baixa:abrir' : 'baixa:atender')) return denyWrite(request, 'Seu perfil não permite esta operação.');
    if (parts.length === 1) return baixas.criar(request, user);
    return parts.length === 3 && parts[2] === 'transicao' ? baixas.transicionar(request, user, parts[1]) : fail('Rota não encontrada.', 404);
  }
  if (parts[0] === 'estoques') {
    if (!pode(user, 'estoque:gerenciar')) return denyWrite(request, 'Seu perfil não permite gerenciar estoques.');
    return parts.length === 1 ? baixas.gravarEstoque(request, user) : fail('Rota não encontrada.', 404);
  }
  if (parts[0] === 'itens') {
    if (!pode(user,'estoque:gerenciar')) return denyWrite(request,'Seu perfil não permite gerenciar itens.');
    return parts.length===1 ? baixas.gravarItem(request,user) : fail('Rota não encontrada.',404);
  }
  if (parts[0] === 'solicitacoes') {
    const acao = parts.length === 1 ? 'solicitacao:abrir' : 'solicitacao:atender';
    if (!pode(user, acao) && !(parts.length === 3 && parts[2] === 'transicao' && pode(user, 'solicitacao:abrir'))) return denyWrite(request, 'Seu perfil não permite esta operação.');
    if (parts.length === 1) return solicitacoes.criar(request, user);
    if (parts.length === 3 && parts[2] === 'transicao') return solicitacoes.transicionar(request, user, parts[1]);
    if (parts.length === 3 && parts[2] === 'reconsultar') return solicitacoes.reconsultar(request, user, parts[1]);
    return fail('Rota não encontrada.', 404);
  }
  if (parts[0] === 'categorias-fornecedor') {
    if (!pode(user, 'categoria:gerenciar')) return denyWrite(request, 'Seu perfil não permite gerenciar categorias.');
    return parts.length === 1 ? solicitacoes.gravarCategoria(request, user) : fail('Rota não encontrada.', 404);
  }
  if (parts[0] === 'central') {
    await jsonBody(request);
    if (parts.length === 2 && parts[1] === 'lidas') return central.marcar(user);
    if (parts.length === 3 && parts[2] === 'lida') return central.marcar(user, parts[1]);
    return fail('Rota não encontrada.', 404);
  }
  if (!pode(user, acaoEscrita(partsOf(request)))) return denyWrite(request, 'Seu perfil permite somente consulta.');

  if (parts[0] === 'agreements' && parts.length === 1) return createAgreement(request, user);
  if (parts[0] === 'agreements' && parts[2] === 'items') return comTravaDoAcordo(request, parts[1], () => addAgreementItems(request, user, parts[1]));
  if (parts[0] === 'catalogs' && parts[1]) return createCatalog(request, user, parts[1]);
  if (parts[0] === 'users') return createUser(request, user);
  if (parts[0] === 'tickets' && parts[1] && parts[2] === 'events') return comTravaDoChamado(request, parts[1], () => addTicketEvent(request, user, parts[1]));
  if (parts[0] === 'tickets' && parts.length === 1) return createTicket(request, user);
  if (parts[0] === 'daily-report-deliveries' && parts[1] && parts[2] === 'retry') return retryEmailNotification(user, parts[1], 'diario');
  if (parts[0] === 'email-notifications' && parts[1] && parts[2] === 'retry') return retryEmailNotification(user, parts[1]);
  if (parts[0] === 'imports' && parts[1] === 'agreement' && parts[2]) return importWorkbook(request, user, parts[2]);
  if (parts[0] === 'reports') {if(!pode(user, 'relatorio:executar'))return denyWrite(request,'Somente administradores podem executar relatórios.');return solicitarRelatorio(await jsonBody(request),user.id);}
  if (parts[0] === 'mappings' && parts[1]) return createMapping(request, user, parts[1]);
  return fail('Rota não encontrada.', 404);
}

export async function PUT(request: NextRequest) {
  return responder(request, () => PUTInterno(request));
}

async function PUTInterno(request: NextRequest) {
  await ensureDatabase();
  const originFailure = rejectCrossOrigin(request);
  if (originFailure) return originFailure;
  const user = await requireUser(request);
  if (!user) return fail('Sessão expirada.', 401);
  if (await first(VALIDACAO_ATIVA_SQL)) { if (request.body) await corpoBinarioLimitado(request, CORPO_MAX_JSON); return ok({ error: 'Sistema em atualização, aguarde alguns instantes', codigo: 'validacao' }, { status: 503 }); }
  const partesSolicitacao = partsOf(request);
  if (partesSolicitacao[0] === 'estoques') {
    if (!pode(user, 'estoque:gerenciar')) return denyWrite(request, 'Seu perfil não permite gerenciar estoques.');
    return partesSolicitacao.length === 2 ? baixas.gravarEstoque(request, user, partesSolicitacao[1]) : fail('Rota não encontrada.', 404);
  }
  if (partesSolicitacao[0] === 'itens') {
    if (!pode(user,'estoque:gerenciar')) return denyWrite(request,'Seu perfil não permite gerenciar itens.');
    return partesSolicitacao.length===2 ? baixas.gravarItem(request,user,partesSolicitacao[1]) : fail('Rota não encontrada.',404);
  }
  if (partesSolicitacao[0] === 'solicitacoes') {
    if (!pode(user, 'solicitacao:abrir')) return denyWrite(request, 'Seu perfil não permite corrigir solicitações.');
    return partesSolicitacao.length === 2 ? solicitacoes.corrigir(request, user, partesSolicitacao[1]) : fail('Rota não encontrada.', 404);
  }
  if (partesSolicitacao[0] === 'categorias-fornecedor') {
    if (!pode(user, 'categoria:gerenciar')) return denyWrite(request, 'Seu perfil não permite gerenciar categorias.');
    return partesSolicitacao.length === 2 ? solicitacoes.gravarCategoria(request, user, partesSolicitacao[1]) : fail('Rota não encontrada.', 404);
  }
  if (!pode(user, acaoEscrita(partsOf(request)))) return denyWrite(request, 'Seu perfil permite somente consulta.');
  const parts = partsOf(request);
  if (parts[0] === 'agreements' && parts[1] && parts.length === 2) return comTravaDoAcordo(request, parts[1], () => updateAgreement(request, user, parts[1]));
  if (parts[0] === 'items' && parts[1]) return comTravaDoAcordo(request, await acordoDaCondicao(parts[1]), () => updateItem(request, user, parts[1]));
  if (parts[0] === 'catalogs' && parts[1] && parts[2]) return updateCatalog(request, user, parts[1], parts[2]);
  if (parts[0] === 'users' && parts[1]) return updateUser(request, user, parts[1]);
  if (parts[0] === 'tickets' && parts[1]) return comTravaDoChamado(request, parts[1], () => updateTicket(request, user, parts[1]));
  if (parts[0] === 'mappings' && parts[1] && parts[2]) return updateMapping(request, user, parts[1], parts[2]);
  return fail('Rota não encontrada.', 404);
}

export async function DELETE(request: NextRequest) {
  return responder(request, () => DELETEInterno(request));
}

async function DELETEInterno(request: NextRequest) {
  await ensureDatabase();
  const originFailure = rejectCrossOrigin(request);
  if (originFailure) return originFailure;
  const user = await requireUser(request);
  if (!user) return fail('Sessão expirada.', 401);
  if (await first(VALIDACAO_ATIVA_SQL)) { if (request.body) await corpoBinarioLimitado(request, CORPO_MAX_JSON); return ok({ error: 'Sistema em atualização, aguarde alguns instantes', codigo: 'validacao' }, { status: 503 }); }
  if (!pode(user, acaoEscrita(partsOf(request)))) return fail('Seu perfil permite somente consulta.', 403);
  const parts = partsOf(request);
  if (parts[0] === 'items' && parts[1]) {
    return comTravaDoAcordo(request, await acordoDaCondicao(parts[1]), () => deleteItem(user, parts[1], revisaoDaQuery(request)));
  }
  if (parts[0] === 'agreements' && parts[1] && parts.length === 2) {
    if (!pode(user, 'acordo:excluir')) return fail('Somente administradores podem excluir um acordo. Um acordo apagado leva consigo os preços e todo o histórico de versões.', 403);
    return comTravaDoAcordo(request, parts[1], () => deleteAgreement(user, parts[1], revisaoDaQuery(request)));
  }
  if (parts[0] === 'catalogs' && parts[1] && parts[2]) return deleteCatalog(user, parts[1], parts[2], revisaoDaQuery(request));
  if (parts[0] === 'reports' && parts[1]) {if(!pode(user, 'relatorio:cancelar'))return fail('Somente administradores podem cancelar relatórios.',403);return cancelarRelatorio(parts[1],user.id);}
  if (parts[0] === 'mappings' && parts[1] && parts[2]) return deleteMapping(user, parts[1], parts[2], revisaoDaQuery(request));
  return fail('Rota não encontrada.', 404);
}
