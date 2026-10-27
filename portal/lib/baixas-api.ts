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
import { normalizeImportText, normalizeText } from './domain.ts';
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
type ItemEntrada = { itemId: string; quantidade: number };
function itensEntrada(valor: unknown): ItemEntrada[] {
  if (!Array.isArray(valor) || valor.length < 1 || valor.length > 50)
    throw new EntradaInvalida('Informe de 1 a 50 itens.');
  const vistos = new Set<string>();
  return valor.map((item) => {
    if (!item || typeof item !== 'object') throw new EntradaInvalida('Item inválido.');
    const { itemId, quantidade } = item as Record<string, unknown>;
    if (typeof itemId !== 'string' || !itemId.trim() || itemId.length > 100 || vistos.has(itemId))
      throw new EntradaInvalida('Item ausente ou repetido.');
    vistos.add(itemId);
    if (typeof quantidade !== 'number' || !Number.isFinite(quantidade) || quantidade <= 0 || !Number.isSafeInteger(Math.round(quantidade*100)) || !/^\d+(?:\.\d{1,2})?$/.test(String(quantidade)))
      throw new EntradaInvalida('Quantidade deve ser positiva e ter até duas casas decimais.');
    return { itemId, quantidade };
  });
}
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
  const conflito = () => contexto.ok({ error: 'Este registro foi alterado. Recarregue antes de salvar novamente.', codigo: 'revisao' }, { status: 409 });
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
      `SELECT b.id,b.codigo,b.numero_os,b.estoque_id,b.placa,b.status,b.solicitante_id,b.atendente_id,b.motivo_recusa,b.criado_em,b.atualizado_em,b.revision,e.nome AS estoque${pode(user, 'baixa:ver_todas') ? ',u.name AS solicitante' : ''},
      (SELECT COUNT(*) FROM baixa_itens bi WHERE bi.baixa_id=b.id) AS itens_total,
      (SELECT COUNT(*) FROM baixa_itens bi WHERE bi.baixa_id=b.id AND bi.status='pendente') AS itens_pendentes,
      (SELECT COUNT(*) FROM baixa_itens bi WHERE bi.baixa_id=b.id AND bi.status='baixado') AS itens_baixados,
      (SELECT COUNT(*) FROM baixa_itens bi WHERE bi.baixa_id=b.id AND bi.status='recusado') AS itens_recusados
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
    const itens = await all('SELECT i.id,i.item_id,i.quantidade_centesimos/100.0 AS quantidade,i.status,i.motivo_recusa,i.atendido_em,c.descricao,c.unidade,u.name AS atendente FROM baixa_itens i JOIN itens_catalogo c ON c.id=i.item_id LEFT JOIN users u ON u.id=i.atendente_id WHERE i.baixa_id=? ORDER BY i.rowid',[baixaId]);
    return ok({ baixa, andamentos, itens });
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
        placa = normalizarPlaca(campo(body, 'placa', 8)),
        itens = itensEntrada(body.itens);
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
      const catalogo = await all<{id:string;descricao:string;unidade:string;ativo:number}>('SELECT id,descricao,unidade,ativo FROM itens_catalogo WHERE id IN ('+itens.map(()=>'?').join(',')+')',itens.map(i=>i.itemId));
      for (const item of itens) {
        const cat=catalogo.find(c=>c.id===item.itemId);
        if (!cat || !cat.ativo || item.itemId==='item_legado') return fail('Selecione apenas itens ativos do catálogo.');
        if (cat.unidade==='un' && !Number.isInteger(item.quantidade)) return fail('A quantidade de itens em unidade deve ser inteira.');
      }
      const repeticao = await duplicada(os);
      if (repeticao) return repeticao;
      const registro = id('bxa'),
        evento = id('ban'),
        timestamp = now();
      const descricaoItens=itens.map(item=>{const cat=catalogo.find(c=>c.id===item.itemId)!;return `${cat.descricao}: ${item.quantidade} ${cat.unidade}; pendente`;}).join(', ');
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
            SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM estoques WHERE id=? AND ativo=1) AND (SELECT COUNT(*) FROM itens_catalogo WHERE id IN (${itens.map(()=>'?').join(',')}) AND ativo=1)=?`,
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
              ...itens.map(item=>item.itemId),
              itens.length,
            ],
          ),
          statement(
            `INSERT INTO baixa_andamentos(id,baixa_id,user_id,para_status,texto,criado_em) SELECT ?,?,?,'aberta',?,? WHERE EXISTS(SELECT 1 FROM baixas_estoque WHERE id=?)`,
            [evento, registro, user.id, `Pedido de baixa aberto; ${descricaoItens}`, timestamp, registro],
          ),
          ...itens.map(item=>statement(`INSERT INTO baixa_itens(id,baixa_id,item_id,quantidade_centesimos,status,criado_em,atualizado_em) SELECT ?,?,?,?,'pendente',?,? WHERE EXISTS(SELECT 1 FROM baixas_estoque WHERE id=?) AND EXISTS(SELECT 1 FROM itens_catalogo WHERE id=? AND ativo=1)`,[id('bit'),registro,item.itemId,Math.round(item.quantidade*100),timestamp,timestamp,registro,item.itemId])),
          auditoria(
            user,
            'baixa_estoque',
            registro,
            'CREATE',
            `Pedido de baixa no estoque aberto; ${descricaoItens}`,
            timestamp,
            'EXISTS(SELECT 1 FROM baixa_andamentos WHERE id=?)',
            [evento],
            "('Pedido de baixa no estoque aberto: ' || (SELECT codigo FROM baixas_estoque WHERE id=?) || '; OS ' || ? || '; ' || ?)",
            [registro, os, descricaoItens],
          ),
          ...notificacoes,
        ]);
        if (!resultados[0].meta.changes)
          return fail(
            'O estoque ou um item foi desativado. Atualize e tente novamente.',
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
      const pendentes=await all<{id:string;descricao:string;unidade:string;quantidade_centesimos:number}>('SELECT bi.id,c.descricao,c.unidade,bi.quantidade_centesimos FROM baixa_itens bi JOIN itens_catalogo c ON c.id=bi.item_id WHERE bi.baixa_id=? AND bi.status=\'pendente\' ORDER BY bi.rowid',[baixaId]);
      if(!pendentes.length)return fail('Não há itens pendentes para atender.',409);
      const acao=para==='baixada'?'baixado':'recusado';
      const itens=pendentes.map(i=>({id:i.id,para:acao as 'baixado'|'recusado',motivo:para==='recusada'?texto:''}));
      return aplicarAtendimento(user,atual,itens,chave,hash);
    });
  }
  async function atenderItens(request:Request,user:User,baixaId:string){
    return comAcaoEscrita('baixa:atender',async()=>{
      if(!pode(user,'baixa:atender'))return fail('Seu perfil não permite atender baixas.',403);
      const body=await jsonBody<Corpo>(request),atual=await first<Baixa>('SELECT * FROM baixas_estoque WHERE id=?',[baixaId]);
      if(!atual)return inexistente();
      const chave=chaveIdempotencia(request),hash=chave?await tokenHash(JSON.stringify(body)):null;
      if(chave){const antiga=await first<{request_hash:string}>('SELECT request_hash FROM baixa_andamentos WHERE baixa_id=? AND user_id=? AND request_key=?',[baixaId,user.id,chave]);if(antiga)return antiga.request_hash===hash?ok({success:true}):fail('Esta tentativa já foi usada com outros dados.',409);}
      if(!revisaoConfere(body.expectedRevision,atual.revision))return conflito();
      if(atual.status!=='aberta')return fail('Baixa não está aberta.',409);
      if(!Array.isArray(body.itens)||body.itens.length<1||body.itens.length>50)return fail('Selecione de 1 a 50 itens.');
      const itens=body.itens.map((i)=>{if(!i||typeof i!=='object')throw new EntradaInvalida('Item inválido.');const x=i as Record<string,unknown>;if(typeof x.id!=='string'||!['baixado','recusado'].includes(String(x.para)))throw new EntradaInvalida('Item inválido.');return{id:x.id,para:x.para as 'baixado'|'recusado',motivo:(typeof x.motivo==='string'?x.motivo.trim():'')||(typeof body.texto==='string'?body.texto.trim():'')};});
      return aplicarAtendimento(user,atual,itens,chave,hash);
    });
  }
  async function aplicarAtendimento(user:User, atual:Baixa, itens:{id:string;para:'baixado'|'recusado';motivo:string}[], chave:string|null, hash:string|null) {
      const baixaId=atual.id;
      if(!itens.length||itens.length>50)return fail('Selecione de 1 a 50 itens pendentes.');
      if(itens.some(i=>!['baixado','recusado'].includes(i.para)))return fail('Situação de item inválida.');
      const unicos=new Set(itens.map(i=>i.id));if(unicos.size!==itens.length)return fail('Item repetido.');
      const registros=await all<{id:string;descricao:string;unidade:string;quantidade_centesimos:number;status:string}>('SELECT bi.id,c.descricao,c.unidade,bi.quantidade_centesimos,bi.status FROM baixa_itens bi JOIN itens_catalogo c ON c.id=bi.item_id WHERE bi.baixa_id=? AND bi.id IN ('+itens.map(()=>'?').join(',')+')',[baixaId,...itens.map(i=>i.id)]);
      if(registros.length!==itens.length||registros.some(i=>i.status!=='pendente'))return fail('Um ou mais itens já foram atendidos. Recarregue a baixa.',409);
      if(itens.some(i=>i.para==='recusado'&&!i.motivo.trim()))return fail('Informe o motivo da recusa de cada item.');
      const timestamp=now(),evento=id('ban'),baixados=itens.filter(i=>i.para==='baixado').length,recusados=itens.length-baixados;
      const textoResumo=`${baixados} ${baixados===1?'item baixado':'itens baixados'}, ${recusados} ${recusados===1?'recusado':'recusados'}`;
      const baixadosIds=itens.filter(i=>i.para==='baixado').map(i=>i.id),baixadosSql=baixadosIds.length?baixadosIds.map(()=>'?').join(','):'NULL';
      const statusNovo=await first<{status:string}>('SELECT CASE WHEN EXISTS(SELECT 1 FROM baixa_itens WHERE baixa_id=? AND status=\'pendente\' AND id NOT IN ('+itens.map(()=>'?').join(',')+')) THEN \'aberta\' WHEN EXISTS(SELECT 1 FROM baixa_itens WHERE baixa_id=? AND (status=\'baixado\' OR id IN ('+baixadosSql+'))) THEN \'baixada\' ELSE \'recusada\' END AS status',[baixaId,...itens.map(i=>i.id),baixaId,...baixadosIds]);
      const paraCabecalho=statusNovo?.status||'aberta';
      const motivosRecusa=itens.filter(i=>i.para==='recusado').map(i=>i.motivo).filter(Boolean).join('; ');
      const notificacoes = await avisos(
        baixaId,
        evento,
        user,
        atual,
        paraCabecalho,
        `${textoResumo}${motivosRecusa?`; ${motivosRecusa}`:''}`,
        timestamp,
      );
      const statements:ReturnType<typeof statement>[]=[];
      for(const item of itens){
        const reg=registros.find(r=>r.id===item.id)!;
        const motivo=item.motivo||null;
        statements.push(statement("UPDATE baixa_itens SET status=?,motivo_recusa=?,atendente_id=?,atendido_em=?,atualizado_em=?,revision=revision+1 WHERE id=? AND baixa_id=? AND status='pendente' AND EXISTS(SELECT 1 FROM baixas_estoque WHERE id=? AND revision=? AND status='aberta')",[item.para,motivo,user.id,timestamp,timestamp,item.id,baixaId,baixaId,atual.revision]));
        statements.push(statement('INSERT INTO baixa_andamentos(id,baixa_id,user_id,de_status,para_status,texto,criado_em) SELECT ?,?,?,\'pendente\',?,?,? WHERE changes()=1',[id('ban'),baixaId,user.id,item.para,`${reg.descricao}: ${reg.quantidade_centesimos/100} ${reg.unidade}; ${item.para}${motivo?`; ${motivo}`:''}`,timestamp]));
      }
      statements.push(
        statement(
          "UPDATE baixas_estoque SET status=CASE WHEN EXISTS(SELECT 1 FROM baixa_itens WHERE baixa_id=? AND status='pendente' AND id NOT IN ("+itens.map(()=>'?').join(',')+")) THEN 'aberta' WHEN EXISTS(SELECT 1 FROM baixa_itens WHERE baixa_id=? AND (status='baixado' OR id IN ("+baixadosSql+"))) THEN 'baixada' ELSE 'recusada' END,atendente_id=?,motivo_recusa=CASE WHEN EXISTS(SELECT 1 FROM baixa_itens WHERE baixa_id=? AND status='pendente' AND id NOT IN ("+itens.map(()=>'?').join(',')+")) THEN NULL ELSE ? END,atualizado_em=?,revision=revision+1 WHERE id=? AND revision=? AND status='aberta'",
          [baixaId,...itens.map(i=>i.id),baixaId,...baixadosIds,user.id,baixaId,...itens.map(i=>i.id),motivosRecusa||null,timestamp,baixaId,atual.revision],
        ),
        statement(
          'INSERT INTO baixa_andamentos(id,baixa_id,user_id,de_status,para_status,texto,criado_em,request_key,request_hash) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1',
          [
            evento,
            baixaId,
            user.id,
            atual.status,
            paraCabecalho,
            textoResumo,
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
          `${atual.codigo}: ${textoResumo}; ${registros.map(i=>{const acao=itens.find(x=>x.id===i.id)!;return `${i.descricao} ${i.quantidade_centesimos/100} ${i.unidade}: ${acao.para}${acao.motivo?`; ${acao.motivo}`:''}`;}).join(', ')}`,
          timestamp,
          'EXISTS(SELECT 1 FROM baixa_andamentos WHERE id=?)',
          [evento],
        ),
        ...notificacoes,
      );
      const resultados = await rawDb().batch(statements);
      const alteracoes=resultados.filter((r,index)=>index%2===0&&index<itens.length*2).every(r=>r.meta.changes===1);
      return alteracoes && resultados[itens.length*2].meta.changes
        ? ok({ success: true, revision: atual.revision + 1 })
        : conflito();
  }
  async function editarItens(request:Request,user:User,baixaId:string){
    return comAcaoEscrita('baixa:abrir',async()=>{
      const body=await jsonBody<Corpo>(request),atual=await first<Baixa>('SELECT * FROM baixas_estoque WHERE id=?',[baixaId]);
      if(!atual||(atual.solicitante_id!==user.id&&!pode(user,'baixa:ver_todas')))return inexistente();
      if(atual.solicitante_id!==user.id)return fail('Somente o solicitante pode editar os itens.',403);
      const chave=chaveIdempotencia(request),hash=chave?await tokenHash(JSON.stringify(body)):null;
      if(chave){const antiga=await first<{request_hash:string}>('SELECT request_hash FROM baixa_andamentos WHERE baixa_id=? AND user_id=? AND request_key=?',[baixaId,user.id,chave]);if(antiga)return antiga.request_hash===hash?ok({success:true}):fail('Esta tentativa já foi usada com outros dados.',409);}
      if(atual.status!=='aberta')return fail('A baixa não está aberta.',409);
      if(!revisaoConfere(body.expectedRevision,atual.revision))return conflito();
      const itens=itensEntrada(body.itens),catalogo=await all<{id:string;descricao:string;unidade:string;ativo:number}>('SELECT id,descricao,unidade,ativo FROM itens_catalogo WHERE id IN ('+itens.map(()=>'?').join(',')+')',itens.map(i=>i.itemId));
      for(const item of itens){const cat=catalogo.find(c=>c.id===item.itemId);if(!cat||!cat.ativo||item.itemId==='item_legado')return fail('Selecione apenas itens ativos do catálogo.');if(cat.unidade==='un'&&!Number.isInteger(item.quantidade))return fail('A quantidade de itens em unidade deve ser inteira.');}
      const travados=await all<{item_id:string}>('SELECT item_id FROM baixa_itens WHERE baixa_id=? AND status<>\'pendente\'',[baixaId]);
      if(itens.some(i=>travados.some(t=>t.item_id===i.itemId)))return fail('Itens atendidos não podem ser alterados.',409);
      const descricaoItens=itens.map(item=>{const cat=catalogo.find(c=>c.id===item.itemId)!;return `${cat.descricao}: ${item.quantidade} ${cat.unidade}; pendente`;}).join(', '),timestamp=now(),evento=id('ban'),notificacoes=await avisos(baixaId,evento,user,atual,'aberta','Itens atualizados',timestamp),statements=[statement("DELETE FROM baixa_itens WHERE baixa_id=? AND status='pendente' AND EXISTS(SELECT 1 FROM baixas_estoque WHERE id=? AND revision=? AND status='aberta')",[baixaId,baixaId,atual.revision]),...itens.map(item=>statement("INSERT INTO baixa_itens(id,baixa_id,item_id,quantidade_centesimos,status,criado_em,atualizado_em) SELECT ?,?,?,?,'pendente',?,? WHERE EXISTS(SELECT 1 FROM baixas_estoque WHERE id=? AND revision=? AND status='aberta')",[id('bit'),baixaId,item.itemId,Math.round(item.quantidade*100),timestamp,timestamp,baixaId,atual.revision])),statement('UPDATE baixas_estoque SET atualizado_em=?,revision=revision+1 WHERE id=? AND revision=? AND status=\'aberta\'',[timestamp,baixaId,atual.revision]),statement('INSERT INTO baixa_andamentos(id,baixa_id,user_id,de_status,para_status,texto,criado_em,request_key,request_hash) SELECT ?,?,?,\'aberta\',\'aberta\',?,?,?,? WHERE changes()=1',[evento,baixaId,user.id,`Itens atualizados; ${descricaoItens}`,timestamp,chave,hash]),auditoria(user,'baixa_estoque',baixaId,'UPDATE',`${atual.codigo}: itens atualizados; ${descricaoItens}`,timestamp,'EXISTS(SELECT 1 FROM baixa_andamentos WHERE id=?)',[evento]),...notificacoes];
      const resultado=await rawDb().batch(statements);return resultado[1+itens.length].meta.changes?ok({success:true,revision:atual.revision+1}):conflito();
    });
  }
  async function listarEstoques(user: User) {
    return ok({
      estoques: await all(
        `SELECT * FROM estoques ${pode(user, 'estoque:gerenciar') ? '' : 'WHERE ativo=1'} ORDER BY nome,id`,
      ),
    });
  }
  async function listarItens(user: User, params: URLSearchParams) {
    const q = normalizeImportText(params.get('q') || ''), somenteAtivos=params.get('ativos')==='1', itens=await all(
      `SELECT id,descricao,unidade,ativo,revision FROM itens_catalogo WHERE id<>'item_legado' ${(pode(user,'estoque:gerenciar')&&!somenteAtivos) ? '' : 'AND ativo=1'} ORDER BY descricao,id`,
    );
    return ok({itens:q?itens.filter(item=>normalizeImportText(item.descricao).includes(q)):itens});
  }
  async function gravarItem(request: Request, user: User, itemId?: string) {
    return comAcaoEscrita('estoque:gerenciar', async () => {
      if (!pode(user,'estoque:gerenciar')) return fail('Seu perfil não permite gerenciar itens.',403);
      const body = await jsonBody<Corpo>(request);
      if (itemId === 'item_legado') return fail('O item legado é protegido e não pode ser editado.',409);
      const atual = itemId ? await first<{descricao:string;unidade:string;ativo:number;revision:number}>('SELECT * FROM itens_catalogo WHERE id=?',[itemId]) : null;
      if (itemId && !atual) return fail('Item não encontrado.',404);
      if (atual && !revisaoConfere(body.expectedRevision,atual.revision)) return contexto.ok({error:'Este registro foi alterado. Recarregue antes de salvar novamente.',codigo:'revisao'},{status:409});
      const descricao = body.descricao === undefined && atual ? atual.descricao : campo(body,'descricao',120),
        unidade = body.unidade === undefined && atual ? atual.unidade : campo(body,'unidade',2),
        chave = chaveIdempotencia(request), hash = chave ? await tokenHash(JSON.stringify(body)) : null;
      if (!descricao) return fail('Informe a descrição do item.');
      if (!['un','L','m','kg'].includes(unidade)) return fail('Unidade inválida.');
      if (body.ativo !== undefined && ![true,false,0,1].includes(body.ativo as boolean|number)) return fail('Situação do item inválida.');
      const ativo = body.ativo === undefined ? (atual?.ativo ?? 1) : (body.ativo === true || body.ativo === 1 ? 1 : 0), registro=itemId??id('itm'), timestamp=now();
      if (!atual && chave) {
        const antiga=await first<{request_hash:string;item_id:string}>('SELECT request_hash,item_id FROM itens_catalogo_tentativas WHERE user_id=? AND request_key=?',[user.id,chave]);
        if (antiga) return antiga.request_hash===hash ? ok({id:antiga.item_id,revision:0},{status:201}) : contexto.ok({error:'Esta tentativa já foi usada com outros dados.',codigo:'idempotencia'},{status:409});
      }
      try {
        const statements = [
          atual ? statement('UPDATE itens_catalogo SET descricao=?,descricao_chave=?,unidade=?,ativo=?,revision=revision+1 WHERE id=? AND revision=?',[descricao,normalizeText(descricao).normalize('NFC'),unidade,ativo,registro,atual.revision]) : statement('INSERT INTO itens_catalogo(id,descricao,descricao_chave,unidade,ativo) VALUES(?,?,?,?,?)',[registro,descricao,normalizeText(descricao).normalize('NFC'),unidade,ativo]),
          auditoria(user,'item_catalogo',registro,atual?'UPDATE':'CREATE',`Item: ${descricao}; unidade: ${unidade}; ativo: ${ativo}`,timestamp,'changes()=1'),
        ];
        if (!atual && chave) statements.push(statement('INSERT INTO itens_catalogo_tentativas(user_id,request_key,request_hash,item_id,criado_em) SELECT ?,?,?,?,? WHERE changes()=1',[user.id,chave,hash,registro,timestamp]));
        const results=await rawDb().batch(statements);
        if (!results[0].meta.changes) return contexto.ok({error:'Este registro foi alterado. Recarregue antes de salvar novamente.',codigo:'revisao'},{status:409});
      } catch (erro) { if (ehErroUnique(erro)) return contexto.ok({error:'Já existe um item com essa descrição.',codigo:'duplicado'},{status:409}); throw erro; }
      return ok({id:registro,revision:atual?atual.revision+1:0},{status:atual?200:201});
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
    atenderItens,
    editarItens,
    listarEstoques,
    gravarEstoque,
    listarItens,
    gravarItem,
  };
}
