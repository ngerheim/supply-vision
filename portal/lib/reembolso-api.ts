import { pode } from './permissoes.ts';
import { comAcaoEscrita } from './autor-escrita.ts';
import { type ContextoApi, type User, ehErroUnique } from './api-compartilhada.ts';
import { auditoriaNoLote } from './auditoria-api.ts';
import { inteiroPositivo } from './paginacao.ts';
import { revisaoConfere } from './controle-escrita.ts';
import {
  calcularItem, calcularTotais, centavos, lerCalculadoraHtml, validarCalculo, validarCliente, validarItensTabela,
  type ItemMtbf,
} from './reembolso.ts';

type TabelaRow = { id: string; nome: string; padrao: number; revision: number };
type ClienteRow = { id: string; nome: string; taxa: number | null; pneu_km: number | null; observacao: string | null; executivo: string | null; tabela_id: string | null; ativo: number; revision: number };
const POR_PAGINA = 50;
export const SEM_CONFIG = 'Seu perfil não permite alterar a configuração do Reembolso.';
const pct = (t: number | null) => (t === null ? 'sem taxa' : `${centavos(t * 100).toLocaleString('pt-BR')}%`);

export function reembolsoApi(contexto: ContextoApi) {
  const { rawDb, id, now, ok, fail, all, first, jsonBody } = contexto;
  const db = () => rawDb();

  // Configuracao inteira numa leitura: a calculadora monta os seletores e as
  // consultas sem novas idas ao servidor. Cliente inativo so para quem configura.
  async function config(user: User) {
    if (!pode(user, 'aba:reembolso')) return fail('Seu perfil não tem acesso ao Reembolso.', 403);
    const gestor = pode(user, 'reembolso:configurar');
    const [tabelas, itens, clientes] = await Promise.all([
      all<TabelaRow>('SELECT id,nome,padrao,revision FROM reembolso_tabelas ORDER BY padrao DESC, nome'),
      all<{ id: string; tabela_id: string; descricao: string; tipo: string | null; valores: string }>('SELECT id,tabela_id,descricao,tipo,valores FROM reembolso_itens ORDER BY tabela_id, ordem'),
      all<ClienteRow>(`SELECT id,nome,taxa,pneu_km,observacao,executivo,tabela_id,ativo,revision FROM reembolso_clientes ${gestor ? '' : 'WHERE ativo=1'} ORDER BY nome`),
    ]);
    const porTabela = new Map<string, unknown[]>();
    for (const i of itens) {
      const lista = porTabela.get(i.tabela_id) ?? [];
      lista.push({ id: i.id, descricao: i.descricao, tipo: i.tipo, valores: JSON.parse(i.valores) as unknown });
      porTabela.set(i.tabela_id, lista);
    }
    return ok({
      podeConfigurar: gestor,
      tabelas: tabelas.map(t => ({ id: t.id, nome: t.nome, padrao: t.padrao === 1, revision: t.revision, itens: porTabela.get(t.id) ?? [] })),
      clientes: clientes.map(c => ({ id: c.id, nome: c.nome, taxa: c.taxa, pneuKm: c.pneu_km, observacao: c.observacao, executivo: c.executivo,
        tabelaId: c.tabela_id, ativo: c.ativo === 1, revision: c.revision })),
    });
  }

  const insertItens = (tabelaId: string, itens: ItemMtbf[]) => itens.map((it, ordem) =>
    db().prepare('INSERT INTO reembolso_itens(id,tabela_id,ordem,descricao,tipo,valores) VALUES (?,?,?,?,?,?)')
      .bind(id('rmi'), tabelaId, ordem, it.descricao, it.tipo, JSON.stringify(it.valores)));

  // Importacao unica da calculadora em HTML. Com configuracao existente, so
  // substitui quando pedido; calculos salvos nao mudam.
  async function importar(request: Request, user: User) {
    return comAcaoEscrita('reembolso:configurar', async () => {
      const body = await jsonBody<{ html?: unknown; substituir?: unknown }>(request, 4 * 1024 * 1024);
      if (typeof body.html !== 'string' || !body.html) return fail('Envie o arquivo HTML da calculadora.');
      const dados = lerCalculadoraHtml(body.html);
      const existente = await first<{ n: number }>('SELECT (SELECT COUNT(*) FROM reembolso_clientes)+(SELECT COUNT(*) FROM reembolso_tabelas) n');
      if (existente && existente.n > 0 && body.substituir !== true) return fail('Já existe configuração. Confirme a substituição para importar por cima.', 409);
      const ts = now(), chaves = new Map<string, string>(), statements = [
        db().prepare('DELETE FROM reembolso_clientes'), db().prepare('DELETE FROM reembolso_itens'), db().prepare('DELETE FROM reembolso_tabelas'),
      ];
      for (const t of dados.tabelas) {
        const tabelaId = id('rmt');
        chaves.set(t.chave, tabelaId);
        statements.push(db().prepare('INSERT INTO reembolso_tabelas(id,nome,padrao,atualizado_em) VALUES (?,?,?,?)').bind(tabelaId, t.nome, t.padrao ? 1 : 0, ts));
        statements.push(...insertItens(tabelaId, t.itens));
      }
      for (const c of dados.clientes) {
        statements.push(db().prepare(`INSERT INTO reembolso_clientes(id,nome,taxa,pneu_km,observacao,executivo,tabela_id,ativo,atualizado_em)
          VALUES (?,?,?,?,?,?,?,1,?)`).bind(id('rmc'), c.nome, c.taxa, c.pneuKm, c.observacao, c.executivo, c.tabela ? chaves.get(c.tabela) : null, ts));
      }
      statements.push(auditoriaNoLote(contexto, user.id, 'IMPORT', 'reembolso_config', null,
        `Configuração do Reembolso importada da calculadora em HTML: ${dados.clientes.length} clientes, ${dados.tabelas.length} tabelas MTBF`));
      await db().batch(statements);
      return ok({ success: true, clientes: dados.clientes.length, tabelas: dados.tabelas.length });
    });
  }

  async function tabelaExiste(tabelaId: string | null) {
    return !tabelaId || Boolean(await first('SELECT 1 ok FROM reembolso_tabelas WHERE id=?', [tabelaId]));
  }

  async function salvarCliente(request: Request, user: User, clienteId?: string) {
    return comAcaoEscrita('reembolso:configurar', async () => {
      const body = await jsonBody<Record<string, unknown>>(request);
      const c = validarCliente(body);
      if (!await tabelaExiste(c.tabelaId)) return fail('Tabela MTBF não encontrada.', 404);
      const ts = now();
      try {
        if (!clienteId) {
          const novo = id('rmc');
          await db().batch([
            db().prepare(`INSERT INTO reembolso_clientes(id,nome,taxa,pneu_km,observacao,executivo,tabela_id,ativo,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)`)
              .bind(novo, c.nome, c.taxa, c.pneuKm, c.observacao, c.executivo, c.tabelaId, c.ativo ? 1 : 0, ts),
            auditoriaNoLote(contexto, user.id, 'CREATE', 'reembolso_cliente', novo, `Cliente ${c.nome} incluído no Reembolso (taxa ${pct(c.taxa)})`),
          ]);
          return ok({ id: novo }, { status: 201 });
        }
        const atual = await first<ClienteRow>('SELECT * FROM reembolso_clientes WHERE id=?', [clienteId]);
        if (!atual) return fail('Cliente não encontrado.', 404);
        if (!revisaoConfere(body.expectedRevision, atual.revision)) return fail('Este cliente foi alterado por outra pessoa. Atualize antes de salvar.', 409);
        const mudancas = [
          atual.nome !== c.nome && `nome: ${atual.nome} → ${c.nome}`,
          atual.taxa !== c.taxa && `taxa: ${pct(atual.taxa)} → ${pct(c.taxa)}`,
          atual.pneu_km !== c.pneuKm && `KM do pneu: ${atual.pneu_km ?? '—'} → ${c.pneuKm ?? '—'}`,
          (atual.observacao ?? null) !== c.observacao && 'observação alterada',
          (atual.executivo ?? null) !== c.executivo && `executivo: ${atual.executivo ?? '—'} → ${c.executivo ?? '—'}`,
          (atual.tabela_id ?? null) !== c.tabelaId && 'tabela MTBF alterada',
          (atual.ativo === 1) !== c.ativo && (c.ativo ? 'reativado' : 'desativado'),
        ].filter(Boolean);
        if (!mudancas.length) return ok({ success: true });
        const [r] = await db().batch([
          db().prepare(`UPDATE reembolso_clientes SET nome=?,taxa=?,pneu_km=?,observacao=?,executivo=?,tabela_id=?,ativo=?,atualizado_em=?,revision=revision+1
            WHERE id=? AND revision=?`).bind(c.nome, c.taxa, c.pneuKm, c.observacao, c.executivo, c.tabelaId, c.ativo ? 1 : 0, ts, clienteId, atual.revision),
          db().prepare(`INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) SELECT ?,?,'UPDATE','reembolso_cliente',?,?,? WHERE changes()=1`)
            .bind(id('aud'), user.id, clienteId, `${atual.nome}: ${mudancas.join('; ')}`, ts),
        ]);
        return r.meta.changes ? ok({ success: true }) : fail('Este cliente foi alterado por outra pessoa. Atualize antes de salvar.', 409);
      } catch (erro) {
        if (ehErroUnique(erro)) return fail('Já existe um cliente com esse nome.', 409);
        throw erro;
      }
    });
  }

  // Tabela salva inteira (nome e itens) de uma vez, com revisao.
  async function salvarTabela(request: Request, user: User, tabelaId?: string) {
    return comAcaoEscrita('reembolso:configurar', async () => {
      const body = await jsonBody<{ nome?: unknown; itens?: unknown; padrao?: unknown; expectedRevision?: unknown }>(request, 2 * 1024 * 1024);
      const nome = typeof body.nome === 'string' ? body.nome.trim().slice(0, 200) : '';
      if (!nome) return fail('Informe o nome da tabela.');
      const itens = validarItensTabela(body.itens ?? []);
      const ts = now();
      try {
        if (!tabelaId) {
          const nova = id('rmt'), padrao = !await first('SELECT 1 ok FROM reembolso_tabelas WHERE padrao=1');
          await db().batch([
            db().prepare('INSERT INTO reembolso_tabelas(id,nome,padrao,atualizado_em) VALUES (?,?,?,?)').bind(nova, nome, padrao ? 1 : 0, ts),
            ...insertItens(nova, itens),
            auditoriaNoLote(contexto, user.id, 'CREATE', 'reembolso_tabela', nova, `Tabela MTBF ${nome} criada com ${itens.length} itens`),
          ]);
          return ok({ id: nova }, { status: 201 });
        }
        const atual = await first<TabelaRow>('SELECT id,nome,padrao,revision FROM reembolso_tabelas WHERE id=?', [tabelaId]);
        if (!atual) return fail('Tabela MTBF não encontrada.', 404);
        if (!revisaoConfere(body.expectedRevision, atual.revision)) return fail('Esta tabela foi alterada por outra pessoa. Atualize antes de salvar.', 409);
        const tornarPadrao = body.padrao === true && atual.padrao !== 1;
        // A revisao e conferida dentro da transacao: outra gravacao no meio
        // tempo desfaz tudo, sem misturar itens das duas.
        await db().batchConstruir(consultar => {
          const agora = consultar({ sql: 'SELECT revision FROM reembolso_tabelas WHERE id=?', values: [tabelaId] }).results[0] as { revision: number } | undefined;
          if (!agora || agora.revision !== atual.revision) throw new ConflitoTabela();
          return [
            db().prepare('UPDATE reembolso_tabelas SET nome=?,atualizado_em=?,revision=revision+1 WHERE id=?').bind(nome, ts, tabelaId),
            db().prepare('DELETE FROM reembolso_itens WHERE tabela_id=?').bind(tabelaId),
            ...insertItens(tabelaId, itens),
            ...(tornarPadrao ? [db().prepare('UPDATE reembolso_tabelas SET padrao=0 WHERE padrao=1'), db().prepare('UPDATE reembolso_tabelas SET padrao=1 WHERE id=?').bind(tabelaId)] : []),
            auditoriaNoLote(contexto, user.id, 'UPDATE', 'reembolso_tabela', tabelaId, `Tabela MTBF ${atual.nome}${atual.nome !== nome ? ` → ${nome}` : ''} salva com ${itens.length} itens${tornarPadrao ? '; passa a ser a padrão' : ''}`),
          ];
        });
        return ok({ success: true });
      } catch (erro) {
        if (erro instanceof ConflitoTabela) return fail('Esta tabela foi alterada por outra pessoa. Atualize antes de salvar.', 409);
        if (ehErroUnique(erro)) return fail('Já existe uma tabela com esse nome.', 409);
        throw erro;
      }
    });
  }

  async function excluirTabela(user: User, tabelaId: string) {
    return comAcaoEscrita('reembolso:configurar', async () => {
      const atual = await first<TabelaRow>('SELECT id,nome,padrao,revision FROM reembolso_tabelas WHERE id=?', [tabelaId]);
      if (!atual) return fail('Tabela MTBF não encontrada.', 404);
      if (atual.padrao === 1) return fail('A tabela padrão não pode ser excluída. Escolha outra como padrão antes.', 409);
      const usados = await first<{ n: number }>('SELECT COUNT(*) n FROM reembolso_clientes WHERE tabela_id=?', [tabelaId]);
      if (usados && usados.n > 0) return fail(`A tabela está vinculada a ${usados.n} cliente(s). Troque a tabela deles antes de excluir.`, 409);
      await db().batch([
        db().prepare('DELETE FROM reembolso_tabelas WHERE id=?').bind(tabelaId),
        auditoriaNoLote(contexto, user.id, 'DELETE', 'reembolso_tabela', tabelaId, `Tabela MTBF ${atual.nome} excluída`),
      ]);
      return ok({ success: true });
    });
  }

  async function excluirCliente(user: User, clienteId: string) {
    return comAcaoEscrita('reembolso:configurar', async () => {
      const atual = await first<{ nome: string }>('SELECT nome FROM reembolso_clientes WHERE id=?', [clienteId]);
      if (!atual) return fail('Cliente não encontrado.', 404);
      await db().batch([
        db().prepare('DELETE FROM reembolso_clientes WHERE id=?').bind(clienteId),
        auditoriaNoLote(contexto, user.id, 'DELETE', 'reembolso_cliente', clienteId, `Cliente ${atual.nome} excluído do Reembolso`),
      ]);
      return ok({ success: true });
    });
  }

  // Calculos salvos: o servidor refaz os totais com as mesmas formulas da tela.
  async function salvarCalculo(request: Request, user: User) {
    return comAcaoEscrita('reembolso:salvar', async () => {
      const c = validarCalculo(await jsonBody(request, 256 * 1024));
      const totais = calcularTotais(c.itens, c.kmAtual, c.taxa), novo = id('rmk');
      await db().prepare(`INSERT INTO reembolso_calculos(id,placa,cliente,taxa,categoria,modelo,km_atual,os_atual,observacao,tabela,itens,total_custo,total_reembolso,user_id,criado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(novo, c.placa, c.cliente, c.taxa, c.categoria, c.modelo, c.kmAtual, c.osAtual, c.observacao, c.tabela,
        JSON.stringify(c.itens), centavos(totais.custo), centavos(totais.reembolso), user.id, now()).run();
      return ok({ id: novo, totalReembolso: centavos(totais.reembolso) }, { status: 201 });
    });
  }

  async function listarCalculos(user: User, params: URLSearchParams) {
    if (!pode(user, 'aba:reembolso')) return fail('Seu perfil não tem acesso ao Reembolso.', 403);
    const busca = (params.get('q') || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 60);
    const pagina = inteiroPositivo(params.get('pagina'), 1);
    const filtro = busca ? 'WHERE k.placa LIKE ? OR upper(k.cliente) LIKE ?' : '';
    const valores = busca ? [`%${busca.replace(/ /g, '')}%`, `%${busca}%`] : [];
    const [linhas, total] = await Promise.all([
      all(`SELECT k.id,k.placa,k.cliente,k.modelo,k.categoria,k.taxa,k.total_custo totalCusto,k.total_reembolso totalReembolso,k.criado_em criadoEm,
        u.name autor,k.user_id autorId FROM reembolso_calculos k LEFT JOIN users u ON u.id=k.user_id ${filtro}
        ORDER BY k.criado_em DESC, k.id DESC LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`, valores),
      first<{ n: number }>(`SELECT COUNT(*) n FROM reembolso_calculos k ${filtro}`, valores),
    ]);
    const n = total?.n ?? 0;
    return ok({ calculos: linhas, total: n, pagina, paginas: Math.max(1, Math.ceil(n / POR_PAGINA)) });
  }

  async function detalheCalculo(user: User, calculoId: string) {
    if (!pode(user, 'aba:reembolso')) return fail('Seu perfil não tem acesso ao Reembolso.', 403);
    const k = await first<Record<string, unknown> & { itens: string; km_atual: number; taxa: number }>(
      'SELECT k.*,u.name autor FROM reembolso_calculos k LEFT JOIN users u ON u.id=k.user_id WHERE k.id=?', [calculoId]);
    if (!k) return fail('Cálculo não encontrado.', 404);
    const itens = (JSON.parse(k.itens) as Parameters<typeof calcularItem>[0][]).map(i => ({ ...i, ...calcularItem(i, k.km_atual, k.taxa) }));
    return ok({ calculo: { id: k.id, placa: k.placa, cliente: k.cliente, taxa: k.taxa, categoria: k.categoria, modelo: k.modelo, kmAtual: k.km_atual,
      osAtual: k.os_atual, observacao: k.observacao, tabela: k.tabela, itens, totalCusto: k.total_custo, totalReembolso: k.total_reembolso,
      criadoEm: k.criado_em, autor: k.autor, autorId: k.user_id } });
  }

  async function excluirCalculo(user: User, calculoId: string) {
    return comAcaoEscrita('reembolso:salvar', async () => {
      const k = await first<{ user_id: string; placa: string | null }>('SELECT user_id,placa FROM reembolso_calculos WHERE id=?', [calculoId]);
      if (!k) return fail('Cálculo não encontrado.', 404);
      if (k.user_id !== user.id && !pode(user, 'reembolso:configurar')) return fail('Só quem salvou o cálculo ou Suprimentos pode excluí-lo.', 403);
      await db().batch([
        db().prepare('DELETE FROM reembolso_calculos WHERE id=?').bind(calculoId),
        auditoriaNoLote(contexto, user.id, 'DELETE', 'reembolso_calculo', calculoId, `Cálculo de reembolso excluído${k.placa ? ` (placa ${k.placa})` : ''}`),
      ]);
      return ok({ success: true });
    });
  }

  return { config, importar, salvarCliente, excluirCliente, salvarTabela, excluirTabela, salvarCalculo, listarCalculos, detalheCalculo, excluirCalculo };
}

class ConflitoTabela extends Error {}
