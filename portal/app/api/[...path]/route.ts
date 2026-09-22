import { ATUALIZAR_USUARIO_SQL } from '@/lib/usuarios-sql';
import { montarPowerBiUrl } from '@/lib/powerbi';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { lerPlanilha } from '@/lib/planilha';
import { ConcurrencyGate } from '@/lib/concurrency';
import { chaveLocalidade, colunasAusentes, parseImportRow, resolveImportRows, summarizeImportErrors, deduplicateImportRows, uniqueIndex, type ImportTarget } from '@/lib/importacao';
import { contextoNotificacaoChamado, pessoaNotificacao, prepararNotificacoesChamado, type ContextoNotificacaoChamado } from '@/lib/fila-email-chamados';
import { corpoBinarioLimitado, corpoLimitado } from '@/lib/corpo-limitado';
import {
  CORPO_MAX_JSON, CORPO_MAX_LOGIN, CORPO_MAX_UPLOAD, EntradaInvalida,
  LIMITES_CAMPO, LIMITE_LISTA, exigeTexto,
} from '@/lib/limites-entrada';
import { env } from 'cloudflare:workers';
import {
  audit, currentUser, ensureDatabase, id, normalizeCnpj, normalizeText, now,
  PBKDF2_ITERACOES_ATUAL, TRAVA_IMPORTACAO, adquirirTrava, liberarTrava,
  parseCookies, passwordHash, rawDb, tokenHash,
} from '@/lib/database';
import {
  AGREEMENT_STATUSES,
  errorMessage,
  isOneOf,
  isRecord,
  isValidCnpj,
  isValidState,
  isValidDateRange,
  MAX_IMPORT_BYTES,
  ROLES,
  safeFilename,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  normalizeImportText,
  toNonNegativeMoney,
  validatePassword,
  type Role,
} from '@/lib/domain';

export const dynamic = 'force-dynamic';

type User = { id: string; name: string; email: string; role: Role };
type Row = Record<string, unknown>;

type AgreementInput = {
  number?: unknown;
  supplierId?: unknown;
  status?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  notes?: unknown;
  locationIds?: unknown;
};

type AgreementItemInput = {
  catalogItemId?: unknown;
  locationId?: unknown;
  unitId?: unknown;
  modelId?: unknown;
  modelIds?: unknown;
  price?: unknown;
  brands?: unknown;
  notes?: unknown;
};

type CatalogInput = Record<string, unknown>;
type UserInput = { name?: unknown; email?: unknown; password?: unknown; role?: unknown; active?: unknown; dailyReportEnabled?: unknown; dailyReportTime?: unknown };
type TicketInput = Record<string, unknown>;
type MappingInput = { source?: unknown; targetId?: unknown; active?: unknown; notes?: unknown };

const ok = (data: unknown, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return NextResponse.json(data, { ...init, headers });
};
const fail = (message: string, status = 400) => ok({ error: message }, { status });
// Respostas antecipadas a escritas precisam finalizar o corpo HTTP. No runtime
// local, deixar um corpo pequeno pendente pode derrubar a conexão reutilizada.
// Mantém o limite mesmo em pedidos não autorizados.
async function denyWrite(request: Request, message: string) {
  if (request.body) await corpoBinarioLimitado(request, CORPO_MAX_JSON);
  return fail(message, 403);
}
const partsOf = (request: Request) => new URL(request.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
const canWrite = (user: User) => user.role === 'admin' || user.role === 'editor';
const all = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await rawDb().prepare(sql).bind(...values).all<T>()).results;
const first = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => rawDb().prepare(sql).bind(...values).first<T>();

async function requireUser(request: Request) {
  const user = await currentUser(request);
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

// A credencial interna vem do ambiente do Worker, entregue pelo
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
  constructor(public readonly maximo: number) {
    super(`Corpo da requisição acima do limite de ${Math.round(maximo / 1024)} KB.`);
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
  return (isRecord(value) ? value : {}) as T;
}

const textValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '');



const nullableText = (value: unknown) => textValue(value) || null;
const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];

// Aplicado em validateAgreementInput, abaixo.
type ValidAgreementInput = {
  number: string;
  supplierId: string;
  status: (typeof AGREEMENT_STATUSES)[number];
  startDate: string;
  endDate: string | null;
  notes: string | null;
  locationIds: string[];
};

function validateAgreementInput(body: AgreementInput): { value?: ValidAgreementInput; error?: string } {
  const number = textValue(body.number);
  const supplierId = textValue(body.supplierId);
  const startDate = textValue(body.startDate);
  const endDate = nullableText(body.endDate);
  const status = body.status ?? 'draft';
  const locationIds = Array.from(new Set(stringList(body.locationIds)));
  if (!number || !supplierId || !startDate) return { error: 'Número, fornecedor e início da vigência são obrigatórios.' };
  if (number.length > 80) return { error: 'O número do acordo deve ter no máximo 80 caracteres.' };
  if (!isOneOf(status, AGREEMENT_STATUSES)) return { error: 'Situação do acordo inválida.' };
  if (!isValidDateRange(startDate, endDate)) return { error: 'Confira as datas: o fim não pode ser anterior ao início.' };
  if (textValue(body.notes).length > LIMITES_CAMPO.observacoes) return { error: `As observações passam do limite de ${LIMITES_CAMPO.observacoes} caracteres.` };
  if (locationIds.length > LIMITE_LISTA) return { error: `O acordo tem ${locationIds.length} localidades, acima do limite de ${LIMITE_LISTA}.` };
  if (!locationIds.length) return { error: 'Selecione pelo menos uma localidade.' };
  return { value: { number, supplierId, status, startDate, endDate, notes: nullableText(body.notes), locationIds } };
}

export async function GET(request: NextRequest) {
  await ensureDatabase();
  const parts = partsOf(request);
  if (parts[0] === 'health') return ok({ app: 'portal-suprimentos', status: 'ok', schemaVersion: 1 });
  if (parts[0] === 'session') return ok({ user: await currentUser(request) });
  if (parts[0] === 'internal' && parts[1] === 'agreements') {
    if (!tokenInternoValido(request)) return fail('Credencial interna inválida.', 401);
    return internalAgreements();
  }
  const user = await requireUser(request);
  if (!user) return fail('Sessão expirada.', 401);

  if (parts[0] === 'bootstrap') return bootstrap(user);
  if (parts[0] === 'search') return search(request.nextUrl.searchParams);
  if (parts[0] === 'agreements' && parts[1]) return agreementDetail(parts[1], user, request.nextUrl.searchParams);

  // Daqui para baixo, somente quem tem perfil de escrita (admin/editor).
  // O perfil de consulta enxerga apenas acordos e a busca de preços.
  if (!canWrite(user)) return fail('Seu perfil permite apenas consultar acordos e preços.', 403);

  if (parts[0] === 'imports' && parts[1]) return importDetail(parts[1]);
  if (parts[0] === 'imports') return ok({ imports: await importList() });
  if (parts[0] === 'mappings') {
    if (user.role !== 'admin') return fail('Somente administradores podem gerenciar o De/Para.', 403);
    return mappingList();
  }
  if (parts[0] === 'audit') {
    if (user.role !== 'admin') return fail('Somente administradores podem consultar a auditoria.', 403);
    return ok(await auditList(request.nextUrl.searchParams));
  }
  if (parts[0] === 'email-notifications') {
    if (user.role !== 'admin') return fail('Somente administradores podem consultar os envios de e-mail.', 403);
    return ok(await emailNotificationList());
  }
  if (parts[0] === 'users') return ok({ users: user.role === 'admin'
    ? await all('SELECT id,name,email,role,active,daily_report_enabled AS dailyReportEnabled,daily_report_time AS dailyReportTime,created_at AS createdAt FROM users ORDER BY name')
    : await all('SELECT id,name FROM users WHERE active=1 ORDER BY name') });
  if (parts[0] === 'tickets' && parts[1]) return ticketDetail(parts[1]);
  if (parts[0] === 'tickets') return ok({ tickets: await ticketList(), stats: await ticketStats() });
  if (parts[0] === 'export' && parts[1] === 'agreements') {
    const resposta = await exportAgreements();
    await audit(user.id, 'EXPORT', 'agreement', null, 'Planilha de acordos gerada para download');
    return resposta;
  }
  if (parts[0] === 'export') {
    if (user.role !== 'admin') return fail('Somente administradores podem exportar a base.', 403);
    // Monta primeiro e so entao registra: gravar antes faria a auditoria
    // afirmar que houve download mesmo se a exportacao falhasse.
    const resposta = await exportDatabase();
    await audit(user.id, 'EXPORT', 'system', null, 'Backup completo da base gerado para download');
    return resposta;
  }
  return fail('Rota não encontrada.', 404);
}


// Traduz a excecao em resposta. So mensagens de erros conhecidos chegam ao
// cliente; o resto vira 500 generico e fica registrado no log do servidor.
function respostaDeErro(erro: unknown) {
  if (erro instanceof CorpoGrandeDemais) return fail(erro.message, 413);
  if (erro instanceof EntradaInvalida) return fail(erro.message, 400);
  console.error('[portal] erro nao tratado:', erro);
  return fail('Não foi possível concluir a operação. Tente de novo; se persistir, avise o administrador.', 500);
}

export async function POST(request: NextRequest) {
  try { return await POSTInterno(request); }
  catch (erro: unknown) { return respostaDeErro(erro); }
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
  if (!canWrite(user)) return denyWrite(request, 'Seu perfil permite somente consulta.');

  if (parts[0] === 'agreements' && parts[1] === 'confirmar-provisorios') return confirmarProvisorios(request, user);
  if (parts[0] === 'agreements' && parts.length === 1) return createAgreement(request, user);
  if (parts[0] === 'agreements' && parts[2] === 'items') return addAgreementItems(request, user, parts[1]);
  if (parts[0] === 'catalogs' && parts[1]) return createCatalog(request, user, parts[1]);
  if (parts[0] === 'users') return createUser(request, user);
  if (parts[0] === 'tickets' && parts[1] && parts[2] === 'events') return addTicketEvent(request, user, parts[1]);
  if (parts[0] === 'tickets' && parts.length === 1) return createTicket(request, user);
  if (parts[0] === 'email-notifications' && parts[1] && parts[2] === 'retry') return retryEmailNotification(user, parts[1]);
  if (parts[0] === 'imports' && parts[1] === 'agreement' && parts[2]) return importWorkbook(request, user, parts[2]);
  if (parts[0] === 'mappings' && parts[1]) return createMapping(request, user, parts[1]);
  return fail('Rota não encontrada.', 404);
}

export async function PUT(request: NextRequest) {
  try { return await PUTInterno(request); }
  catch (erro: unknown) { return respostaDeErro(erro); }
}

async function PUTInterno(request: NextRequest) {
  await ensureDatabase();
  const originFailure = rejectCrossOrigin(request);
  if (originFailure) return originFailure;
  const user = await requireUser(request);
  if (!user) return fail('Sessão expirada.', 401);
  if (!canWrite(user)) return denyWrite(request, 'Seu perfil permite somente consulta.');
  const parts = partsOf(request);
  if (parts[0] === 'agreements' && parts[1] && parts.length === 2) return updateAgreement(request, user, parts[1]);
  if (parts[0] === 'items' && parts[1]) return updateItem(request, user, parts[1]);
  if (parts[0] === 'catalogs' && parts[1] && parts[2]) return updateCatalog(request, user, parts[1], parts[2]);
  if (parts[0] === 'users' && parts[1]) return updateUser(request, user, parts[1]);
  if (parts[0] === 'tickets' && parts[1]) return updateTicket(request, user, parts[1]);
  if (parts[0] === 'mappings' && parts[1] && parts[2]) return updateMapping(request, user, parts[1], parts[2]);
  return fail('Rota não encontrada.', 404);
}

export async function DELETE(request: NextRequest) {
  try { return await DELETEInterno(request); }
  catch (erro: unknown) { return respostaDeErro(erro); }
}

async function DELETEInterno(request: NextRequest) {
  await ensureDatabase();
  const originFailure = rejectCrossOrigin(request);
  if (originFailure) return originFailure;
  const user = await requireUser(request);
  if (!user) return fail('Sessão expirada.', 401);
  if (!canWrite(user)) return fail('Seu perfil permite somente consulta.', 403);
  const parts = partsOf(request);
  if (parts[0] === 'items' && parts[1]) {
    const item = await first<{ id: string }>('SELECT ai.id FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id WHERE ai.id=?', [parts[1]]);
    if (!item) return fail('Condição não encontrada na versão vigente.', 404);
    await rawDb().prepare('DELETE FROM agreement_items WHERE id=?').bind(parts[1]).run();
    await audit(user.id, 'DELETE', 'agreement_item', parts[1], 'Item removido manualmente');
    return ok({ success: true });
  }
  if (parts[0] === 'agreements' && parts[1] && parts.length === 2) return deleteAgreement(user, parts[1]);
  if (parts[0] === 'catalogs' && parts[1] && parts[2]) return deleteCatalog(user, parts[1], parts[2]);
  if (parts[0] === 'mappings' && parts[1] && parts[2]) return deleteMapping(user, parts[1], parts[2]);
  return fail('Rota não encontrada.', 404);
}

