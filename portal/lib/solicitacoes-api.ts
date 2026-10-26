import type { ContextoApi, Row, User } from './api-compartilhada.ts';
import { ehErroUnique } from './api-compartilhada.ts';
import { pode } from './permissoes.ts';
import { comAcaoEscrita } from './autor-escrita.ts';
import { revisaoConfere } from './controle-escrita.ts';
import { chaveIdempotencia, EntradaInvalida, LIMITES_CAMPO } from './limites-entrada.ts';
import { isValidCnpj, isValidState, normalizeCnpj, normalizeText } from './domain.ts';
import { intervaloDatasNegocio } from './periodo-auditoria.ts';
import { paginaSolicitada } from './paginacao.ts';
import { criarConsultasFornecedor, FalhaConsulta, type DadosReceita } from './consultas-fornecedor.ts';
import { prepararAvisosSolicitacao } from './fila-email-solicitacoes.ts';

const STATUS = ['aberta', 'em_analise', 'devolvida', 'cadastrado', 'recusado'];
const RECEITA = ['cnpj', 'razao_social', 'nome_fantasia', 'situacao_cadastral', 'cnae_codigo', 'cnae_descricao', 'consulta_fonte', 'consultada_em', 'nao_verificado'] as const;
const EDITAVEIS = ['logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep', 'telefone', 'email', 'atendimento_cidade', 'atendimento_uf', 'urgencia'] as const;
type Solicitacao = Row & { id: string; codigo: string; cnpj: string; status: string; solicitante_id: string; revision: number; nao_verificado: number };
type Corpo = Record<string, unknown>;

function campo(body: Corpo, nome: string, maximo = 200): string {
  const valor = body[nome];
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string' || valor.trim().length > maximo) throw new EntradaInvalida(`Campo inválido: ${nome} (máximo ${maximo} caracteres).`);
  return valor.trim();
}
function editaveis(body: Corpo, anterior: Corpo = {}) {
  const dados: Record<string, string> = {};
  for (const nome of EDITAVEIS) dados[nome] = campo(body[nome] === undefined ? anterior : body, nome, nome === 'email' ? LIMITES_CAMPO.email : nome === 'numero' ? 30 : nome.endsWith('cidade') ? LIMITES_CAMPO.cidade : 200);
  dados.urgencia ||= 'normal';
  if (!['normal', 'urgente'].includes(String(dados.urgencia))) throw new EntradaInvalida('Urgência inválida.');
  for (const nome of ['uf', 'atendimento_uf']) {
    dados[nome] = String(dados[nome]).toUpperCase();
    if (dados[nome] && !isValidState(dados[nome])) throw new EntradaInvalida(`UF inválida: ${nome}.`);
  }
  if (dados.cep && !/^\d{8}$/.test(String(dados.cep))) throw new EntradaInvalida('Informe um CEP com 8 dígitos.');
  if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(dados.email))) throw new EntradaInvalida('Informe um e-mail válido.');
  return dados;
}

