import type { ContextoApi, Row, User } from './api-compartilhada.ts';
import { ehErroUnique } from './api-compartilhada.ts';
import { pode } from './permissoes.ts';
import { comAcaoEscrita } from './autor-escrita.ts';
import { revisaoConfere } from './controle-escrita.ts';
import {
  chaveIdempotencia,
  EntradaInvalida,
  LIMITES_CAMPO,
} from './limites-entrada.ts';
import { normalizeText } from './domain.ts';
import { prepararNotificacaoCondicional } from './central-notificacoes.ts';
import { intervaloDatasNegocio } from './periodo-auditoria.ts';
import { paginaSolicitada } from './paginacao.ts';
import { linkBaixa, normalizarPlaca, SITUACOES_BAIXA } from './baixas.ts';

type Corpo = Record<string, unknown>;
type Baixa = Row & {
  id: string;
  codigo: string;
  status: string;
  solicitante_id: string;
  revision: number;
};
function campo(body: Corpo, nome: string, maximo: number): string {
  const valor = body[nome];
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string' || valor.trim().length > maximo)
    throw new EntradaInvalida(`Campo inválido: ${nome}.`);
  return valor.trim();
}

export function baixasApi(contexto: ContextoApi) {
  const { rawDb, all, first, id, now, ok, fail, jsonBody, tokenHash } =
    contexto;
  const statement = (sql: string, valores: unknown[] = []) =>
    rawDb()
      .prepare(sql)
      .bind(...valores);
  const conflito = () =>
    fail(
      'Este registro foi alterado. Recarregue antes de salvar novamente.',
      409,
    );
  const inexistente = () => fail('Baixa não encontrada.', 404);
  const auditoria = (
    user: User,
    entidade: string,
    registro: string,
    acao: string,
    texto: string,
    timestamp: string,
    condicao: string,
    valores: unknown[] = [],
    detalhesSql = '?',
    valoresDetalhes: unknown[] = [],
  ) =>
    statement(
      `INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) SELECT ?,?,?,?,?,${detalhesSql},? WHERE ${condicao}`,
      [
        id('aud'),
        user.id,
        acao,
        entidade,
        registro,
        ...(detalhesSql === '?' ? [texto] : valoresDetalhes),
        timestamp,
        ...valores,
      ],
    );

  async function avisos(
    baixaId: string,
    evento: string,
    autor: User,
    atual: Baixa | null,
    para: string,
    texto: string,
    timestamp: string,
  ) {
    const pessoas = await all<User & { active: number }>(
      'SELECT id,name,email,role,active FROM users WHERE active=1',
    );
    return pessoas
      .filter(
        (p) =>
          p.id !== autor.id &&
          (atual ? p.id === atual.solicitante_id : pode(p, 'baixa:atender')),
      )
      .map((p) => {
        const mensagem = `${SITUACOES_BAIXA[para as keyof typeof SITUACOES_BAIXA]}${texto ? `; ${texto}` : ''}`;
        return prepararNotificacaoCondicional({ tipo:'baixa', texto:mensagem, textoSql:"b.codigo || ': ' || ?", link:linkBaixa(baixaId), timestamp, origem:'baixas_estoque b', destinatarioSql:'?', valoresDestinatario:[p.id], condicao:'b.id=? AND EXISTS(SELECT 1 FROM baixa_andamentos WHERE id=? AND baixa_id=b.id) AND ? IN (SELECT role FROM users WHERE id=? AND active=1)', valoresTexto:[mensagem], valores:[baixaId, evento, p.role, p.id] });
      });
  }
  async function listar(user: User, params: URLSearchParams) {
    const condicoes: string[] = [],
      valores: unknown[] = [];
    if (!pode(user, 'baixa:ver_todas')) {
      condicoes.push('b.solicitante_id=?');
      valores.push(user.id);
    }
    const status = params.get('status'),
      estoque = params.get('estoque');
    if (status !== null) {
      if (!Object.hasOwn(SITUACOES_BAIXA, status))
        throw new EntradaInvalida('Situação inválida.');
      condicoes.push('b.status=?');
      valores.push(status);
    }
    if (estoque !== null) {
      if (!estoque || estoque.length > 100)
        throw new EntradaInvalida('Estoque inválido.');
      condicoes.push('b.estoque_id=?');
      valores.push(estoque);
    }
    const periodo = intervaloDatasNegocio(params.get('de'), params.get('ate'));
    if (periodo.inicio) {
      condicoes.push('julianday(b.criado_em)>=julianday(?)');
      valores.push(periodo.inicio);
    }
    if (periodo.fim) {
      condicoes.push('julianday(b.criado_em)<julianday(?)');
      valores.push(periodo.fim);
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const total = Number(
      (
        await first<{ n: number }>(
          `SELECT COUNT(*) n FROM baixas_estoque b ${where}`,
          valores,
        )
      )?.n ?? 0,
    );
    const paginacao = paginaSolicitada(params),
      pageCount = Math.max(1, Math.ceil(total / paginacao.pageSize)),
      page = Math.min(paginacao.page, pageCount);
    const baixas = await all(
      `SELECT b.id,b.codigo,b.numero_os,b.estoque_id,b.placa,b.status,b.solicitante_id,b.atendente_id,b.motivo_recusa,b.criado_em,b.atualizado_em,b.revision,e.nome AS estoque${pode(user, 'baixa:ver_todas') ? ',u.name AS solicitante' : ''}
      FROM baixas_estoque b JOIN estoques e ON e.id=b.estoque_id JOIN users u ON u.id=b.solicitante_id ${where}
      ORDER BY b.atualizado_em DESC,b.id DESC LIMIT ? OFFSET ?`,
      [...valores, paginacao.pageSize, (page - 1) * paginacao.pageSize],
    );
    // Inclui estoques inativos usados nos pedidos visiveis, mesmo em outra
    // pagina. GET /estoques continua oferecendo apenas ativos ao solicitante.
    const estoques_com_pedidos = await all(
      `SELECT DISTINCT e.id,e.nome FROM estoques e JOIN baixas_estoque b ON b.estoque_id=e.id
      ${pode(user, 'baixa:ver_todas') ? '' : 'WHERE b.solicitante_id=?'} ORDER BY e.nome,e.id`,
      pode(user, 'baixa:ver_todas') ? [] : [user.id],
    );
    return ok({
      baixas,
      estoques_com_pedidos,
      total,
      page,
      pageCount,
      pageSize: paginacao.pageSize,
    });
  }
  async function detalhe(user: User, baixaId: string) {
    const baixa = await first<Baixa>(
      `SELECT b.id,b.codigo,b.numero_os,b.estoque_id,b.placa,b.status,b.solicitante_id,b.atendente_id,b.motivo_recusa,b.criado_em,b.atualizado_em,b.revision,e.nome AS estoque,u.name AS solicitante FROM baixas_estoque b JOIN estoques e ON e.id=b.estoque_id JOIN users u ON u.id=b.solicitante_id WHERE b.id=?`,
      [baixaId],
    );
    if (
      !baixa ||
      (baixa.solicitante_id !== user.id && !pode(user, 'baixa:ver_todas'))
    )
      return inexistente();
    const andamentos = await all(
      'SELECT a.id,a.baixa_id,a.user_id,a.de_status,a.para_status,a.texto,a.criado_em,u.name AS usuario FROM baixa_andamentos a JOIN users u ON u.id=a.user_id WHERE baixa_id=? ORDER BY a.criado_em,a.rowid',
      [baixaId],
    );
    return ok({ baixa, andamentos });
  }
  async function duplicada(os: string) {
    const existente = await first(
      "SELECT id,codigo,status FROM baixas_estoque WHERE numero_os=? AND status='aberta'",
      [os],
    );
    return existente
      ? ok(
          {
            error: `Já existe o pedido ${String(existente.codigo)} aguardando baixa para esta OS.`,
            existente,
          },
          { status: 409 },
        )
      : null;
  }
  async function criar(request: Request, user: User) {
    return comAcaoEscrita('baixa:abrir', async () => {
      const body = await jsonBody<Corpo>(request),
        chave = chaveIdempotencia(request),
        hash = chave ? await tokenHash(JSON.stringify(body)) : null;
      const repetida = async () => {
        const antiga = chave
          ? await first(
              'SELECT id,codigo,request_hash FROM baixas_estoque WHERE solicitante_id=? AND request_key=?',
              [user.id, chave],
            )
          : null;
        return antiga
          ? antiga.request_hash === hash
            ? ok({ id: antiga.id, codigo: antiga.codigo }, { status: 201 })
            : fail('Esta tentativa já foi usada com outros dados.', 409)
          : null;
      };
      const replay = await repetida();
      if (replay) return replay;
      const os = campo(body, 'numero_os', 20),
        estoque = campo(body, 'estoque_id', 100),
        placa = normalizarPlaca(campo(body, 'placa', 8));
      if (!/^\d{1,20}$/.test(os))
        return fail('Informe o número da OS com 1 a 20 dígitos.');
      if (!placa)
        return fail('Informe uma placa válida (AAA-9999 ou AAA9A99).');
      if (
        !(await first('SELECT id FROM estoques WHERE id=? AND ativo=1', [
          estoque,
        ]))
      )
        return fail('Selecione um estoque ativo.');
      const repeticao = await duplicada(os);
      if (repeticao) return repeticao;
      const registro = id('bxa'),
        evento = id('ban'),
        timestamp = now();
      const notificacoes = await avisos(
        registro,
        evento,
        user,
        null,
        'aberta',
        '',
        timestamp,
      );
      try {
        const resultados = await rawDb().batch([
          statement(
            `INSERT INTO baixas_estoque(id,numero_os,estoque_id,placa,solicitante_id,criado_em,atualizado_em,request_key,request_hash)
            SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM estoques WHERE id=? AND ativo=1)`,
            [
              registro,
              os,
              estoque,
              placa,
              user.id,
              timestamp,
              timestamp,
              chave,
              hash,
              estoque,
            ],
          ),
          statement(
            `INSERT INTO baixa_andamentos(id,baixa_id,user_id,para_status,texto,criado_em) SELECT ?,?,?,'aberta','Pedido de baixa aberto',? WHERE EXISTS(SELECT 1 FROM baixas_estoque WHERE id=?)`,
            [evento, registro, user.id, timestamp, registro],
          ),
          auditoria(
            user,
            'baixa_estoque',
            registro,
            'CREATE',
            'Pedido de baixa no estoque aberto',
            timestamp,
            'EXISTS(SELECT 1 FROM baixa_andamentos WHERE id=?)',
            [evento],
            "('Pedido de baixa no estoque aberto: ' || (SELECT codigo FROM baixas_estoque WHERE id=?) || '; OS ' || ?)",
            [registro, os],
          ),
          ...notificacoes,
        ]);
        if (!resultados[0].meta.changes)
          return fail(
            'O estoque foi desativado. Atualize e tente novamente.',
            409,
          );
      } catch (erro) {
        if (!ehErroUnique(erro)) throw erro;
        const resposta = (await repetida()) ?? (await duplicada(os));
        if (resposta) return resposta;
        throw erro;
      }
      const criada = await first(
        'SELECT codigo FROM baixas_estoque WHERE id=?',
        [registro],
      );
      return ok({ id: registro, codigo: criada!.codigo }, { status: 201 });
    });
  }
  async function transicionar(request: Request, user: User, baixaId: string) {
    return comAcaoEscrita('baixa:atender', async () => {
      if (!pode(user, 'baixa:atender'))
        return fail('Seu perfil não permite atender baixas.', 403);
      const body = await jsonBody<Corpo>(request),
        atual = await first<Baixa>('SELECT * FROM baixas_estoque WHERE id=?', [
          baixaId,
        ]);
      if (!atual) return inexistente();
      const chave = chaveIdempotencia(request),
        hash = chave ? await tokenHash(JSON.stringify(body)) : null;
      const repetida = async () => {
        const anterior = chave
          ? await first(
              'SELECT request_hash FROM baixa_andamentos WHERE baixa_id=? AND user_id=? AND request_key=?',
              [baixaId, user.id, chave],
            )
          : null;
        return anterior
          ? anterior.request_hash === hash
            ? ok({ success: true })
            : fail('Esta tentativa já foi usada com outros dados.', 409)
          : null;
      };
      const replay = await repetida();
      if (replay) return replay;
      if (!revisaoConfere(body.expectedRevision, atual.revision))
        return conflito();
      const para = campo(body, 'para', 30),
        texto = campo(body, 'texto', LIMITES_CAMPO.mensagem);
      if (atual.status !== 'aberta' || !['baixada', 'recusada'].includes(para))
        return fail('Transição de situação inválida.', 409);
      if (para === 'recusada' && !texto)
        return fail('Informe o motivo da recusa.');
      const mensagem = para === 'recusada' ? texto : '',
        timestamp = now(),
        evento = id('ban');
      const notificacoes = await avisos(
        baixaId,
        evento,
        user,
        atual,
        para,
        mensagem,
        timestamp,
      );
      const resultados = await rawDb().batch([
        statement(
          "UPDATE baixas_estoque SET status=?,atendente_id=?,motivo_recusa=?,atualizado_em=?,revision=revision+1 WHERE id=? AND revision=? AND status='aberta'",
          [para, user.id, mensagem || null, timestamp, baixaId, atual.revision],
        ),
        statement(
          'INSERT INTO baixa_andamentos(id,baixa_id,user_id,de_status,para_status,texto,criado_em,request_key,request_hash) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1',
          [
            evento,
            baixaId,
            user.id,
            atual.status,
            para,
            mensagem || null,
            timestamp,
            chave,
            hash,
          ],
        ),
        auditoria(
          user,
          'baixa_estoque',
          baixaId,
          'UPDATE',
          `${atual.codigo}: ${SITUACOES_BAIXA[para as keyof typeof SITUACOES_BAIXA]}${mensagem ? `; ${mensagem}` : ''}`,
          timestamp,
          'EXISTS(SELECT 1 FROM baixa_andamentos WHERE id=?)',
          [evento],
        ),
        ...notificacoes,
      ]);
      return resultados[0].meta.changes
        ? ok({ success: true, revision: atual.revision + 1 })
        : ((await repetida()) ?? conflito());
    });
  }
  async function listarEstoques(user: User) {
    return ok({
      estoques: await all(
        `SELECT * FROM estoques ${pode(user, 'estoque:gerenciar') ? '' : 'WHERE ativo=1'} ORDER BY nome,id`,
      ),
    });
  }
  async function gravarEstoque(
    request: Request,
    user: User,
    estoqueId?: string,
  ) {
    return comAcaoEscrita('estoque:gerenciar', async () => {
      if (!pode(user, 'estoque:gerenciar'))
        return fail('Seu perfil não permite gerenciar estoques.', 403);
      const body = await jsonBody<Corpo>(request),
        atual = estoqueId
          ? await first<{ nome: string; ativo: number; revision: number }>(
              'SELECT * FROM estoques WHERE id=?',
              [estoqueId],
            )
          : null;
      if (estoqueId && !atual) return fail('Estoque não encontrado.', 404);
      if (atual && !revisaoConfere(body.expectedRevision, atual.revision))
        return conflito();
      const nome =
        body.nome === undefined && atual
          ? atual.nome
          : campo(body, 'nome', LIMITES_CAMPO.nome);
      if (!nome) return fail('Informe o nome do estoque.');
      if (
        body.ativo !== undefined &&
        ![true, false, 0, 1].includes(body.ativo as boolean)
      )
        return fail('Situação do estoque inválida.');
      const ativo =
        body.ativo === undefined
          ? (atual?.ativo ?? 1)
          : body.ativo === true || body.ativo === 1
            ? 1
            : 0;
      const registro = estoqueId ?? id('est'),
        timestamp = now();
      try {
        const resultados = await rawDb().batch([
          atual
            ? statement(
                'UPDATE estoques SET nome=?,nome_chave=?,ativo=?,revision=revision+1 WHERE id=? AND revision=?',
                [
                  nome,
                  normalizeText(nome).normalize('NFC'),
                  ativo,
                  registro,
                  atual.revision,
                ],
              )
            : statement(
                'INSERT INTO estoques(id,nome,nome_chave,ativo) VALUES(?,?,?,?)',
                [registro, nome, normalizeText(nome).normalize('NFC'), ativo],
              ),
          auditoria(
            user,
            'estoque',
            registro,
            atual ? 'UPDATE' : 'CREATE',
            `Estoque: ${nome}; ativo: ${ativo}`,
            timestamp,
            'changes()=1',
          ),
        ]);
        if (!resultados[0].meta.changes) return conflito();
      } catch (erro) {
        if (ehErroUnique(erro))
          return fail('Já existe um estoque com esse nome.', 409);
        throw erro;
      }
      return ok(
        { id: registro, revision: atual ? atual.revision + 1 : 0 },
        { status: atual ? 200 : 201 },
      );
    });
  }
  return {
    listar,
    detalhe,
    criar,
    transicionar,
    listarEstoques,
    gravarEstoque,
  };
}