// Exclusao de acordo. Só administrador: apaga preco negociado e todo o
// historico de versoes, que e justamente o que o versionamento existe para
// preservar. Um comprador que erra o cadastro pede ao administrador.
//
// Quatro tabelas apontam para agreements, e elas se dividem em duas naturezas:
//
//   FILHAS (existem por causa do acordo, vao junto):
//     agreement_versions -> agreement_items
//     agreement_locations
//
//   INDEPENDENTES (tem valor proprio, NAO podem ser apagadas):
//     imports  - registro de que uma planilha foi processada, e historico
//     tickets  - chamado de negociacao, que e trabalho da equipe
//
// Para as independentes a referencia e apenas anulada. Apagar um chamado
// porque o acordo saiu seria destruir informacao que nao pertence ao acordo.
async function deleteAgreement(user: User, agreementId: string) {
  if (user.role !== 'admin') {
    return fail('Somente administradores podem excluir um acordo. Um acordo apagado leva consigo os preços e todo o histórico de versões.', 403);
  }

  const acordo = await first<{ number: string; supplier: string }>(
    'SELECT a.number, s.trade_name AS supplier FROM agreements a JOIN suppliers s ON s.id=a.supplier_id WHERE a.id=?',
    [agreementId],
  );
  if (!acordo) return fail('Acordo não encontrado.', 404);

  // Conta antes de apagar, para o registro de auditoria dizer o tamanho do
  // estrago e permitir conferir depois.
  const condicoes = Number((await first<{ n: number }>(
    'SELECT COUNT(*) n FROM agreement_items WHERE version_id IN (SELECT id FROM agreement_versions WHERE agreement_id=?)',
    [agreementId]))?.n || 0);
  const versoes = Number((await first<{ n: number }>(
    'SELECT COUNT(*) n FROM agreement_versions WHERE agreement_id=?', [agreementId]))?.n || 0);
  const chamados = Number((await first<{ n: number }>(
    'SELECT COUNT(*) n FROM tickets WHERE agreement_id=?', [agreementId]))?.n || 0);

  const db = rawDb();
  await db.batch([
    // current_version_id aponta para agreement_versions: precisa sair antes,
    // senao a exclusao das versoes viola a chave estrangeira.
    db.prepare('UPDATE agreements SET current_version_id=NULL WHERE id=?').bind(agreementId),
    db.prepare('DELETE FROM agreement_items WHERE version_id IN (SELECT id FROM agreement_versions WHERE agreement_id=?)').bind(agreementId),
    db.prepare('DELETE FROM agreement_versions WHERE agreement_id=?').bind(agreementId),
    db.prepare('DELETE FROM agreement_locations WHERE agreement_id=?').bind(agreementId),
    // Independentes: perdem o vinculo, nao a existencia.
    db.prepare('UPDATE imports SET agreement_id=NULL WHERE agreement_id=?').bind(agreementId),
    db.prepare('UPDATE tickets SET agreement_id=NULL WHERE agreement_id=?').bind(agreementId),
    db.prepare('DELETE FROM agreements WHERE id=?').bind(agreementId),
  ]);

  const detalhe = `Acordo ${acordo.number} (${acordo.supplier}) excluído: ${condicoes} condição(ões) e ${versoes} versão(ões) apagadas` +
    (chamados > 0 ? `; ${chamados} chamado(s) preservado(s), sem o vínculo` : '');
  await audit(user.id, 'DELETE', 'agreement', agreementId, detalhe);
  return ok({ success: true, condicoes, versoes, chamadosDesvinculados: chamados });
}

// Cadastros so podem ser apagados quando nada depende deles. Caso contrario a
// exclusao deixaria acordos e condicoes apontando para um registro inexistente,
// entao o portal explica o que trava e sugere inativar.
const catalogDependencies: Record<string, { table: string; queries: Array<[string, string]> }> = {
  suppliers: { table: 'suppliers', queries: [['acordo(s)', 'SELECT COUNT(*) n FROM agreements WHERE supplier_id=?']] },
  items: { table: 'catalog_items', queries: [['condição(ões)', 'SELECT COUNT(*) n FROM agreement_items WHERE catalog_item_id=?'], ['correspondência(s) de De/Para', 'SELECT COUNT(*) n FROM import_item_mappings WHERE target_id=?']] },
  models: { table: 'vehicle_models', queries: [['condição(ões)', 'SELECT COUNT(*) n FROM agreement_items WHERE vehicle_model_id=?'], ['correspondência(s) de De/Para', 'SELECT COUNT(*) n FROM import_model_mappings WHERE target_id=?']] },
  units: { table: 'units', queries: [['condição(ões)', 'SELECT COUNT(*) n FROM agreement_items WHERE unit_id=?'], ['correspondência(s) de De/Para', 'SELECT COUNT(*) n FROM import_unit_mappings WHERE target_id=?']] },
  brands: { table: 'brands', queries: [] },
  locations: { table: 'locations', queries: [['condição(ões)', 'SELECT COUNT(*) n FROM agreement_items WHERE location_id=?'], ['acordo(s)', 'SELECT COUNT(*) n FROM agreement_locations WHERE location_id=?'], ['correspondência(s) de De/Para', 'SELECT COUNT(*) n FROM import_location_mappings WHERE target_id=?']] },
};

async function deleteCatalog(user: User, type: string, recordId: string) {
  const cfg = catalogDependencies[type];
  if (!cfg) return fail('Cadastro inválido.');
  const existing = await first<{ id: string }>(`SELECT id FROM ${cfg.table} WHERE id=?`, [recordId]);
  if (!existing) return fail('Cadastro não encontrado.', 404);

  const blockers: string[] = [];
  for (const [label, sql] of cfg.queries) {
    const count = Number((await first<{ n: number }>(sql, [recordId]))?.n || 0);
    if (count > 0) blockers.push(`${count} ${label}`);
  }
  if (blockers.length) {
    return fail(`Não é possível excluir: este cadastro está em uso por ${blockers.join(' e ')}. Inative-o para tirá-lo das novas seleções sem perder o histórico.`, 409);
  }

  const label = await first<{ nome: string }>(
    type === 'suppliers' ? 'SELECT trade_name AS nome FROM suppliers WHERE id=?'
    : type === 'units' ? 'SELECT code AS nome FROM units WHERE id=?'
    : type === 'locations' ? `SELECT city || ' / ' || state AS nome FROM locations WHERE id=?`
    : `SELECT name AS nome FROM ${cfg.table} WHERE id=?`, [recordId]);

  await rawDb().prepare(`DELETE FROM ${cfg.table} WHERE id=?`).bind(recordId).run();
  await audit(user.id, 'DELETE', type, recordId, `${label?.nome || recordId} excluído do cadastro`);
  return ok({ success: true });
}

// Cabecalhos de origem sao controlados pelo cliente quando o portal e acessado
// direto na LAN: um atacante enviaria cf-connecting-ip diferente a cada
// tentativa e ganharia um contador novo. Enquanto nao houver um proxy reverso
// confiavel na frente, todo mundo compartilha o mesmo balde 'local'.
// TRUSTED_PROXY so deve ser ligado quando existir esse proxy.
const clientIp = (request: Request) => {
  const confiavel = (env as unknown as { TRUSTED_PROXY?: string }).TRUSTED_PROXY === 'true';
  if (!confiavel) return 'local';
  return (request.headers.get('cf-ray') ? request.headers.get('cf-connecting-ip') : null)
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'local';
};

function equalHex(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

// Estrategia de defesa contra forca bruta.
//
// Neste ambiente (Vite/Miniflare sem proxy reverso) NAO ha como distinguir a
// origem: todos os clientes da LAN chegam sem x-forwarded-for e cairiam no
// mesmo balde. Se o bloqueio fosse cego, uma pessoa errando a senha derrubaria
// o portal inteiro -- e a manutencao@ e compartilhada, o que piora o risco.
//
// Por isso a ordem e invertida: a credencial e SEMPRE conferida primeiro.
// Quem acerta a senha entra, independente de quantas falhas houve antes.
// O custo recai apenas sobre quem erra, na forma de atraso progressivo, o que
// torna a forca bruta inviavel sem jamais trancar um usuario legitimo.
const LOGIN_WINDOW_MIN = 15;
const LOGIN_SOFT_LIMIT = 5;    // a partir daqui, atraso progressivo
const LOGIN_DELAY_MAX_MS = 4000;

// Salt usado quando a conta nao existe ou esta inativa. Precisa ser um valor
// proprio e constante: usar o salt de um usuario real daria pista sobre a base.
const SALT_INEXISTENTE = 'conta-inexistente-salt-fixo-nao-usar-em-usuario-real';

// Limites conservadores por processo, a calibrar na homologação do servidor.
const loginGate = new ConcurrencyGate(4, 16);
async function login(request: Request) {
  const texto = await corpoLimitado(request, CORPO_MAX_LOGIN);
  if (texto === null) return fail('E-mail ou senha inválidos.', 401);
  const release = await loginGate.acquire();
  if (!release) {
    return ok({ error: 'Muitos acessos simultâneos. Tente novamente em alguns segundos.' }, { status: 503, headers: { 'Retry-After': '5' } });
  }
  try { return await authenticate(request, texto); }
  finally { release(); }
}

async function authenticate(request: Request, texto: string) {
  const ip = clientIp(request);
  const agora = now();
  const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60 * 1000).toISOString();

  let body: { email?: unknown; password?: unknown };
  try { body = JSON.parse(texto || '{}'); }
  catch { return fail('E-mail ou senha inválidos.', 401); }
  if (!isRecord(body)) return fail('E-mail ou senha inválidos.', 401);

  const email = textValue(body.email).toLowerCase();
  // Mede a senha CRUA, nao a aparada: "espacos + texto" passaria pelo limite se
  // o tamanho fosse medido depois do trim, e o PBKDF2 receberia o valor inteiro.
  const senhaCrua = typeof body.password === 'string' ? body.password : '';
  if (email.length > 254 || senhaCrua.length > 200) {
    return fail('E-mail ou senha inválidos.', 401);
  }

  // Registra a tentativa ANTES de contar. Contar e depois inserir permitia que
  // varias requisicoes paralelas lessem a mesma contagem antiga e escapassem
  // todas do atraso; inserindo primeiro, cada uma enxerga as anteriores.
  const idTentativa = id('att');
  await rawDb().prepare('INSERT INTO login_attempts (id,ip,email,success,created_at) VALUES (?,?,?,0,?)')
    .bind(idTentativa, ip, email || null, agora).run();

  // Limpeza deterministica, no lugar do sorteio de 5%: roda sempre, e o indice
  // por (ip, created_at) mantem o custo baixo.
  await rawDb().prepare('DELETE FROM login_attempts WHERE created_at<?')
    .bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).run();

  // Duas contagens. A do e-mail freia o ataque a uma conta especifica; a global
  // freia o atacante que troca de e-mail a cada tentativa justamente para nunca
  // acionar o contador por conta.
  const [porEmail, global] = await Promise.all([
    first<{ n: number }>('SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND email IS ? AND success=0 AND created_at>?', [ip, email || null, since]),
    first<{ n: number }>('SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND success=0 AND created_at>?', [ip, since]),
  ]);
  const fails = Math.max(Number(porEmail?.n || 0), Math.floor(Number(global?.n || 0) / 1.5));

  const record = await first<{ id: string; name: string; email: string; role: string; password_salt: string; password_hash: string; password_iterations: number }>('SELECT * FROM users WHERE lower(email)=? AND active=1', [email]);

  // Custo do hash. Para conta inexistente ou inativa usa o custo ATUAL, nao o
  // legado: com o legado, e-mail que nao existe respondia sempre rapido e
  // e-mail migrado sempre devagar, o que permitia enumerar contas pelo tempo.
  //
  // RISCO ACEITO ate a migracao terminar: as contas ainda em 120 mil respondem
  // mais rapido que as demais, e isso identifica que o e-mail EXISTE e e uma
  // conta antiga. Some sozinho conforme cada usuario entra e tem o hash
  // regravado com 600 mil. Enquanto houver conta legada, a enumeracao e
  // possivel para esse subconjunto.
  const iteracoesDoHash = Number(record?.password_iterations) || PBKDF2_ITERACOES_ATUAL;
  // Salt ficticio proprio: nunca o de um usuario real, para nao dar pista
  // alguma sobre a base.
  const candidate = await passwordHash(typeof body.password === 'string' ? body.password : '', record?.password_salt || SALT_INEXISTENTE, iteracoesDoHash);
  const okLogin = !!record && equalHex(candidate, record.password_hash);

  // O atraso pune apenas o erro; quem acerta nunca espera.
  if (!okLogin && fails >= LOGIN_SOFT_LIMIT) {
    await new Promise((r) => setTimeout(r, Math.min(LOGIN_DELAY_MAX_MS, 400 * (fails - LOGIN_SOFT_LIMIT + 1))));
  }

  // A tentativa ja foi gravada como falha antes da contagem; se a senha estava
  // certa, apenas marca o sucesso.
  if (okLogin) {
    await rawDb().prepare('UPDATE login_attempts SET success=1 WHERE id=?').bind(idTentativa).run();
  }

  if (!okLogin) {
    // Audita so na virada do limite, nao a cada tentativa: antes, um ataque
    // longo enchia a auditoria de linhas repetidas e escondia o resto.
    if (fails === LOGIN_SOFT_LIMIT || fails === LOGIN_SOFT_LIMIT * 4) {
      await audit(null, 'BLOCKED', 'session', null, `${fails} tentativas malsucedidas em ${LOGIN_WINDOW_MIN} min (alvo: ${email || 'sem e-mail'})`);
    }
    return fail('E-mail ou senha inválidos.', 401);
  }

  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const guardado = await tokenHash(token);
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await rawDb().batch([
    rawDb().prepare('INSERT INTO sessions (token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').bind(guardado, record!.id, expires, agora),
    // Acerto limpa o historico de erros daquele e-mail nesta origem.
    rawDb().prepare('DELETE FROM login_attempts WHERE ip=? AND email IS ? AND success=0').bind(ip, email || null),
    // Higiene: sessoes vencidas e tentativas antigas.
    rawDb().prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),
    rawDb().prepare('DELETE FROM login_attempts WHERE created_at<?').bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);

  // Migracao silenciosa do custo: quem entrou com uma senha de custo antigo tem
  // o hash regravado agora, com a senha em maos e ja validada. Cada usuario se
  // atualiza sozinho no proprio ritmo, sem ninguem perder acesso.
  if (iteracoesDoHash < PBKDF2_ITERACOES_ATUAL && typeof body.password === 'string') {
    const salNovo = crypto.randomUUID();
    const hashNovo = await passwordHash(body.password, salNovo, PBKDF2_ITERACOES_ATUAL);
    await rawDb().prepare('UPDATE users SET password_salt=?,password_hash=?,password_iterations=? WHERE id=?')
      .bind(salNovo, hashNovo, PBKDF2_ITERACOES_ATUAL, record!.id).run();
  }
  await audit(record!.id, 'LOGIN', 'session', null, `Acesso realizado de ${ip}`);
  const response = ok({ user: { id: record!.id, name: record!.name, email: record!.email, role: record!.role } });
  response.cookies.set('acordos_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge: 43200,
  });
  return response;
}