export function solicitacoesApi(contexto: ContextoApi, consultas = criarConsultasFornecedor()) {
  const { rawDb, all, first, id, now, ok, fail, jsonBody, tokenHash } = contexto;
  const conflito = () => fail('Esta solicitação foi alterada. Atualize antes de salvar novamente.', 409);
  const inexistente = () => fail('Solicitação não encontrada.', 404);
  const statement = (sql: string, valores: unknown[] = []) => rawDb().prepare(sql).bind(...valores);
  const auditoria = (user: User, entidade: string, registro: string, acao: string, detalhes: string, timestamp: string, condicao = '1', valores: unknown[] = []) =>
    statement(`INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE ${condicao}`, [id('aud'), user.id, acao, entidade, registro, detalhes, timestamp, ...valores]);

  async function consultarCnpj(user: User, numero: string) {
    return comAcaoEscrita('solicitacao:abrir', async () => {
      try {
        const { dados, fonte } = await consultas.cnpj(numero);
        const recente = await first<{ id: string; fonte: string; dados_json: string; consultada_em: string }>('SELECT id,fonte,dados_json,consultada_em FROM consultas_cnpj WHERE user_id=? AND cnpj=? AND julianday(consultada_em)>=julianday(?) ORDER BY consultada_em DESC,rowid DESC LIMIT 1', [user.id, dados.cnpj, new Date(Date.now() - 600_000).toISOString()]);
        if (recente) return ok({ ...JSON.parse(recente.dados_json) as DadosReceita, consulta_fonte: recente.fonte, consultada_em: recente.consultada_em, consultaId: recente.id });
        const consultaId = id('cnpj'), consultada_em = now();
        await statement('INSERT INTO consultas_cnpj(id,cnpj,fonte,dados_json,consultada_em,user_id) VALUES(?,?,?,?,?,?)', [consultaId, dados.cnpj, fonte, JSON.stringify(dados), consultada_em, user.id]).run();
        return ok({ ...dados, consulta_fonte: fonte, consultada_em, consultaId });
      } catch (erro) { if (erro instanceof FalhaConsulta) return fail(erro.message, erro.status); throw erro; }
    });
  }
  async function consultarCep(numero: string) {
    try { return ok(await consultas.cep(numero)); }
    catch (erro) { if (erro instanceof FalhaConsulta) return fail(erro.message, erro.status); throw erro; }
  }
  async function listar(user: User, params: URLSearchParams) {
    const condicoes: string[] = [], valores: unknown[] = [];
    if (!pode(user, 'solicitacao:ver_todas')) { condicoes.push('solicitante_id=?'); valores.push(user.id); }
    for (const [chave, permitidos] of [['status', STATUS], ['urgencia', ['normal', 'urgente']], ['nao_verificado', ['0', '1']]] as const) {
      const valor = params.get(chave);
      if (valor !== null) {
        if (!(permitidos as readonly string[]).includes(valor)) throw new EntradaInvalida(`Filtro inválido: ${chave}.`);
        condicoes.push(`${chave}=?`); valores.push(valor);
      }
    }
    const periodo = intervaloDatasNegocio(params.get('de'), params.get('ate'));
    if (periodo.inicio) { condicoes.push('julianday(criado_em)>=julianday(?)'); valores.push(periodo.inicio); }
    if (periodo.fim) { condicoes.push('julianday(criado_em)<julianday(?)'); valores.push(periodo.fim); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const total = Number((await first<{ n: number }>(`SELECT COUNT(*) n FROM solicitacoes ${where}`, valores))?.n ?? 0);
    const paginacao = paginaSolicitada(params), pageCount = Math.max(1, Math.ceil(total / paginacao.pageSize)), page = Math.min(paginacao.page, pageCount);
    // A lista precisa dos nomes sem uma chamada de detalhe para cada linha.
    // A restricao por solicitante continua no mesmo WHERE da contagem.
    const linhas = await all(`SELECT solicitacoes.*,
      (SELECT name FROM users WHERE users.id=solicitacoes.solicitante_id) AS solicitante,
      (SELECT json_group_array(json_object('id',c.id,'nome',c.nome)) FROM categorias_fornecedor c JOIN solicitacao_categorias sc ON sc.categoria_id=c.id WHERE sc.solicitacao_id=solicitacoes.id) AS categorias_json
      FROM solicitacoes ${where} ORDER BY atualizado_em DESC,id DESC LIMIT ? OFFSET ?`, [...valores, paginacao.pageSize, (page - 1) * paginacao.pageSize]);
    const solicitacoes = linhas.map(({ categorias_json, solicitante, ...linha }) => ({ ...linha,
      categorias: JSON.parse(String(categorias_json)), ...(pode(user, 'solicitacao:ver_todas') ? { solicitante } : {}),
    }));
    return ok({ solicitacoes, total, page, pageCount, pageSize: paginacao.pageSize });
  }
  async function detalhe(user: User, solicitacaoId: string) {
    const solicitacao = await first<Solicitacao>('SELECT * FROM solicitacoes WHERE id=?', [solicitacaoId]);
    if (!solicitacao || (solicitacao.solicitante_id !== user.id && !pode(user, 'solicitacao:ver_todas'))) return inexistente();
    const categorias = await all('SELECT c.* FROM categorias_fornecedor c JOIN solicitacao_categorias sc ON sc.categoria_id=c.id WHERE sc.solicitacao_id=? ORDER BY c.nome', [solicitacaoId]);
    const andamentos = await all('SELECT a.id,a.user_id,a.de_status,a.para_status,a.texto,a.criado_em,u.name AS usuario FROM solicitacao_andamentos a JOIN users u ON u.id=a.user_id WHERE solicitacao_id=? ORDER BY a.criado_em,a.rowid', [solicitacaoId]);
    const relacionados = pode(user, 'chamado:consultar') ? await all(`SELECT code AS codigo,status,supplier_name AS fornecedor FROM tickets WHERE cnpj=? AND (status IN ('aberto','aguardando_fornecedor') OR julianday(updated_at)>=julianday(?)) ORDER BY updated_at DESC,id DESC`, [solicitacao.cnpj, new Date(Date.now() - 90 * 86400_000).toISOString()]) : undefined;
    return ok({ solicitacao, categorias, andamentos, ...(relacionados === undefined ? {} : { relacionados }) });
  }
  async function dadosReceita(body: Corpo, user: User, anterior?: Solicitacao): Promise<Corpo> {
    if (body.consultaId !== undefined) {
      const consultaId = campo(body, 'consultaId', 100);
      const consulta = await first<{ cnpj: string; fonte: string; dados_json: string; consultada_em: string }>('SELECT cnpj,fonte,dados_json,consultada_em FROM consultas_cnpj WHERE id=? AND user_id=?', [consultaId, user.id]);
      if (!consulta) throw new EntradaInvalida('Consulta não encontrada. Consulte o CNPJ novamente.');
      if (anterior && consulta.cnpj !== anterior.cnpj) throw new EntradaInvalida('O CNPJ da solicitação não pode ser alterado.');
      return { ...JSON.parse(consulta.dados_json) as DadosReceita, consulta_fonte: consulta.fonte, consultada_em: consulta.consultada_em, nao_verificado: 0 };
    }
    if (anterior && !anterior.nao_verificado) return Object.fromEntries(RECEITA.map(nome => [nome, anterior[nome]]));
    const fonte = { ...anterior, ...body }, cnpj = normalizeCnpj(campo(fonte, 'cnpj', 20));
    if (!isValidCnpj(cnpj)) throw new EntradaInvalida('Informe um CNPJ válido.');
    if (anterior && cnpj !== anterior.cnpj) throw new EntradaInvalida('O CNPJ da solicitação não pode ser alterado.');
    const dados: Corpo = { cnpj };
    for (const nome of ['razao_social', 'nome_fantasia', 'situacao_cadastral', 'cnae_codigo', 'cnae_descricao']) dados[nome] = campo(fonte, nome);
    if (!dados.razao_social) throw new EntradaInvalida('Informe a razão social.');
    return { ...dados, consulta_fonte: null, consultada_em: null, nao_verificado: 1 };
  }
  function bloqueioSituacao(dados: Corpo) {
    return !dados.nao_verificado && dados.situacao_cadastral !== 'ATIVA' ? fail(`CNPJ com situação cadastral ${String(dados.situacao_cadastral)}. Somente empresas ATIVAS podem ser solicitadas.`, 409) : null;
  }
  async function duplicada(cnpj: string) {
    const existente = await first<{ id: string; codigo: string; status: string }>("SELECT id,codigo,status FROM solicitacoes WHERE cnpj=? AND status IN ('aberta','em_analise','devolvida')", [cnpj]);
    return existente ? ok({ error: `Já existe a solicitação ${existente.codigo} com status ${existente.status} para este CNPJ.`, existente }, { status: 409 }) : null;
  }
  async function categoriasEntrada(valor: unknown): Promise<string[]> {
    if (!Array.isArray(valor) || valor.length > 80 || valor.some(v => typeof v !== 'string' || !v || v.length > 100)) throw new EntradaInvalida('Categorias inválidas.');
    const categorias = [...new Set(valor)] as string[];
    if (categorias.length && Number((await first<{ n: number }>(`SELECT COUNT(*) n FROM categorias_fornecedor WHERE ativo=1 AND id IN (${categorias.map(() => '?').join(',')})`, categorias))?.n) !== categorias.length) throw new EntradaInvalida('Selecione somente categorias ativas.');
    return categorias;
  }
  function categoriasAtivas(categorias: string[]) {
    return categorias.length ? { sql: `(SELECT COUNT(*) FROM categorias_fornecedor WHERE ativo=1 AND id IN (${categorias.map(() => '?').join(',')}))=?`, valores: [...categorias, categorias.length] } : { sql: '1', valores: [] };
  }
  async function criar(request: Request, user: User) {
    return comAcaoEscrita('solicitacao:abrir', async () => {
      const body = await jsonBody<Corpo>(request), chave = chaveIdempotencia(request), hash = chave ? await tokenHash(JSON.stringify(body)) : null;
      const repetida = async () => {
        if (!chave) return null;
        const antiga = await first<{ id: string; codigo: string; request_hash: string }>('SELECT id,codigo,request_hash FROM solicitacoes WHERE solicitante_id=? AND request_key=?', [user.id, chave]);
        return antiga ? antiga.request_hash !== hash ? fail('Esta tentativa já foi usada com outros dados.', 409) : ok({ id: antiga.id, codigo: antiga.codigo }, { status: 201 }) : null;
      };
      const anterior = await repetida(); if (anterior) return anterior;
      const receita = await dadosReceita(body, user), bloqueio = bloqueioSituacao(receita); if (bloqueio) return bloqueio;
      const repeticaoCnpj = await duplicada(String(receita.cnpj)); if (repeticaoCnpj) return repeticaoCnpj;
      const dados = { ...receita, ...editaveis(body, receita) }, categorias = await categoriasEntrada(body.categorias ?? []);
      const campos = [...RECEITA, ...EDITAVEIS], timestamp = now(), solicitacaoId = id('sol'), evento = id('san'), ativas = categoriasAtivas(categorias);
      const avisos = await prepararAvisosSolicitacao(contexto, { solicitacaoId, evento, autor: user, anterior: null, para: 'aberta', timestamp });
      try {
        const resultados = await rawDb().batch([
          statement(`INSERT INTO solicitacoes(id,${campos.join(',')},solicitante_id,criado_em,atualizado_em,request_key,request_hash) SELECT ${Array(campos.length + 6).fill('?').join(',')} WHERE ${ativas.sql}`, [solicitacaoId, ...campos.map(c => dados[c]), user.id, timestamp, timestamp, chave, hash, ...ativas.valores]),
          statement("INSERT INTO solicitacao_andamentos(id,solicitacao_id,user_id,para_status,texto,criado_em) SELECT ?,?,?,'aberta','Solicitação aberta',? WHERE EXISTS(SELECT 1 FROM solicitacoes WHERE id=?)", [evento, solicitacaoId, user.id, timestamp, solicitacaoId]),
          ...categorias.map(c => statement('INSERT INTO solicitacao_categorias(solicitacao_id,categoria_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM solicitacoes WHERE id=?)', [solicitacaoId, c, solicitacaoId])),
          auditoria(user, 'solicitacao', solicitacaoId, 'CREATE', 'Solicitação de cadastro de fornecedor aberta', timestamp, 'EXISTS(SELECT 1 FROM solicitacoes WHERE id=?)', [solicitacaoId]),
          ...avisos,
        ]);
        if (!resultados[0].meta.changes) return fail('Uma categoria foi desativada. Atualize e tente novamente.', 409);
      } catch (erro) {
        if (!ehErroUnique(erro)) throw erro;
        const resposta = await repetida() ?? await duplicada(String(receita.cnpj)); if (resposta) return resposta;
        throw erro;
      }
      const registro = await first<{ codigo: string }>('SELECT codigo FROM solicitacoes WHERE id=?', [solicitacaoId]);
      return ok({ id: solicitacaoId, codigo: registro!.codigo }, { status: 201 });
    });
  }

  // O UPDATE condicional decide a revisao dentro de BEGIN IMMEDIATE. O evento
  // so nasce se ele mudou uma linha; o id novo do evento condiciona o resto.
  async function salvar(user: User, atual: Solicitacao, dados: Corpo, para: string, texto: string, chave: string | null, hash: string | null, categorias?: string[], consulta?: DadosReceita) {
    const timestamp = now(), evento = id('san'), campos = Object.keys(dados), ativas = categoriasAtivas(categorias ?? []);
    const condicaoEvento = 'EXISTS(SELECT 1 FROM solicitacao_andamentos WHERE id=?)';
    const avisos = await prepararAvisosSolicitacao(contexto, { solicitacaoId: atual.id, evento, autor: user, anterior: atual.status, para, timestamp });
    const resultados = await rawDb().batch([
      statement(`UPDATE solicitacoes SET ${campos.map(c => `${c}=?`).join(',')},status=?,atualizado_em=?,revision=revision+1 WHERE id=? AND revision=? AND status=? AND ${ativas.sql}`, [...campos.map(c => dados[c]), para, timestamp, atual.id, atual.revision, atual.status, ...ativas.valores]),
      statement('INSERT INTO solicitacao_andamentos(id,solicitacao_id,user_id,de_status,para_status,texto,criado_em,request_key,request_hash) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1', [evento, atual.id, user.id, atual.status, para, texto || null, timestamp, chave, hash]),
      ...(consulta ? [statement(`INSERT INTO consultas_cnpj(id,cnpj,fonte,dados_json,consultada_em,user_id) SELECT ?,?,?,?,?,? WHERE ${condicaoEvento}`, [id('cnpj'), atual.cnpj, dados.consulta_fonte, JSON.stringify(consulta), timestamp, user.id, evento])] : []),
      ...(categorias === undefined ? [] : [statement(`DELETE FROM solicitacao_categorias WHERE solicitacao_id=? AND ${condicaoEvento}`, [atual.id, evento]), ...categorias.map(c => statement(`INSERT INTO solicitacao_categorias(solicitacao_id,categoria_id) SELECT ?,? WHERE ${condicaoEvento}`, [atual.id, c, evento]))]),
      auditoria(user, 'solicitacao', atual.id, 'UPDATE', `Solicitação ${atual.codigo}: ${atual.status} → ${para}${texto ? `; ${texto}` : ''}`, timestamp, condicaoEvento, [evento]),
      ...avisos,
    ]);
    return resultados[0].meta.changes ? ok({ success: true, revision: atual.revision + 1 }) : conflito();
  }
  async function corrigir(request: Request, user: User, solicitacaoId: string) {
    return comAcaoEscrita('solicitacao:abrir', async () => {
      const body = await jsonBody<Corpo>(request), atual = await first<Solicitacao>('SELECT * FROM solicitacoes WHERE id=? AND solicitante_id=?', [solicitacaoId, user.id]);
      if (!atual) return inexistente();
      if (!revisaoConfere(body.expectedRevision, atual.revision)) return conflito();
      if (atual.status !== 'devolvida') return fail('Somente solicitações devolvidas podem ser corrigidas.', 409);
      const receita = await dadosReceita(body, user, atual), bloqueio = bloqueioSituacao(receita); if (bloqueio) return bloqueio;
      const categorias = body.categorias === undefined ? undefined : await categoriasEntrada(body.categorias);
      return salvar(user, atual, { ...Object.fromEntries(RECEITA.map(c => [c, receita[c]])), ...editaveis(body, atual) }, 'aberta', 'Solicitação corrigida pelo solicitante', null, null, categorias);
    });
  }
  async function transicionar(request: Request, user: User, solicitacaoId: string) {
    return comAcaoEscrita('solicitacao:atender', async () => {
      if (!pode(user, 'solicitacao:atender')) return fail('Seu perfil não permite atender solicitações.', 403);
      const body = await jsonBody<Corpo>(request), atual = await first<Solicitacao>('SELECT * FROM solicitacoes WHERE id=?', [solicitacaoId]);
      if (!atual) return inexistente();
      const chave = chaveIdempotencia(request), hash = chave ? await tokenHash(`transicao:${JSON.stringify(body)}`) : null;
      if (chave) {
        const anterior = await first<{ request_hash: string }>('SELECT request_hash FROM solicitacao_andamentos WHERE solicitacao_id=? AND user_id=? AND request_key=?', [solicitacaoId, user.id, chave]);
        if (anterior) return anterior.request_hash === hash ? ok({ success: true }) : fail('Esta tentativa já foi usada com outros dados.', 409);
      }
      if (!revisaoConfere(body.expectedRevision, atual.revision)) return conflito();
      const para = campo(body, 'para', 30), texto = campo(body, 'texto', LIMITES_CAMPO.mensagem);
      if (!((atual.status === 'aberta' && para === 'em_analise') || (atual.status === 'em_analise' && ['cadastrado', 'recusado', 'devolvida'].includes(para)))) return fail('Transição de situação inválida.', 409);
      if (['recusado', 'devolvida'].includes(para) && !texto) return fail('Informe o motivo ou a mensagem de devolução.');
      return salvar(user, atual, { atendente_id: para === 'em_analise' ? user.id : atual.atendente_id, motivo_recusa: para === 'recusado' ? texto : null }, para, texto, chave, hash);
    });
  }
  async function reconsultar(request: Request, user: User, solicitacaoId: string) {
    return comAcaoEscrita('solicitacao:atender', async () => {
      if (!pode(user, 'solicitacao:atender')) return fail('Seu perfil não permite atender solicitações.', 403);
      const body = await jsonBody<Corpo>(request), atual = await first<Solicitacao>('SELECT * FROM solicitacoes WHERE id=?', [solicitacaoId]);
      if (!atual) return inexistente();
      if (!revisaoConfere(body.expectedRevision, atual.revision)) return conflito();
      try {
        const { dados, fonte } = await consultas.cnpj(atual.cnpj, true);
        // Reconsulta preserva o endereco ajustado e o historico do atendimento.
        return salvar(user, atual, { ...Object.fromEntries(RECEITA.filter(c => c in dados).map(c => [c, dados[c as keyof DadosReceita]])), consulta_fonte: fonte, consultada_em: now(), nao_verificado: 0 }, atual.status, 'Reconsultado na Receita', null, null, undefined, dados);
      } catch (erro) { if (erro instanceof FalhaConsulta) return fail(erro.message, erro.status); throw erro; }
    });
  }
  async function listarCategorias(user: User) {
    return ok({ categorias: await all(`SELECT * FROM categorias_fornecedor ${pode(user, 'categoria:gerenciar') ? '' : 'WHERE ativo=1'} ORDER BY nome,id`) });
  }
  async function gravarCategoria(request: Request, user: User, categoriaId?: string) {
    return comAcaoEscrita('categoria:gerenciar', async () => {
      if (!pode(user, 'categoria:gerenciar')) return fail('Seu perfil não permite gerenciar categorias.', 403);
      const body = await jsonBody<Corpo>(request), atual = categoriaId ? await first<{ nome: string; ativo: number; revision: number }>('SELECT * FROM categorias_fornecedor WHERE id=?', [categoriaId]) : null;
      if (categoriaId && !atual) return fail('Categoria não encontrada.', 404);
      if (atual && !revisaoConfere(body.expectedRevision, atual.revision)) return conflito();
      const nome = body.nome === undefined && atual ? atual.nome : campo(body, 'nome', LIMITES_CAMPO.nome);
      if (!nome) return fail('Informe o nome da categoria.');
      if (body.ativo !== undefined && ![true, false, 0, 1].includes(body.ativo as boolean)) return fail('Situação da categoria inválida.');
      const ativo = body.ativo === undefined ? atual?.ativo ?? 1 : body.ativo === true || body.ativo === 1 ? 1 : 0;
      const registro = categoriaId ?? id('cat'), timestamp = now();
      try {
        const resultados = await rawDb().batch([
          atual ? statement('UPDATE categorias_fornecedor SET nome=?,nome_chave=?,ativo=?,revision=revision+1 WHERE id=? AND revision=?', [nome, normalizeText(nome).normalize('NFC'), ativo, registro, atual.revision]) : statement('INSERT INTO categorias_fornecedor(id,nome,nome_chave,ativo) VALUES(?,?,?,?)', [registro, nome, normalizeText(nome).normalize('NFC'), ativo]),
          auditoria(user, 'categoria_fornecedor', registro, atual ? 'UPDATE' : 'CREATE', `Categoria: ${nome}; ativa: ${ativo}`, timestamp, 'changes()=1'),
        ]);
        if (!resultados[0].meta.changes) return conflito();
      } catch (erro) { if (ehErroUnique(erro)) return fail('Já existe uma categoria com esse nome.', 409); throw erro; }
      return ok({ id: registro, revision: atual ? atual.revision + 1 : 0 }, { status: atual ? 200 : 201 });
    });
  }
  return { consultarCnpj, consultarCep, listar, detalhe, criar, corrigir, transicionar, reconsultar, listarCategorias, gravarCategoria };
}