async function logout(request: Request) {
  // Mesmo leitor do currentUser. A expressao regular que estava aqui casava
  // tambem com um cookie como x_acordos_session vindo antes: o navegador
  // perdia o cookie, mas a sessao verdadeira continuava valida no banco.
  const token = parseCookies(request).acordos_session;
  const user = token ? await currentUser(request) : null;
  if (token) await rawDb().prepare('DELETE FROM sessions WHERE token=?').bind(await tokenHash(token)).run();
  if (user) await audit(user.id, 'LOGOUT', 'session', null, 'Sessão encerrada pelo usuário');
  const response = ok({ success: true });
  response.cookies.set('acordos_session', '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge: 0,
  });
  return response;
}

// Endereco do relatorio de Manutencao. Vai so na resposta do bootstrap, que
// exige login; ver lib/powerbi.ts.
function relatorioManutencao() {
  const vars = env as unknown as { PBI_RELATORIO_URL?: string; PBI_PAGINA?: string };
  return montarPowerBiUrl(vars.PBI_RELATORIO_URL, vars.PBI_PAGINA);
}

async function bootstrap(user: User) {
  if (!canWrite(user)) {
    const [metrics, agreements, suppliers, items, models, locations] = await Promise.all([
      first('SELECT COUNT(*) AS agreements FROM agreements'), agreementList(),
      all('SELECT id,trade_name AS tradeName FROM suppliers ORDER BY trade_name'),
      all('SELECT id,name FROM catalog_items ORDER BY name'),
      all('SELECT id,name FROM vehicle_models ORDER BY name'),
      all('SELECT id,city,state FROM locations ORDER BY state,city'),
    ]);
    return ok({ user, metrics, agreements, catalogs: { suppliers, items, models, locations, units: [], brands: [] }, imports: [], manutencao: relatorioManutencao() });
  }
  const [metrics, agreements, suppliers, items, models, units, brands, locations, imports] = await Promise.all([
    first(`SELECT
      (SELECT COUNT(*) FROM agreements) agreements,
      (SELECT COUNT(*) FROM agreements WHERE status='active' AND date(start_date)<=date('now') AND (end_date IS NULL OR date(end_date)>=date('now'))) activeAgreements,
      (SELECT COUNT(*) FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id WHERE a.status='active' AND date(a.start_date)<=date('now') AND (a.end_date IS NULL OR date(a.end_date)>=date('now'))) searchableItems,
      (SELECT COUNT(*) FROM agreements WHERE provisional=1) provisional,
      (SELECT COUNT(*) FROM suppliers WHERE active=1) suppliers,
      (SELECT COUNT(*) FROM agreements WHERE status='active' AND end_date IS NOT NULL AND date(end_date) BETWEEN date('now') AND date('now','+60 day')) expiring`),
    agreementList(), all('SELECT id,legal_name AS legalName,trade_name AS tradeName,cnpj,city,state,active FROM suppliers ORDER BY trade_name'),
    all('SELECT id,name,active FROM catalog_items ORDER BY name'), all('SELECT id,name,active FROM vehicle_models ORDER BY name'),
    all('SELECT id,code,name,active FROM units ORDER BY code'), all('SELECT id,name,active FROM brands ORDER BY name'),
    all('SELECT id,city,state FROM locations ORDER BY state,city'), canWrite(user) ? importList() : Promise.resolve([]),
  ]);
  return ok({ user, metrics, agreements, catalogs: { suppliers, items, models, units, brands, locations }, imports, manutencao: relatorioManutencao() });
}

async function agreementList() {
  return all(`SELECT a.id,a.number,a.status,a.start_date AS startDate,a.end_date AS endDate,a.provisional,a.updated_at AS updatedAt,
    CASE WHEN a.status='active' AND date(a.start_date)>date('now') THEN 'scheduled'
      WHEN a.status='active' AND a.end_date IS NOT NULL AND date(a.end_date)<date('now') THEN 'expired'
      WHEN a.status='active' AND a.end_date IS NOT NULL AND date(a.end_date) BETWEEN date('now') AND date('now','+60 day') THEN 'expiring'
      ELSE a.status END AS effectiveStatus,
    s.trade_name AS supplier,s.cnpj,
    (SELECT COUNT(*) FROM agreement_locations al WHERE al.agreement_id=a.id) AS locationCount,
    (SELECT COUNT(*) FROM agreement_items ai WHERE ai.version_id=a.current_version_id) AS itemCount,
    (SELECT GROUP_CONCAT(l.city || ' / ' || l.state) FROM agreement_locations al JOIN locations l ON l.id=al.location_id WHERE al.agreement_id=a.id) AS locations
    FROM agreements a JOIN suppliers s ON s.id=a.supplier_id
    ORDER BY a.provisional DESC,a.updated_at DESC LIMIT 500`);
}

async function agreementDetail(agreementId: string, user: User, params: URLSearchParams) {
  const requestedOffset = Number(params.get('offset') || 0);
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  const limit = 500;
  const sortColumns: Record<string, string> = {
    item: 'ci.name', model: 'vm.name', location: "l.state || '/' || l.city",
    brands: "COALESCE(ai.brands_text,'')", unit: 'un.code', price: 'ai.price',
  };
  const sortColumn = sortColumns[params.get('sort') || 'item'] || sortColumns.item;
  const sortDirection = params.get('direction') === 'desc' ? 'DESC' : 'ASC';
  const agreement = await first(`SELECT a.*,
    (SELECT COUNT(*) FROM agreement_items ai WHERE ai.version_id=a.current_version_id) AS totalItems,
    CASE WHEN a.status='active' AND date(a.start_date)>date('now') THEN 'scheduled'
      WHEN a.status='active' AND a.end_date IS NOT NULL AND date(a.end_date)<date('now') THEN 'expired'
      WHEN a.status='active' AND a.end_date IS NOT NULL AND date(a.end_date) BETWEEN date('now') AND date('now','+60 day') THEN 'expiring'
      ELSE a.status END AS effectiveStatus,
    s.trade_name AS supplier,s.legal_name AS legalName,s.cnpj,u.name AS owner
    FROM agreements a JOIN suppliers s ON s.id=a.supplier_id LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id=?`, [agreementId]);
  if (!agreement) return fail('Acordo não encontrado.', 404);
  const [locations, rows, versions] = await Promise.all([
    all(`SELECT l.id,l.city,l.state FROM agreement_locations al JOIN locations l ON l.id=al.location_id WHERE al.agreement_id=? ORDER BY l.state,l.city`, [agreementId]),
    all(`SELECT ai.id,ai.price,ai.courtesy,ai.brands_text AS brands,ai.notes,ci.id AS catalogItemId,ci.name AS item,
      vm.id AS modelId,vm.name AS model,un.id AS unitId,un.code AS unit,l.id AS locationId,l.city,l.state
      FROM agreements a JOIN agreement_items ai ON ai.version_id=a.current_version_id JOIN catalog_items ci ON ci.id=ai.catalog_item_id
      JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
      WHERE a.id=? ORDER BY ${sortColumn} ${sortDirection},ai.id ASC LIMIT ? OFFSET ?`, [agreementId, limit, offset]),
    all(`SELECT version_number AS versionNumber,status,published_at AS publishedAt,created_at AS createdAt FROM agreement_versions WHERE agreement_id=? ORDER BY version_number DESC`, [agreementId]),
  ]);
  if (!canWrite(user)) {
    const { id, number, status, start_date, end_date, provisional, effectiveStatus, supplier, cnpj } = agreement;
    return ok({ agreement: { id, number, status, start_date, end_date, provisional, effectiveStatus, supplier, cnpj }, locations,
      totalItems: agreement.totalItems, offset, limit, version: agreement.current_version_id,
      items: rows.map(({ notes: _notes, ...item }) => item),
      versions: versions.map(({ versionNumber }) => ({ versionNumber })),
    });
  }
  return ok({ agreement, locations, items: rows, versions, totalItems: agreement.totalItems, offset, limit, version: agreement.current_version_id });
}

async function createAgreement(request: Request, user: User) {
  const parsed = validateAgreementInput(await jsonBody<AgreementInput>(request));
  if (!parsed.value) return fail(parsed.error || 'Dados do acordo inválidos.');
  const body = parsed.value;
  const supplier = await first<{ id: string }>('SELECT id FROM suppliers WHERE id=? AND active=1', [body.supplierId]);
  if (!supplier) return fail('Fornecedor não encontrado ou inativo.');
  const locations = await first<{ n: number }>(`SELECT COUNT(*) n FROM locations WHERE id IN (${body.locationIds.map(() => '?').join(',')})`, body.locationIds);
  if (Number(locations?.n || 0) !== body.locationIds.length) return fail('Uma ou mais localidades não existem.');
  const agreementId = id('agr'), versionId = id('ver'), timestamp = now();
  try {
    await rawDb().batch([
      rawDb().prepare(`INSERT INTO agreements (id,number,supplier_id,status,start_date,end_date,owner_user_id,notes,provisional,current_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?)`).bind(agreementId, body.number, body.supplierId, body.status, body.startDate, body.endDate, user.id, body.notes, versionId, timestamp, timestamp),
      rawDb().prepare(`INSERT INTO agreement_versions (id,agreement_id,version_number,status,published_at,created_by,created_at) VALUES (?,?,1,'published',?,?,?)`).bind(versionId, agreementId, timestamp, user.id, timestamp),
      ...body.locationIds.map((locationId) => rawDb().prepare('INSERT INTO agreement_locations (agreement_id,location_id) VALUES (?,?)').bind(agreementId, locationId)),
    ]);
    await audit(user.id, 'CREATE', 'agreement', agreementId, `Acordo ${body.number} criado`);
    return ok({ id: agreementId }, { status: 201 });
  } catch (error: unknown) { return fail(errorMessage(error).includes('UNIQUE') ? 'Já existe um acordo com esse número.' : 'Não foi possível criar o acordo.'); }
}

async function confirmarProvisorios(request: Request, user: User) {
  // A carga inicial cria um acordo por CNPJ com vigencia que ninguem informou.
  // Repetir a mesma data em 137 telas so convida a erro de digitacao, entao a
  // confirmacao e uma acao unica e auditada. Vale so para os provisorios: um
  // acordo ja conferido nunca e tocado por aqui.
  const body = await jsonBody<{ startDate?: unknown; endDate?: unknown; status?: unknown }>(request);
  const startDate = textValue(body.startDate);
  const endDate = nullableText(body.endDate);
  const status = body.status ?? 'active';
  if (!startDate) return fail('Informe o inicio da vigencia.');
  if (!isOneOf(status, AGREEMENT_STATUSES)) return fail('Situacao do acordo invalida.');
  if (!isValidDateRange(startDate, endDate)) return fail('Confira as datas: o fim nao pode ser anterior ao inicio.');
  const pendentes = await first<{ n: number }>('SELECT COUNT(*) n FROM agreements WHERE provisional=1');
  const total = Number(pendentes?.n || 0);
  if (!total) return fail('Nao ha acordos provisorios para confirmar.');
  await rawDb()
    .prepare('UPDATE agreements SET start_date=?,end_date=?,status=?,provisional=0,updated_at=? WHERE provisional=1')
    .bind(startDate, endDate, status, now())
    .run();
  await audit(user.id, 'UPDATE', 'agreement', null, `Confirmou ${total} acordo(s) provisorio(s) da carga inicial`);
  return ok({ success: true, confirmados: total });
}

async function updateAgreement(request: Request, user: User, agreementId: string) {
  const parsed = validateAgreementInput(await jsonBody<AgreementInput>(request));
  if (!parsed.value) return fail(parsed.error || 'Dados do acordo inválidos.');
  const body = parsed.value;
  const existing = await first<{ id: string }>('SELECT id FROM agreements WHERE id=?', [agreementId]);
  if (!existing) return fail('Acordo não encontrado.', 404);
  const supplier = await first<{ id: string }>('SELECT id FROM suppliers WHERE id=?', [body.supplierId]);
  if (!supplier) return fail('Fornecedor não encontrado.');
  const locations = await first<{ n: number }>(`SELECT COUNT(*) n FROM locations WHERE id IN (${body.locationIds.map(() => '?').join(',')})`, body.locationIds);
  if (Number(locations?.n || 0) !== body.locationIds.length) return fail('Uma ou mais localidades não existem.');
  try {
    await rawDb().batch([
      rawDb().prepare('UPDATE agreements SET number=?,supplier_id=?,status=?,start_date=?,end_date=?,notes=?,provisional=0,updated_at=? WHERE id=?').bind(body.number, body.supplierId, body.status, body.startDate, body.endDate, body.notes, now(), agreementId),
      rawDb().prepare('DELETE FROM agreement_locations WHERE agreement_id=?').bind(agreementId),
      ...body.locationIds.map((locationId) => rawDb().prepare('INSERT INTO agreement_locations (agreement_id,location_id) VALUES (?,?)').bind(agreementId, locationId)),
    ]);
    await audit(user.id, 'UPDATE', 'agreement', agreementId, 'Dados gerais atualizados');
    return ok({ success: true });
  } catch (error: unknown) {
    return fail(errorMessage(error).includes('UNIQUE') ? 'Já existe um acordo com esse número.' : 'Não foi possível atualizar o acordo.');
  }
}

async function addAgreementItems(request: Request, user: User, agreementId: string) {
  const body = await jsonBody<AgreementItemInput>(request);
  const catalogItemId = textValue(body.catalogItemId), locationId = textValue(body.locationId), unitId = textValue(body.unitId);
  const modelIds = Array.from(new Set(stringList(body.modelIds))), price = toNonNegativeMoney(body.price);
  // A consulta de validacao monta IN (?,?,...) com um parametro por modelo.
  if (modelIds.length > LIMITE_LISTA) return fail(`Selecione no máximo ${LIMITE_LISTA} modelos por condição.`);
  exigeTexto(body.brands, LIMITES_CAMPO.marcas, 'marcas');
  exigeTexto(body.notes, LIMITES_CAMPO.observacoes, 'observações');
  if (!catalogItemId || !locationId || !unitId || !modelIds.length || price === null) return fail('Preencha item, localidade, modelos, unidade e um preço válido.');
  const agreement = await first<{ current_version_id: string }>('SELECT current_version_id FROM agreements WHERE id=?', [agreementId]);
  if (!agreement) return fail('Acordo não encontrado.', 404);
  const permittedLocation = await first('SELECT 1 ok FROM agreement_locations WHERE agreement_id=? AND location_id=?', [agreementId, locationId]);
  if (!permittedLocation) return fail('A localidade selecionada não pertence à abrangência do acordo.');
  const references = await Promise.all([
    first('SELECT 1 ok FROM catalog_items WHERE id=? AND active=1', [catalogItemId]),
    first('SELECT 1 ok FROM units WHERE id=? AND active=1', [unitId]),
    first<{ n: number }>(`SELECT COUNT(*) n FROM vehicle_models WHERE active=1 AND id IN (${modelIds.map(() => '?').join(',')})`, modelIds),
  ]);
  if (!references[0] || !references[1] || Number(references[2]?.n || 0) !== modelIds.length) return fail('Item, unidade ou modelo inválido/inativo.');
  const timestamp = now();
  await rawDb().batch(modelIds.map((modelId) => rawDb().prepare(`INSERT INTO agreement_items (id,version_id,location_id,catalog_item_id,vehicle_model_id,unit_id,price,courtesy,brands_text,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(version_id,location_id,catalog_item_id,vehicle_model_id,unit_id) DO UPDATE SET price=excluded.price,courtesy=excluded.courtesy,brands_text=excluded.brands_text,notes=excluded.notes,updated_at=excluded.updated_at`)
    .bind(id('itm'), agreement.current_version_id, locationId, catalogItemId, modelId, unitId, price, price === 0 ? 1 : 0, nullableText(body.brands), nullableText(body.notes), timestamp, timestamp)));
  await audit(user.id, 'UPSERT', 'agreement_item', agreementId, `${modelIds.length} condição(ões) cadastrada(s)`);
  return ok({ success: true });
}

async function updateItem(request: Request, user: User, itemId: string) {
  // Os mesmos tetos de addAgreementItems. Faltavam aqui: dava para criar uma
  // condicao dentro do limite e depois edita-la sem limite nenhum.
  const body = await jsonBody<AgreementItemInput>(request);
  exigeTexto(body.brands, LIMITES_CAMPO.marcas, 'marcas');
  exigeTexto(body.notes, LIMITES_CAMPO.observacoes, 'observações');
  const catalogItemId = textValue(body.catalogItemId), locationId = textValue(body.locationId), unitId = textValue(body.unitId), modelId = textValue(body.modelId);
  const price = toNonNegativeMoney(body.price);
  if (!catalogItemId || !locationId || !unitId || !modelId || price === null) return fail('Preencha item, localidade, modelo, unidade e um preço válido.');
  const existing = await first<{ agreementId: string }>(`SELECT a.id AS agreementId FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id WHERE ai.id=?`, [itemId]);
  if (!existing) return fail('Condição não encontrada na versão vigente.', 404);
  const permittedLocation = await first('SELECT 1 ok FROM agreement_locations WHERE agreement_id=? AND location_id=?', [existing.agreementId, locationId]);
  if (!permittedLocation) return fail('A localidade selecionada não pertence à abrangência do acordo.');
  const references = await Promise.all([
    first('SELECT 1 ok FROM catalog_items WHERE id=? AND active=1', [catalogItemId]),
    first('SELECT 1 ok FROM vehicle_models WHERE id=? AND active=1', [modelId]),
    first('SELECT 1 ok FROM units WHERE id=? AND active=1', [unitId]),
  ]);
  if(references.some((reference)=>!reference)) return fail('Item, modelo ou unidade inválido/inativo.');
  try{
    await rawDb().prepare('UPDATE agreement_items SET location_id=?,catalog_item_id=?,vehicle_model_id=?,unit_id=?,price=?,courtesy=?,brands_text=?,notes=?,updated_at=? WHERE id=?')
      .bind(locationId, catalogItemId, modelId, unitId, price, price === 0 ? 1 : 0, nullableText(body.brands), nullableText(body.notes), now(), itemId).run();
  }catch(error:unknown){
    return fail(errorMessage(error).includes('UNIQUE')?'Já existe uma condição igual na versão vigente.':'Não foi possível atualizar a condição.');
  }
  await audit(user.id, 'UPDATE', 'agreement_item', itemId, 'Condição alterada manualmente');
  return ok({ success: true });
}

const catalogConfig: Record<string, { table: string; fields: string[] }> = {
  suppliers: { table: 'suppliers', fields: ['legalName', 'tradeName', 'cnpj', 'city', 'state'] },
  items: { table: 'catalog_items', fields: ['name'] }, models: { table: 'vehicle_models', fields: ['name'] },
  units: { table: 'units', fields: ['code'] }, brands: { table: 'brands', fields: ['name'] }, locations: { table: 'locations', fields: ['city', 'state'] },
};

const mappingConfig: Record<string, { table: string; targetTable: string; label: string }> = {
  items: { table: 'import_item_mappings', targetTable: 'catalog_items', label: 'item' },
  models: { table: 'import_model_mappings', targetTable: 'vehicle_models', label: 'modelo' },
  units: { table: 'import_unit_mappings', targetTable: 'units', label: 'unidade' },
  // Localidade nao tem De/Para: cidade nao e nomenclatura a traduzir, e apontar
  // uma cidade para outra so serve para esconder erro de digitacao.
};

async function mappingList() {
  const select = (table: string, target: string, label = 't.name') => all(`SELECT m.id,m.source_text AS source,m.source_key AS sourceKey,m.target_id AS targetId,${label} AS target,m.active,m.notes,m.updated_at AS updatedAt
    FROM ${table} m JOIN ${target} t ON t.id=m.target_id ORDER BY m.source_key`);
  const [items, models, units] = await Promise.all([
    select('import_item_mappings', 'catalog_items'),
    select('import_model_mappings', 'vehicle_models'),
    select('import_unit_mappings', 'units', 't.code'),
  ]);
  return ok({ items, models, units });
}

async function validateMappingInput(request: Request, type: string) {
  // O corpo e lido antes de qualquer recusa: devolver resposta sem consumir a
  // requisicao derruba a conexao do Worker, e o cliente recebe 500 no lugar do
  // 400 que explica o problema.
  const body = await jsonBody<MappingInput>(request);
  const cfg = mappingConfig[type];
  if (!cfg) return { error: 'Tipo de De/Para inválido.' };
  const source = textValue(body.source), targetId = textValue(body.targetId);
  const sourceKey = type === 'locations' ? source.split('/').map(normalizeImportText).join('/') : normalizeImportText(source);
  exigeTexto(body.source, LIMITES_CAMPO.nome, 'nomenclatura de origem');
  exigeTexto(body.notes, LIMITES_CAMPO.observacoes, 'observações');
  if (!sourceKey || !targetId) return { error: 'Informe a nomenclatura de origem e o destino.' };
  if (type === 'locations' && (!/^[^/]+\/[^/]+$/.test(sourceKey))) return { error: 'Informe a localidade original no formato CIDADE/UF, como aparece na planilha.' };
  const target = await first(`SELECT 1 ok FROM ${cfg.targetTable} WHERE id=?${type === 'locations' ? '' : ' AND active=1'}`, [targetId]);
  if (!target) return { error: `O ${cfg.label} de destino não existe ou está inativo.` };
  if (type === 'locations') {
    const locations = await all<{ id: string; city: string; state: string }>('SELECT id,city,state FROM locations');
    if (locations.some(location => chaveLocalidade(location.city,location.state) === sourceKey && location.id !== targetId)) return { error: 'Essa origem já identifica outra localidade cadastrada. Confira cidade e UF.' };
  }
  if (type === 'units') {
    // Inclusive as inativas: uma medida desativada continua sendo uma medida, e
    // redirecionar LITRO para UNIDADE muda o significado de todo preco da carga
    // sem travar nada nem avisar ninguem.
    const units = await all<{ id: string; code: string; name: string }>('SELECT id,code,name FROM units');
    if (units.some(unit => unit.id !== targetId && [unit.code,unit.name].some(value => normalizeImportText(value) === sourceKey))) return { error: 'Essa origem já identifica outra unidade cadastrada. Confira a medida.' };
  }
  return { cfg, body, source: source.trim(), sourceKey, targetId, notes: nullableText(body.notes), active: body.active === false || body.active === 0 ? 0 : 1 };
}

async function createMapping(request: Request, user: User, type: string) {
  if (user.role !== 'admin') return denyWrite(request, 'Somente administradores podem gerenciar o De/Para.');
  const value = await validateMappingInput(request, type);
  if ('error' in value) return fail(value.error || 'De/Para inválido.');
  const recordId=id('map'), timestamp=now();
  try {
    await rawDb().prepare(`INSERT INTO ${value.cfg.table} (id,source_text,source_key,target_id,active,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(recordId,value.source,value.sourceKey,value.targetId,value.active,value.notes,timestamp,timestamp).run();
    await audit(user.id,'CREATE','import_mapping',recordId,`De/Para de ${value.cfg.label} incluído: ${value.sourceKey}`);
    return ok({id:recordId},{status:201});
  } catch (error: unknown) {
    return fail(errorMessage(error).includes('UNIQUE')?'Já existe um De/Para para essa nomenclatura de origem.':'Não foi possível salvar o De/Para.');
  }
}

async function updateMapping(request: Request, user: User, type: string, recordId: string) {
  if (user.role !== 'admin') return denyWrite(request, 'Somente administradores podem gerenciar o De/Para.');
  const value = await validateMappingInput(request, type);
  if ('error' in value) return fail(value.error || 'De/Para inválido.');
  const existing=await first(`SELECT 1 ok FROM ${value.cfg.table} WHERE id=?`,[recordId]);
  if(!existing) return fail('Correspondência não encontrada.',404);
  try {
    await rawDb().prepare(`UPDATE ${value.cfg.table} SET source_text=?,source_key=?,target_id=?,active=?,notes=?,updated_at=? WHERE id=?`)
      .bind(value.source,value.sourceKey,value.targetId,value.active,value.notes,now(),recordId).run();
    await audit(user.id,'UPDATE','import_mapping',recordId,`De/Para de ${value.cfg.label} atualizado: ${value.sourceKey}`);
    return ok({success:true});
  } catch (error: unknown) {
    return fail(errorMessage(error).includes('UNIQUE')?'Já existe um De/Para para essa nomenclatura de origem.':'Não foi possível atualizar o De/Para.');
  }
}

async function deleteMapping(user: User, type: string, recordId: string) {
  if (user.role !== 'admin') return fail('Somente administradores podem gerenciar o De/Para.', 403);
  const cfg=mappingConfig[type]; if(!cfg) return fail('Tipo de De/Para inválido.');
  const existing=await first<{sourceKey:string}>(`SELECT source_key AS sourceKey FROM ${cfg.table} WHERE id=?`,[recordId]);
  if(!existing) return fail('Correspondência não encontrada.',404);
  await rawDb().prepare(`DELETE FROM ${cfg.table} WHERE id=?`).bind(recordId).run();
  await audit(user.id,'DELETE','import_mapping',recordId,`De/Para de ${cfg.label} excluído: ${existing.sourceKey}`);
  return ok({success:true});
}

// Campos de cadastro sao os mesmos em criar e editar: valida num lugar so.
function exigeCamposDeCatalogo(body: CatalogInput) {
  exigeTexto(body.name, LIMITES_CAMPO.nome, 'nome');
  exigeTexto(body.tradeName, LIMITES_CAMPO.nome, 'nome fantasia');
  exigeTexto(body.legalName, LIMITES_CAMPO.nome, 'razão social');
  exigeTexto(body.code, LIMITES_CAMPO.codigo, 'código');
  exigeTexto(body.city, LIMITES_CAMPO.cidade, 'cidade');
  if (textValue(body.state) && !isValidState(body.state)) throw new EntradaInvalida('Selecione uma UF brasileira válida (ex.: GO).');
}

async function createCatalog(request: Request, user: User, type: string) {
  const cfg = catalogConfig[type]; if (!cfg) return fail('Cadastro inválido.');
  const body = await jsonBody<CatalogInput>(request), recordId = id(type.slice(0, 3)), timestamp = now();
  exigeCamposDeCatalogo(body);
  let sql = '', values: unknown[] = [];
  if (type === 'suppliers') {
    if (!textValue(body.tradeName) || !isValidCnpj(body.cnpj)) return fail('Informe o nome e um CNPJ válido.');
    sql = 'INSERT INTO suppliers (id,legal_name,trade_name,cnpj,city,state,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)';
    values = [recordId, textValue(body.legalName) || textValue(body.tradeName), textValue(body.tradeName), normalizeCnpj(body.cnpj), nullableText(body.city), nullableText(body.state)?.toUpperCase().slice(0,2) ?? null, timestamp, timestamp];
  } else if (type === 'items') {
    if (!textValue(body.name)) return fail('Informe o nome da peça ou serviço.');
    sql = 'INSERT INTO catalog_items (id,name,active) VALUES (?,?,1)'; values = [recordId, normalizeText(body.name)];
  } else if (type === 'models') {
    if (!textValue(body.name)) return fail('Informe o modelo.');
    sql = 'INSERT INTO vehicle_models (id,name,active) VALUES (?,?,1)'; values = [recordId, normalizeText(body.name)];
  } else if (type === 'units') {
    if (!textValue(body.code)) return fail('Informe a unidade de medida.');
    // name existe no banco como NOT NULL e o importador casa a MEDIDA da
    // planilha contra codigo OU descricao. Gravando os dois iguais, a unidade
    // passa a ter uma grafia so e o caso de "unidade ambigua" deixa de existir.
    sql = 'INSERT INTO units (id,code,name,active) VALUES (?,?,?,1)'; values = [recordId, normalizeText(body.code), normalizeText(body.code)];
  } else if (type === 'brands') {
    if (!textValue(body.name)) return fail('Informe a marca.');
    sql = 'INSERT INTO brands (id,name,active) VALUES (?,?,1)'; values = [recordId, normalizeText(body.name)];
  } else {
    const state = normalizeText(body.state);
    if (!normalizeImportText(body.city) || !isValidState(state)) return fail('Informe a cidade e selecione uma UF brasileira válida.');
    // Mesma forma canonica que a importacao usa para comparar: sem acento e
    // em maiusculas. Gravar "São Paulo" aqui criaria um registro que a
    // planilha nunca encontraria.
    sql = 'INSERT INTO locations (id,city,state) VALUES (?,?,?)'; values = [recordId, normalizeImportText(body.city), state];
  }
  try { await rawDb().prepare(sql).bind(...values).run(); await audit(user.id, 'CREATE', type, recordId, 'Cadastro incluído'); return ok({ id: recordId }, { status: 201 }); }
  catch { return fail('Já existe um cadastro com esses dados.'); }
}

async function updateCatalog(request: Request, user: User, type: string, recordId: string) {
  const cfg = catalogConfig[type];
  if (!cfg) return fail('Cadastro inválido.');
  const body = await jsonBody<CatalogInput>(request);
  exigeCamposDeCatalogo(body);
  const existing = await first<{ id: string }>(`SELECT id FROM ${cfg.table} WHERE id=?`, [recordId]);
  if (!existing) return fail('Cadastro não encontrado.', 404);
  const active = body.active === false ? 0 : 1;
  try {
    if (type === 'suppliers') {
      if (!textValue(body.tradeName) || !isValidCnpj(body.cnpj)) return fail('Informe o nome e um CNPJ válido.');
      await rawDb().prepare('UPDATE suppliers SET legal_name=?,trade_name=?,cnpj=?,city=?,state=?,active=?,updated_at=? WHERE id=?').bind(textValue(body.legalName) || textValue(body.tradeName), textValue(body.tradeName), normalizeCnpj(body.cnpj), nullableText(body.city), nullableText(body.state)?.toUpperCase().slice(0,2) ?? null, active, now(), recordId).run();
    } else if (type === 'items') {
      if (!textValue(body.name)) return fail('Informe o nome da peça ou serviço.');
      await rawDb().prepare('UPDATE catalog_items SET name=?,active=? WHERE id=?').bind(normalizeText(body.name), active, recordId).run();
    } else if (type === 'models') {
      if (!textValue(body.name)) return fail('Informe o modelo.');
      await rawDb().prepare('UPDATE vehicle_models SET name=?,active=? WHERE id=?').bind(normalizeText(body.name), active, recordId).run();
    } else if (type === 'units') {
      if (!textValue(body.code)) return fail('Informe a unidade de medida.');
      await rawDb().prepare('UPDATE units SET code=?,name=?,active=? WHERE id=?').bind(normalizeText(body.code), normalizeText(body.code), active, recordId).run();
    } else if (type === 'brands') {
      if (!textValue(body.name)) return fail('Informe a marca.');
      await rawDb().prepare('UPDATE brands SET name=?,active=? WHERE id=?').bind(normalizeText(body.name), active, recordId).run();
    } else {
      const state = normalizeText(body.state);
      if (!normalizeImportText(body.city) || !isValidState(state)) return fail('Informe a cidade e selecione uma UF brasileira válida.');
      await rawDb().prepare('UPDATE locations SET city=?,state=? WHERE id=?').bind(normalizeImportText(body.city), state, recordId).run();
    }
    await audit(user.id, 'UPDATE', type, recordId, 'Cadastro atualizado'); return ok({ success: true });
  } catch (error: unknown) {
    return fail(errorMessage(error).includes('UNIQUE') ? 'Já existe um cadastro com esses dados.' : 'Não foi possível atualizar o cadastro.');
  }
}

async function createUser(request: Request, actor: User) {
  if (actor.role !== 'admin') return fail('Somente administradores podem criar usuários.', 403);
  const body = await jsonBody<UserInput>(request);
  const name = exigeTexto(body.name, LIMITES_CAMPO.nome, 'nome'), email = exigeTexto(body.email, LIMITES_CAMPO.email, 'e-mail').toLowerCase(), role = body.role ?? 'viewer';
  if (!name || !email || typeof body.password !== 'string') return fail('Nome, e-mail e senha são obrigatórios.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Informe um e-mail válido.');
  if (!validatePassword(body.password)) return fail('A senha deve ter entre 10 e 200 caracteres.');
  if (!isOneOf(role, ROLES)) return fail('Perfil de usuário inválido.');
  const salt = crypto.randomUUID(), hash = await passwordHash(body.password, salt, PBKDF2_ITERACOES_ATUAL), userId = id('usr');
  try { await rawDb().prepare('INSERT INTO users (id,name,email,password_salt,password_hash,password_iterations,role,active,created_at) VALUES (?,?,?,?,?,?,?,1,?)').bind(userId, name, email, salt, hash, PBKDF2_ITERACOES_ATUAL, role, now()).run(); await audit(actor.id, 'CREATE', 'user', userId, `Usuário ${email} criado`); return ok({ id: userId }, { status: 201 }); }
  catch { return fail('Esse e-mail já está cadastrado.'); }
}

async function search(params: URLSearchParams) {
  const values: unknown[] = [], conditions = [
    `a.status='active'`,
    `date(a.start_date)<=date('now')`,
    `(a.end_date IS NULL OR date(a.end_date)>=date('now'))`,
  ];
  const state = normalizeText((params.get('state') || '').slice(0, LIMITES_CAMPO.busca));
  if (state) { conditions.push(`l.state=?`); values.push(state); }
  for (const [key, column] of [['item','ci.id'],['model','vm.id'],['supplier','s.id'],['location','l.id']] as const) { const value = params.get(key); if (value) { conditions.push(`${column}=?`); values.push(value); } }
  const total = Number((await first<{ n: number }>(`SELECT COUNT(*) n
    FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id JOIN suppliers s ON s.id=a.supplier_id
    JOIN catalog_items ci ON ci.id=ai.catalog_item_id JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
    WHERE ${conditions.join(' AND ')}`, values))?.n || 0);
  const limit = 1000;
  const rows = await all(`SELECT ai.id,ci.name AS item,vm.name AS model,ai.price,ai.courtesy,un.code AS unit,ai.brands_text AS brands,
    l.city,l.state,s.trade_name AS supplier,s.cnpj,a.id AS agreementId,a.number,a.end_date AS endDate,a.provisional
    FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id JOIN suppliers s ON s.id=a.supplier_id
    JOIN catalog_items ci ON ci.id=ai.catalog_item_id JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
    WHERE ${conditions.join(' AND ')} ORDER BY ci.name,vm.name,l.city,ai.price LIMIT ${limit}`, values);
  return ok({ rows, total, truncated: total > rows.length, limit });
}

async function importWorkbook(request: Request, user: User, agreementId: string) {
  // A trava e adquirida ANTES de ler o multipart: sem isso, uma segunda
  // importacao gastaria memoria materializando o corpo inteiro so para ser
  // recusada depois.
  const donoTrava = id('lck');
  if (!await adquirirTrava(TRAVA_IMPORTACAO, donoTrava)) {
    // Finaliza o envio sem guardar o arquivo: o proxy local precisa consumir
    // o corpo para entregar o 409 sem interromper as conexoes concorrentes.
    await corpoBinarioLimitado(request, 0);
    return fail('Já existe uma importação em andamento. Aguarde ela terminar e tente de novo.', 409);
  }
  try {
    await recuperarImportacoesInterrompidas();
    return await importWorkbookComTrava(request, user, agreementId);
  } finally {
    // finally cobre sucesso, planilha invalida e excecao inesperada.
    // Falha ao liberar nao pode transformar uma importacao ja publicada em
    // falso erro 500. A trava tem recuperacao por validade; registramos a
    // falha para diagnostico e preservamos a resposta verdadeira da operacao.
    try { await liberarTrava(TRAVA_IMPORTACAO, donoTrava); }
    catch (erro) { console.error('[portal] nao foi possivel liberar a trava de importacao:', erro); }
  }
}

async function importWorkbookComTrava(request: Request, user: User, agreementId: string) {
  // Limite REAL do multipart. Content-Length pode vir ausente, mentiroso ou a
  // requisicao pode ser fragmentada, entao conferir so o cabecalho deixaria o
  // formData() materializar o corpo inteiro na memoria.
  //
  // A leitura conta os bytes que efetivamente chegam e descarta o excedente;
  // so um corpo dentro do teto e entregue ao interpretador multipart.
  const bytes = await corpoBinarioLimitado(request, CORPO_MAX_UPLOAD);
  if (bytes === null) throw new CorpoGrandeDemais(CORPO_MAX_UPLOAD);

  // Reconstroi a requisicao a partir dos bytes ja conferidos.
  const requisicaoLimitada = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: bytes.buffer as ArrayBuffer,
  });
  // Só o formData() fica no try: conteúdo que não é multipart é erro do
  // cliente e merece 400. Exceções depois daqui continuam sendo 500.
  let form: FormData;
  try { form = await requisicaoLimitada.formData(); }
  catch { throw new EntradaInvalida('Envie a planilha como formulário (multipart/form-data).'); }
  const file = form.get('file');
  if (!(file instanceof File)) return fail('Selecione uma planilha Excel.');
  if (!/\.(xlsx|xls)$/i.test(file.name)) return fail('Use uma planilha com extensão .xlsx ou .xls.');
  if (file.size <= 0) return fail('A planilha está vazia.');
  if (file.size > MAX_IMPORT_BYTES) return fail('A planilha ultrapassa o limite de 15 MB.');
  if (!await first('SELECT 1 ok FROM agreements WHERE id=?', [agreementId])) return fail('Acordo de destino não encontrado.', 404);
  const preview = new URL(request.url).searchParams.get('preview') === '1';
  const importId = id('imp'), timestamp = now();
  if (!preview) await rawDb().prepare(`INSERT INTO imports (id,agreement_id,filename,mode,status,created_by,created_at) VALUES (?,?,?,?,?,?,?)`).bind(importId, agreementId, safeFilename(file.name), 'replace', 'processing', user.id, timestamp).run();
  try {
    const leitura = await lerPlanilha(file);
    if (!leitura.ok) throw new Error(leitura.erro);
    const sourceRows = leitura.linhas as Row[];
    if (!sourceRows.length) throw new Error('A planilha não contém linhas de dados.');
    const ausentes = colunasAusentes(sourceRows[0]);
    if (ausentes.length) throw new Error(`A planilha não tem ${ausentes.length === 1 ? 'a coluna' : 'as colunas'} ${ausentes.join(', ')}. Confira o cabeçalho da primeira aba.`);
    const parsed = sourceRows.map((row, index) => parseImportRow(row, leitura.numerosLinhas[index]));
    await applyImportMappings(parsed);
    const errors = parsed.filter((r) => r.error);
    if (errors.length) {
      const summary = summarizeImportErrors(parsed, leitura.aba);
      if (preview) return ok({ preview: true, valid: false, totalRows: parsed.length, ...summary });
      await rawDb().prepare('UPDATE imports SET status=?,total_rows=?,valid_rows=?,error_rows=?,summary_json=?,completed_at=? WHERE id=?').bind('error', parsed.length, parsed.length-errors.length, errors.length, JSON.stringify(summary), now(), importId).run();
      return ok({ error: `A planilha possui ${errors.length} linha(s) inválida(s). Nenhum dado foi publicado.`, importId, ...summary }, { status: 400 });
    }
    const prepared = deduplicateImportRows(parsed);
    const baseSummary = prepared.summary;
    if (preview) return ok({ preview: true, valid: true, sheet: leitura.aba, totalRows: parsed.length, summary: baseSummary, sample: prepared.rows.slice(0, 20).map(row => ({ linha: row.rowNumber, fornecedor: row.supplier, cidade: row.city, uf: row.state, item: row.item, modelo: row.model, unidade: row.unit, preco: row.price })) });
    const publish: PublishImport = async (statements, details) => {
      const summary = { ...details, ...baseSummary }, db = rawDb(), timestamp = now();
      // A publicacao e seus registros de conclusao precisam confirmar juntos.
      await db.batch([
        ...statements,
        db.prepare('UPDATE imports SET status=?,total_rows=?,valid_rows=?,error_rows=0,summary_json=?,completed_at=? WHERE id=?').bind('completed', parsed.length, parsed.length, JSON.stringify(summary), timestamp, importId),
        db.prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)').bind(id('aud'), user.id, 'IMPORT', 'agreement', agreementId, `${file.name}: ${parsed.length} linhas publicadas`, timestamp),
      ]);
      return summary;
    };
    const summary = await processAgreementImport(prepared.rows, user, importId, agreementId, publish);
    return ok({ success: true, summary });
  } catch (error: unknown) {
    if (preview) return ok({ preview: true, valid: false, error: errorMessage(error, 'Arquivo inválido.') });
    await cleanupFailedImport(importId);
    const message = errorMessage(error, 'arquivo inválido');
    await rawDb().prepare('UPDATE imports SET status=?,summary_json=?,completed_at=? WHERE id=?').bind('error', JSON.stringify({ error: message }), now(), importId).run();
    return ok({ error: `Não foi possível importar: ${message}`, importId }, { status: 400 });
  }
}

async function applyImportMappings(rows: ReturnType<typeof parseImportRow>[]) {
  const [itemRows, modelRows, unitRows, locationRows, unitAliases] = await Promise.all([
    all<{ sourceKey: string; name: string; id: string }>('SELECT m.source_key AS sourceKey,c.name,c.id FROM import_item_mappings m JOIN catalog_items c ON c.id=m.target_id WHERE m.active=1 AND c.active=1'),
    all<{ sourceKey: string; name: string; id: string }>('SELECT m.source_key AS sourceKey,v.name,v.id FROM import_model_mappings m JOIN vehicle_models v ON v.id=m.target_id WHERE m.active=1 AND v.active=1'),
    all<{ id: string; code: string; name: string }>('SELECT id,code,name FROM units WHERE active=1'),
    all<{ id: string; city: string; state: string }>('SELECT id,city,state FROM locations'),
    all<{ sourceKey: string; id: string; name: string }>('SELECT m.source_key AS sourceKey,u.id,u.code AS name FROM import_unit_mappings m JOIN units u ON u.id=m.target_id WHERE m.active=1 AND u.active=1'),
  ]);
  const units = uniqueIndex<ImportTarget>(unitRows.flatMap(unit => [...new Set([normalizeImportText(unit.code), normalizeImportText(unit.name)])].map(key => [key, { id: unit.id, name: unit.code }] as [string, ImportTarget])));
  const locations = uniqueIndex(locationRows.map(location => [chaveLocalidade(location.city, location.state), location]));
  for (const alias of unitAliases) units.set(alias.sourceKey, alias);
  // Localidade nao e nomenclatura a traduzir: cidade ou esta cadastrada ou
  // precisa ser cadastrada. O De/Para dela so abria caminho para apontar uma
  // cidade para outra.
  const items = new Map<string, ImportTarget>(itemRows.map(item => [item.sourceKey, { id: item.id, name: item.name }]));
  const models = new Map<string, ImportTarget>(modelRows.map(model => [model.sourceKey, { id: model.id, name: model.name }]));
  resolveImportRows(rows, { items, models, units, locations });
}

type PublishImport = (statements: D1PreparedStatement[], details: Record<string, unknown>) => Promise<Record<string, unknown>>;

async function processAgreementImport(rows: ReturnType<typeof parseImportRow>[], user: User, importId: string, agreementId: string, publish: PublishImport) {
  const agreement = await first<{id:string;number:string}>('SELECT id,number FROM agreements WHERE id=?',[agreementId]); if(!agreement) throw new Error('Acordo não encontrado');
  const db=rawDb(), timestamp=now();
  const max=await first<{n:number}>('SELECT COALESCE(MAX(version_number),0) n FROM agreement_versions WHERE agreement_id=?',[agreementId]);
  const versionId=id('ver'), versionNumber=Number(max?.n||0)+1;
  await db.prepare(`INSERT INTO agreement_versions (id,agreement_id,version_number,import_id,status,published_at,created_by,created_at) VALUES (?,?,?,?,'processing',NULL,?,?)`).bind(versionId,agreementId,versionNumber,importId,user.id,timestamp).run();
  const links=new Map<string,string>(), statements:D1PreparedStatement[]=[];
  for(const row of rows){ const locationId=row.locationId!; links.set(locationId,locationId); statements.push(db.prepare(`INSERT INTO agreement_items (id,version_id,location_id,catalog_item_id,vehicle_model_id,unit_id,price,courtesy,brands_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id('itm'),versionId,locationId,row.itemId,row.modelId,row.unitId,row.price,row.price===0?1:0,row.brands||null,timestamp,timestamp)); }
  await batch(statements,80);
  return publish([
    db.prepare('DELETE FROM agreement_locations WHERE agreement_id=?').bind(agreementId),
    ...Array.from(links.keys()).map((locationId)=>db.prepare('INSERT INTO agreement_locations (agreement_id,location_id) VALUES (?,?)').bind(agreementId,locationId)),
    db.prepare('UPDATE agreements SET current_version_id=?,updated_at=? WHERE id=?').bind(versionId,timestamp,agreementId),
    db.prepare(`UPDATE agreement_versions SET status='published',published_at=? WHERE id=?`).bind(timestamp,versionId),
  ], { agreement: agreement.number, version: versionNumber });
}

async function batch(statements: D1PreparedStatement[], size: number) { for(let i=0;i<statements.length;i+=size) await rawDb().batch(statements.slice(i,i+size)); }

async function cleanupFailedImport(importId:string){
  const db=rawDb();
  const staged=await all<{id:string;agreementId:string}>(`SELECT id,agreement_id AS agreementId FROM agreement_versions WHERE import_id=? AND status='processing'`,[importId]);
  if(!staged.length) return;
  for(const version of staged){
    const attached=await first('SELECT 1 ok FROM agreements WHERE id=? AND current_version_id=?',[version.agreementId,version.id]);
    if(attached){
      // Uma troca finalizada nunca pode ficar apontando para uma versão removida.
      await db.prepare(`UPDATE agreement_versions SET status='published',published_at=COALESCE(published_at,?) WHERE id=?`).bind(now(),version.id).run();
      continue;
    }
    await db.batch([
      db.prepare('DELETE FROM agreement_items WHERE version_id=?').bind(version.id),
      db.prepare('DELETE FROM agreement_versions WHERE id=?').bind(version.id),
    ]);
  }
  // Acordos provisorios so nasciam na carga inicial, que saiu do Portal. O
  // trecho fica para a varredura de importacoes interrompidas ainda conseguir
  // limpar o que uma carga inicial antiga tenha deixado pela metade.
  for(const agreementId of new Set(staged.map((version)=>version.agreementId))){
    const orphan=await first<{id:string}>(`SELECT a.id FROM agreements a
      WHERE a.id=? AND a.provisional=1 AND a.current_version_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM agreement_versions v WHERE v.agreement_id=a.id)`,[agreementId]);
    if(orphan) await db.batch([
      db.prepare('DELETE FROM agreement_locations WHERE agreement_id=?').bind(agreementId),
      db.prepare('DELETE FROM agreements WHERE id=?').bind(agreementId),
    ]);
  }
}

// Quem segura a trava de importacao e o unico que pode estar importando. Uma
// importacao ainda em 'processing' neste momento e resto de um processo que
// morreu no meio (queda de energia, portal encerrado): sem esta varredura ela
// ficava assim para sempre, com a versao em preparo e as condicoes gravadas
// ate ali. A trava vence em 30 min; uma importacao real leva segundos.
async function recuperarImportacoesInterrompidas(){
  const presas=await all<{id:string}>(`SELECT id FROM imports WHERE status='processing'`);
  for(const {id:importId} of presas){
    try{
      await cleanupFailedImport(importId);
      await rawDb().prepare('UPDATE imports SET status=?,summary_json=?,completed_at=? WHERE id=?')
        .bind('error',JSON.stringify({error:'Importação interrompida antes de concluir; os dados parciais foram removidos.'}),now(),importId).run();
    }catch(erro){
      // Nao bloqueia a importacao nova: a varredura tenta de novo na proxima.
      console.error(`[portal] nao foi possivel limpar a importacao interrompida ${importId}:`,erro);
    }
  }
}

async function importList(){ return all(`SELECT i.id,i.filename,i.mode,i.status,i.total_rows AS totalRows,i.valid_rows AS validRows,i.error_rows AS errorRows,i.created_at AS createdAt,i.completed_at AS completedAt,a.number AS agreement,u.name AS user FROM imports i LEFT JOIN agreements a ON a.id=i.agreement_id LEFT JOIN users u ON u.id=i.created_by ORDER BY i.created_at DESC LIMIT 100`); }
async function importDetail(importId:string){
  const row=await first<{id:string;filename:string;mode:string;status:string;totalRows:number;validRows:number;errorRows:number;createdAt:string;completedAt:string|null;agreement:string|null;user:string|null;summaryJson:string|null}>(`SELECT i.id,i.filename,i.mode,i.status,i.total_rows AS totalRows,i.valid_rows AS validRows,i.error_rows AS errorRows,
    i.created_at AS createdAt,i.completed_at AS completedAt,i.summary_json AS summaryJson,a.number AS agreement,u.name AS user
    FROM imports i LEFT JOIN agreements a ON a.id=i.agreement_id LEFT JOIN users u ON u.id=i.created_by WHERE i.id=?`,[importId]);
  if(!row) return fail('Importação não encontrada.',404);
  let summary:unknown=null;
  try{summary=row.summaryJson?JSON.parse(row.summaryJson):null}catch{summary={error:'O resumo armazenado não pôde ser lido.'}}
  const {summaryJson:_,...detail}=row;
  void _;
  return ok({...detail,summary});
}
async function auditList(params?: URLSearchParams){
  const values:unknown[]=[], conditions:string[]=[];
  const userId=params?.get('user'); if(userId){conditions.push('l.user_id=?');values.push(userId)}
  const action=params?.get('action'); if(action){conditions.push('l.action=?');values.push(action)}
  const entity=params?.get('entity'); if(entity){conditions.push('l.entity=?');values.push(entity)}
  const q=params?.get('q'); if(q){conditions.push('(l.details LIKE ? OR l.entity LIKE ? OR u.name LIKE ?)');values.push(`%${q}%`,`%${q}%`,`%${q}%`)}
  const from=params?.get('from'); if(from){conditions.push('date(l.created_at)>=date(?)');values.push(from)}
  const to=params?.get('to'); if(to){conditions.push('date(l.created_at)<=date(?)');values.push(to)}
  const where=conditions.length?`WHERE ${conditions.join(' AND ')}`:'';

  // Paginacao real: o total vem do banco, entao a tela sabe quantas paginas
  // existem sem precisar carregar tudo.
  const pageSize=Math.min(Math.max(Number(params?.get('pageSize'))||50,10),200);
  const total=Number((await first<{n:number}>(`SELECT COUNT(*) n FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id ${where}`, values))?.n||0);
  const pageCount=Math.max(Math.ceil(total/pageSize),1);
  const page=Math.min(Math.max(Number(params?.get('page'))||1,1),pageCount);
  const offset=(page-1)*pageSize;

  const logs=await all(`SELECT l.id,l.action,l.entity,l.entity_id AS entityId,l.details,l.created_at AS createdAt,u.name AS user,u.email AS userEmail,l.user_id AS userId FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id ${where} ORDER BY l.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, values);
  return { logs, total, page, pageSize, pageCount };
}

async function emailNotificationList(){
  const [stats,notifications]=await Promise.all([
    first(`SELECT COUNT(*) total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) processing,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
      FROM email_notifications`),
    all(`SELECT e.id,e.type,e.recipient_name AS recipientName,e.recipient_email AS recipientEmail,e.status,e.attempts,
      e.next_attempt_at AS nextAttemptAt,e.sent_at AS sentAt,e.last_error AS lastError,e.created_at AS createdAt,
      t.code AS ticketCode,t.supplier_name AS supplierName
      FROM email_notifications e JOIN tickets t ON t.id=e.ticket_id ORDER BY e.created_at DESC LIMIT 100`),
  ]);
  return {stats,notifications};
}

async function retryEmailNotification(user:User,notificationId:string){
  if(user.role!=='admin') return fail('Somente administradores podem reenviar notificações.',403);
  const notification=await first<{id:string;status:string}>('SELECT id,status FROM email_notifications WHERE id=?',[notificationId]);
  if(!notification) return fail('Notificação não encontrada.',404);
  if(notification.status==='sent') return fail('Esta notificação já foi enviada.',409);
  if(notification.status==='processing') return fail('Esta notificação está sendo enviada. Atualize a lista antes de tentar novamente.',409);
  if(notification.status!=='failed') return fail('Somente notificações com falha podem ser reenviadas manualmente.',409);
  const timestamp=now();
  await rawDb().batch([
    rawDb().prepare("UPDATE email_notifications SET status='pending',attempts=0,next_attempt_at=?,locked_at=NULL,last_error=NULL,updated_at=? WHERE id=?").bind(timestamp,timestamp,notificationId),
    rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)').bind(id('aud'),user.id,'RETRY','email_notification',notificationId,'Reenvio de notificação solicitado',timestamp),
  ]);
  return ok({success:true});
}

async function ticketList(){
  return all(`SELECT t.id,t.code,t.supplier_name AS supplierName,t.cnpj,t.city,t.state,t.contact,t.scope,t.priority,t.status,
    t.created_at AS createdAt,t.updated_at AS updatedAt,t.closed_at AS closedAt,t.agreement_id AS agreementId,
    r.name AS requestedBy,a.name AS assignedTo,ag.number AS agreementNumber
    FROM tickets t LEFT JOIN users r ON r.id=t.requested_by LEFT JOIN users a ON a.id=t.assigned_to
    LEFT JOIN agreements ag ON ag.id=t.agreement_id ORDER BY t.updated_at DESC LIMIT 500`);
}

async function ticketStats(){
  return first(`SELECT
    (SELECT COUNT(*) FROM tickets) total,
    (SELECT COUNT(*) FROM tickets WHERE status='aberto') aberto,
    (SELECT COUNT(*) FROM tickets WHERE status='aguardando_fornecedor') aguardando,
    (SELECT COUNT(*) FROM tickets WHERE status='fechado') fechado,
    (SELECT COUNT(*) FROM tickets WHERE status='cancelado') cancelado`);
}

async function ticketDetail(ticketId:string){
  const ticket=await first(`SELECT t.*,r.name AS requestedBy,a.name AS assignedTo,ag.number AS agreementNumber
    FROM tickets t LEFT JOIN users r ON r.id=t.requested_by LEFT JOIN users a ON a.id=t.assigned_to
    LEFT JOIN agreements ag ON ag.id=t.agreement_id WHERE t.id=?`,[ticketId]);
  if(!ticket) return fail('Chamado não encontrado.',404);
  const events=await all(`SELECT e.id,e.kind,e.from_status AS fromStatus,e.to_status AS toStatus,e.message,e.created_at AS createdAt,u.name AS user
    FROM ticket_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.ticket_id=? ORDER BY e.created_at ASC`,[ticketId]);
  return ok({ ticket, events });
}

async function createTicket(request:Request,user:User){
  const body=await jsonBody<TicketInput>(request);
  if(!textValue(body.supplierName)) return fail('Informe o fornecedor que deve ser negociado.');
  exigeTexto(body.supplierName,LIMITES_CAMPO.nome,'fornecedor');
  exigeTexto(body.contact,LIMITES_CAMPO.contato,'contato');
  exigeTexto(body.scope,LIMITES_CAMPO.escopo,'escopo');
  exigeTexto(body.notes,LIMITES_CAMPO.observacoes,'observações');
  exigeTexto(body.statusMessage,LIMITES_CAMPO.mensagem,'mensagem da situação');
  exigeTexto(body.city,LIMITES_CAMPO.cidade,'cidade');
  const supplierName=normalizeText(body.supplierName), priority=body.priority ?? 'media';
  if(!isOneOf(priority,TICKET_PRIORITIES)) return fail('Prioridade inválida.');
  const ticketCnpj=body.cnpj ? normalizeCnpj(body.cnpj) : null;
  if(ticketCnpj && !isValidCnpj(ticketCnpj)) return fail('Informe um CNPJ válido.');
  const state=body.state ? normalizeText(body.state) : null;
  if(state && !isValidState(state)) return fail('Selecione uma UF brasileira válida.');
  const assignedTo=textValue(body.assignedTo) || null;
  if(assignedTo && !await first('SELECT 1 ok FROM users WHERE id=? AND active=1',[assignedTo])) return fail('Responsável não encontrado ou inativo.');
  const responsavel=await pessoaNotificacao(assignedTo);

  // O codigo e sequencial e unico. Sob acesso simultaneo, duas pessoas podem
  // calcular o mesmo numero antes de qualquer uma gravar; por isso ha novas
  // tentativas ate encontrar um codigo livre, em vez de perder o chamado.
  for(let tentativa=0;tentativa<12;tentativa++){
    const maior=await first<{c:string}>(`SELECT code c FROM tickets ORDER BY CAST(substr(code,instr(code,'-')+1) AS INTEGER) DESC LIMIT 1`);
    const proximo=(maior?.c?Number(maior.c.split('-').at(-1)):0)+1+tentativa;
    const code=`SUP-${String(proximo).padStart(4,'0')}`;
    const ticketId=id('tck'), eventId=id('tev'), timestamp=now();
    try{
      const contexto:ContextoNotificacaoChamado={id:ticketId,codigo:code,fornecedor:supplierName,prioridade:String(priority),status:'aberto',solicitante:{id:user.id,nome:user.name,email:user.email},responsavel};
      const notificacoes=prepararNotificacoesChamado({eventId,anterior:null,atual:contexto,autor:user,alteracoes:['Chamado atribuído'],timestamp});
      await rawDb().batch([
        rawDb().prepare(`INSERT INTO tickets (id,code,supplier_name,cnpj,city,state,contact,scope,priority,status,requested_by,assigned_to,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'aberto',?,?,?,?,?)`)
          .bind(ticketId,code,supplierName,ticketCnpj,body.city?normalizeText(body.city):null,state,nullableText(body.contact),nullableText(body.scope),priority,user.id,assignedTo,nullableText(body.notes),timestamp,timestamp),
        rawDb().prepare(`INSERT INTO ticket_events (id,ticket_id,user_id,kind,to_status,message,created_at) VALUES (?,?,?,'created','aberto',?,?)`)
          .bind(eventId,ticketId,user.id,`Chamado aberto para ${supplierName}`,timestamp),
        rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)')
          .bind(id('aud'),user.id,'CREATE','ticket',ticketId,`Chamado ${code} aberto: ${supplierName}`,timestamp),
        ...notificacoes,
      ]);
      return ok({ id:ticketId, code },{status:201});
    }catch(error:unknown){
      if(!errorMessage(error).includes('UNIQUE')) throw error;
      // Codigo tomado por outra pessoa no mesmo instante: tenta o proximo.
    }
  }
  return fail('Muitos chamados sendo abertos ao mesmo tempo. Tente novamente.',503);
}

async function updateTicket(request:Request,user:User,ticketId:string){
  const body=await jsonBody<TicketInput>(request);
  const current=await first<{id:string;code:string;supplier_name:string;cnpj:string|null;city:string|null;state:string|null;contact:string|null;scope:string|null;priority:string;status:string;requested_by:string|null;assigned_to:string|null;agreement_id:string|null;notes:string|null;closed_at:string|null}>('SELECT * FROM tickets WHERE id=?',[ticketId]);
  if(!current) return fail('Chamado não encontrado.',404);
  const anterior=await contextoNotificacaoChamado(ticketId);
  if(!anterior) return fail('Chamado não encontrado.',404);
  const status=body.status ?? current.status, priority=body.priority ?? current.priority;
  if(!isOneOf(status,TICKET_STATUSES)) return fail('Situação inválida.');
  if(!isOneOf(priority,TICKET_PRIORITIES)) return fail('Prioridade inválida.');
  const nextCnpj=body.cnpj === undefined ? current.cnpj : textValue(body.cnpj) ? normalizeCnpj(body.cnpj) : null;
  if(nextCnpj && !isValidCnpj(nextCnpj)) return fail('Informe um CNPJ válido.');
  const nextState=body.state === undefined ? current.state : textValue(body.state) ? normalizeText(body.state) : null;
  if(nextState && !isValidState(nextState)) return fail('Selecione uma UF brasileira válida.');
  const assignedTo=body.assignedTo === undefined ? current.assigned_to : textValue(body.assignedTo) || null;
  if(assignedTo && !await first('SELECT 1 ok FROM users WHERE id=? AND active=1',[assignedTo])) return fail('Responsável não encontrado ou inativo.');
  const supplierName=body.supplierName === undefined ? current.supplier_name : normalizeText(body.supplierName);
  if(!supplierName) return fail('Informe o fornecedor que deve ser negociado.');
  exigeTexto(body.supplierName,LIMITES_CAMPO.nome,'fornecedor');
  exigeTexto(body.contact,LIMITES_CAMPO.contato,'contato');
  exigeTexto(body.scope,LIMITES_CAMPO.escopo,'escopo');
  exigeTexto(body.notes,LIMITES_CAMPO.observacoes,'observações');
  exigeTexto(body.city,LIMITES_CAMPO.cidade,'cidade');
  // statusMessage e gravado AQUI, no evento de mudanca de situacao. O limite
  // estava em createTicket, onde o campo nem chega a ser usado: uma mensagem
  // de 3000 caracteres passava direto e ia para o banco.
  exigeTexto(body.statusMessage,LIMITES_CAMPO.mensagem,'mensagem da situação');
  const agreementId=body.agreementId === undefined ? current.agreement_id : textValue(body.agreementId) || null;
  if(agreementId && !await first('SELECT 1 ok FROM agreements WHERE id=?',[agreementId])) return fail('Acordo relacionado não encontrado.');
  const city=body.city===undefined?current.city:nullableText(body.city)?normalizeText(body.city):null;
  const contact=body.contact===undefined?current.contact:nullableText(body.contact);
  const scope=body.scope===undefined?current.scope:nullableText(body.scope);
  const notes=body.notes===undefined?current.notes:nullableText(body.notes);
  const alteracoes:string[]=[];
  if(supplierName!==current.supplier_name) alteracoes.push('Fornecedor');
  if(nextCnpj!==current.cnpj) alteracoes.push('CNPJ');
  if(city!==current.city||nextState!==current.state) alteracoes.push('Localidade');
  if(contact!==current.contact) alteracoes.push('Contato');
  if(scope!==current.scope) alteracoes.push('Escopo');
  if(priority!==current.priority) alteracoes.push(`Prioridade: ${current.priority} → ${String(priority)}`);
  if(status!==current.status) alteracoes.push(`Situação: ${current.status} → ${String(status)}`);
  if(assignedTo!==current.assigned_to) alteracoes.push('Responsável');
  if(agreementId!==current.agreement_id) alteracoes.push('Acordo relacionado');
  if(notes!==current.notes) alteracoes.push('Observações');
  if(!alteracoes.length) return ok({success:true,unchanged:true});
  const timestamp=now();
  const closedAt=(status==='fechado'||status==='cancelado')?(current.closed_at||timestamp):null;
  const eventId=id('tev');
  const responsavel=await pessoaNotificacao(assignedTo);
  const atual:ContextoNotificacaoChamado={...anterior,fornecedor:supplierName,prioridade:String(priority),status,responsavel};
  const camposRegra=alteracoes.filter((item)=>item!=='Responsável');
  const notificacoes=prepararNotificacoesChamado({eventId,anterior,atual,mudanca:{camposAlterados:camposRegra},autor:user,alteracoes,mensagem:nullableText(body.statusMessage),timestamp});
  await rawDb().batch([
    rawDb().prepare(`UPDATE tickets SET supplier_name=?,cnpj=?,city=?,state=?,contact=?,scope=?,priority=?,status=?,assigned_to=?,agreement_id=?,notes=?,updated_at=?,closed_at=? WHERE id=?`)
      .bind(supplierName,nextCnpj,city,nextState,contact,scope,priority,status,assignedTo,agreementId,notes,timestamp,closedAt,ticketId),
    rawDb().prepare(`INSERT INTO ticket_events (id,ticket_id,user_id,kind,from_status,to_status,message,created_at) VALUES (?,?,?,${status!==current.status?"'status'":"'updated'"},?,?,?,?)`)
      .bind(eventId,ticketId,user.id,status!==current.status?current.status:null,status!==current.status?status:null,nullableText(body.statusMessage)||`Alterado: ${alteracoes.join(', ')}`,timestamp),
    rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id('aud'),user.id,'UPDATE','ticket',ticketId,`Chamado ${current.code}: ${alteracoes.join(', ')}`,timestamp),
    ...notificacoes,
  ]);
  return ok({ success:true });
}

async function addTicketEvent(request:Request,user:User,ticketId:string){
  const body=await jsonBody<{message?:unknown}>(request);
  if(!textValue(body.message)) return fail('Escreva o andamento.');
  exigeTexto(body.message,LIMITES_CAMPO.mensagem,'andamento');
  const timestamp=now();
  const ticket=await contextoNotificacaoChamado(ticketId);
  if(!ticket) return fail('Chamado não encontrado.',404);
  const eventId=id('tev');
  const mensagem=textValue(body.message);
  const notificacoes=prepararNotificacoesChamado({eventId,anterior:ticket,atual:ticket,mudanca:{andamentoAdicionado:true},autor:user,alteracoes:['Novo andamento'],mensagem,timestamp});
  await rawDb().batch([
    rawDb().prepare(`INSERT INTO ticket_events (id,ticket_id,user_id,kind,message,created_at) VALUES (?,?,?,'note',?,?)`).bind(eventId,ticketId,user.id,mensagem,timestamp),
    rawDb().prepare('UPDATE tickets SET updated_at=? WHERE id=?').bind(timestamp,ticketId),
    rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)').bind(id('aud'),user.id,'COMMENT','ticket',ticketId,`Andamento no chamado ${ticket.codigo}`,timestamp),
    ...notificacoes,
  ]);
  return ok({ success:true },{status:201});
}

async function updateUser(request:Request,actor:User,userId:string){
  if(actor.role!=='admin') return fail('Somente administradores podem alterar usuários.',403);
  const body=await jsonBody<UserInput>(request);
  const target=await first<{id:string;name:string;email:string;role:Role;active:number;dailyReportEnabled:number;dailyReportTime:string}>('SELECT id,name,email,role,active,daily_report_enabled AS dailyReportEnabled,daily_report_time AS dailyReportTime FROM users WHERE id=?',[userId]);
  if(!target) return fail('Usuário não encontrado.',404);
  const role=body.role === undefined ? target.role : body.role;
  if(!isOneOf(role,ROLES)) return fail('Perfil de usuário inválido.');
  if(body.password !== undefined && body.password !== '' && typeof body.password !== 'string') return fail('A nova senha é inválida.');
  const password=typeof body.password === 'string' && body.password !== '' ? body.password : null;
  if(password !== null && !validatePassword(password)) return fail('A nova senha deve ter entre 10 e 200 caracteres.');
  const active=body.active === undefined ? target.active : body.active === false ? 0 : 1;
  const dailyReportEnabled=body.dailyReportEnabled === undefined ? target.dailyReportEnabled : body.dailyReportEnabled === true ? 1 : 0;
  const dailyReportTime=body.dailyReportTime === undefined ? target.dailyReportTime : textValue(body.dailyReportTime);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyReportTime)) return fail('Informe um horário válido para o relatório diário.');
  const name=textValue(body.name) || target.name;
  if(target.id===actor.id&&(active===0||role!=='admin')) return fail('Você não pode desativar nem rebaixar a própria conta.');
  const changes:string[]=[];
  if(name!==target.name) changes.push(`nome: ${target.name} → ${name}`);
  if(role!==target.role) changes.push(`perfil: ${target.role} → ${role}`);
  if(active!==target.active) changes.push(active?'reativado':'desativado');
  if(dailyReportEnabled!==target.dailyReportEnabled) changes.push(dailyReportEnabled?'relatório diário ativado':'relatório diário desativado');
  if(dailyReportTime!==target.dailyReportTime) changes.push(`horário do relatório: ${target.dailyReportTime} → ${dailyReportTime}`);
  const atualizado = await rawDb().prepare(ATUALIZAR_USUARIO_SQL).bind(exigeTexto(name,LIMITES_CAMPO.nome,'nome'),role,active,dailyReportEnabled,dailyReportTime,userId,role,active).run();
  if (!atualizado.meta.changes) return fail('Este é o último administrador ativo. Promova outro antes de alterar este.',409);
  if(password !== null){
    const salt=crypto.randomUUID(), hash=await passwordHash(password,salt,PBKDF2_ITERACOES_ATUAL);
    await rawDb().batch([
      rawDb().prepare('UPDATE users SET password_salt=?,password_hash=?,password_iterations=? WHERE id=?').bind(salt,hash,PBKDF2_ITERACOES_ATUAL,userId),
      rawDb().prepare('DELETE FROM sessions WHERE user_id=?').bind(userId),
    ]);
    changes.push('senha redefinida (sessões encerradas)');
  }
  await audit(actor.id,'UPDATE','user',userId,`${target.email}: ${changes.join('; ')||'sem alterações'}`);
  return ok({ success:true });
}

async function exportDatabase(){
  const tables={
    users:await all('SELECT id,name,email,role,active,daily_report_enabled,daily_report_time,created_at FROM users ORDER BY created_at'),
    suppliers:await all('SELECT * FROM suppliers ORDER BY legal_name'),
    locations:await all('SELECT * FROM locations ORDER BY state,city'),
    catalogItems:await all('SELECT * FROM catalog_items ORDER BY name'),
    vehicleModels:await all('SELECT * FROM vehicle_models ORDER BY name'),
    importItemMappings:await all('SELECT * FROM import_item_mappings ORDER BY source_key'),
    importUnitMappings:await all('SELECT * FROM import_unit_mappings ORDER BY source_key'),
    importLocationMappings:await all('SELECT * FROM import_location_mappings ORDER BY source_key'),
    importModelMappings:await all('SELECT * FROM import_model_mappings ORDER BY source_key'),
    units:await all('SELECT * FROM units ORDER BY code'),
    brands:await all('SELECT * FROM brands ORDER BY name'),
    agreements:await all('SELECT * FROM agreements ORDER BY created_at'),
    agreementLocations:await all('SELECT * FROM agreement_locations'),
    imports:await all('SELECT * FROM imports ORDER BY created_at'),
    agreementVersions:await all('SELECT * FROM agreement_versions ORDER BY agreement_id,version_number'),
    agreementItems:await all('SELECT * FROM agreement_items ORDER BY version_id,created_at'),
    tickets:await all('SELECT * FROM tickets ORDER BY created_at'),
    ticketEvents:await all('SELECT * FROM ticket_events ORDER BY created_at'),
    emailNotifications:await all('SELECT * FROM email_notifications ORDER BY created_at'),
    auditLogs:await all('SELECT * FROM audit_logs ORDER BY created_at'),
  };
  const data={
    format:'portal-suprimentos-data-export',
    formatVersion:1,
    exportedAt:now(),
    securityNotice:'Senhas, sessões e tentativas de acesso não fazem parte desta exportação de dados.',
    recordCounts:Object.fromEntries(Object.entries(tables).map(([name,records])=>[name,records.length])),
    tables,
  };
  return new NextResponse(JSON.stringify(data,null,2),{headers:{
    'cache-control':'no-store',
    'content-type':'application/json; charset=utf-8',
    'content-disposition':`attachment; filename="exportacao-portal-suprimentos-${now().slice(0,10)}.json"`,
    'x-content-type-options':'nosniff',
  }});
}

async function exportAgreements(){
  const headers=['MODELO','PECA_SERVICO','CIDADE','UF','CNPJ','PRECO','FORNECEDOR','MEDIDA','MARCAS','INICIO_VIGENCIA','FIM_VIGENCIA'];
  const rows=await all<{modelo:string;item:string;cidade:string;uf:string;cnpj:string;preco:number;fornecedor:string;medida:string;marcas:string|null;inicio:string;fim:string|null}>(`SELECT
    vm.name modelo,ci.name item,l.city cidade,l.state uf,s.cnpj,ai.price preco,s.trade_name fornecedor,
    un.code medida,ai.brands_text marcas,a.start_date inicio,a.end_date fim
    FROM agreements a JOIN suppliers s ON s.id=a.supplier_id
    JOIN agreement_items ai ON ai.version_id=a.current_version_id
    JOIN catalog_items ci ON ci.id=ai.catalog_item_id JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id
    JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
    ORDER BY s.trade_name,vm.name,ci.name,l.state,l.city,ai.id`);
  const excelDate=(value:string|null)=>value?new Date(`${value}T12:00:00.000Z`):null;
  const sheet=XLSX.utils.aoa_to_sheet([headers,...rows.map(row=>[
    row.modelo,row.item,row.cidade,row.uf,String(row.cnpj).padStart(14,'0'),Number(row.preco),row.fornecedor,row.medida,row.marcas||'',excelDate(row.inicio),excelDate(row.fim),
  ])],{cellDates:true});
  sheet['!autofilter']={ref:`A1:K${rows.length+1}`};
  sheet['!cols']=[18,30,20,6,17,13,28,10,28,17,17].map(wch=>({wch}));
  for(let line=2;line<=rows.length+1;line++){
    const cnpjCell=sheet[`E${line}`]; if(cnpjCell){cnpjCell.t='s';cnpjCell.z='@';}
    const priceCell=sheet[`F${line}`]; if(priceCell) priceCell.z='R$ #,##0.00';
    for(const column of ['J','K']){const cell=sheet[`${column}${line}`];if(cell)cell.z='dd/mm/yyyy';}
  }
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,sheet,'ACORDOS');
  const content=XLSX.write(workbook,{bookType:'xlsx',type:'array',cellDates:true}) as ArrayBuffer;
  return new NextResponse(content,{headers:{
    'cache-control':'no-store','content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition':`attachment; filename="ACORDOS-${now().slice(0,10)}.xlsx"`,'x-content-type-options':'nosniff',
  }});
}

async function internalAgreements(){
  const agreements=await all(`SELECT vm.name MODELO,ci.name PECA_SERVICO,l.city CIDADE,l.state UF,s.cnpj CNPJ,
    ai.price PRECO,s.trade_name FORNECEDOR,un.code MEDIDA,COALESCE(ai.brands_text,'') MARCAS,
    a.start_date INICIO_VIGENCIA,a.end_date FIM_VIGENCIA,a.status STATUS_ACORDO
    FROM agreements a JOIN suppliers s ON s.id=a.supplier_id
    JOIN agreement_items ai ON ai.version_id=a.current_version_id
    JOIN catalog_items ci ON ci.id=ai.catalog_item_id JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id
    JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
    ORDER BY s.trade_name,vm.name,ci.name,l.state,l.city,ai.id`);
  return ok({generatedAt:now(),agreements});
}
