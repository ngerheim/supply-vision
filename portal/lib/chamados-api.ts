import { RESERVAR_CODIGO_CHAMADO_SQL, filtroChamados, dadosBuscaChamado, ordemChamados } from './operacao-dados.ts';
import { paginaSolicitada } from './paginacao.ts';
import { fornecedorChamado, responsavelElegivel } from './chamados.ts';
import { chaveIdempotencia } from './limites-entrada.ts';
import { contextoNotificacaoChamado, pessoaNotificacao, prepararNotificacoesChamado, type ContextoNotificacaoChamado } from './fila-email-chamados.ts';
import { corpoBinarioLimitado } from './corpo-limitado.ts';
import { CORPO_MAX_JSON, LIMITES_CAMPO, exigeTexto } from './limites-entrada.ts';
import { errorMessage, isOneOf, isValidCnpj, isValidState, TICKET_PRIORITIES, TICKET_STATUSES } from './domain.ts';
import { type ContextoApi, type User, textValue, nullableText } from './api-compartilhada.ts';
import { revisaoConfere } from './controle-escrita.ts';

export function chamadosApi(contexto: ContextoApi) {
  const { id, now, rawDb, tokenHash, adquirirTrava, liberarTrava, normalizeCnpj, normalizeText, ok, fail, jsonBody, all, first } = contexto;

  type TicketInput = Record<string, unknown>;

  async function comTravaDoChamado(request: Request, ticketId: string, operacao: () => Promise<Response>) {
    const chave = `chamado:${ticketId}`, dono = id('lck');
    if (!await adquirirTrava(chave, dono)) {
      if (request.body) await corpoBinarioLimitado(request, CORPO_MAX_JSON);
      return fail('Outro usuário está alterando este chamado neste momento. Tente de novo em instantes.', 409);
    }
    try { return await operacao(); }
    finally {
      try { await liberarTrava(chave, dono); }
      catch (erro) { console.error('[portal] nao foi possivel liberar a trava do chamado:', erro); }
    }
  }

  async function ticketList(params: URLSearchParams){
    const {where,values}=filtroChamados(params);
    const ordem=ordemChamados(params);
    const {page:requestedPage,pageSize}=paginaSolicitada(params);
    const total=Number((await first<{n:number}>(`SELECT COUNT(*) n FROM tickets t ${where}`,values))?.n||0);
    const pageCount=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(requestedPage,pageCount);
    const tickets=await all(`SELECT t.id,t.code,t.supplier_name AS supplierName,t.cnpj,t.city,t.state,t.contact,t.scope,t.priority,t.status,
    t.created_at AS createdAt,t.updated_at AS updatedAt,t.closed_at AS closedAt,t.agreement_id AS agreementId,
    r.name AS requestedBy,a.name AS assignedTo,ag.number AS agreementNumber
    FROM tickets t LEFT JOIN users r ON r.id=t.requested_by LEFT JOIN users a ON a.id=t.assigned_to
    LEFT JOIN agreements ag ON ag.id=t.agreement_id ${where} ORDER BY ${ordem.sql} LIMIT ? OFFSET ?`,[...values,...ordem.values,pageSize,(page-1)*pageSize]);
    return {tickets,total,page,pageCount,pageSize};
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
    const requestKey=chaveIdempotencia(request);
    const requestHash=requestKey ? await tokenHash(JSON.stringify(body)) : null;
    const repetido=async()=>{
      if(!requestKey)return null;
      const anterior=await first<{id:string;code:string;request_hash:string}>('SELECT id,code,request_hash FROM tickets WHERE requested_by=? AND request_key=?',[user.id,requestKey]);
      if(!anterior)return null;
      if(anterior.request_hash!==requestHash)return fail('Esta tentativa já foi usada com outros dados. Confira o chamado criado antes de abrir outro.',409);
      return ok({id:anterior.id,code:anterior.code},{status:201});
    };
    const respostaAnterior=await repetido();
    if(respostaAnterior)return respostaAnterior;
    exigeTexto(body.supplierName,LIMITES_CAMPO.nome,'fornecedor');
    exigeTexto(body.contact,LIMITES_CAMPO.contato,'contato');
    exigeTexto(body.scope,LIMITES_CAMPO.escopo,'escopo');
    exigeTexto(body.notes,LIMITES_CAMPO.observacoes,'observações');
    exigeTexto(body.statusMessage,LIMITES_CAMPO.mensagem,'mensagem da situação');
    exigeTexto(body.city,LIMITES_CAMPO.cidade,'cidade');
    const supplierName=fornecedorChamado(body.supplierName), priority=body.priority ?? 'media';
    if(!isOneOf(priority,TICKET_PRIORITIES)) return fail('Prioridade inválida.');
    const ticketCnpj=body.cnpj ? normalizeCnpj(body.cnpj) : null;
    if(ticketCnpj && !isValidCnpj(ticketCnpj)) return fail('Informe um CNPJ válido.');
    const state=body.state ? normalizeText(body.state) : null;
    if(state && !isValidState(state)) return fail('Selecione uma UF brasileira válida.');
    const assignedTo=textValue(body.assignedTo) || null;
    if(assignedTo && !responsavelElegivel(await first('SELECT role,active FROM users WHERE id=?',[assignedTo]))) return fail('O responsável deve ser um usuário ativo com perfil editor ou administrador.',400);
    const responsavel=await pessoaNotificacao(assignedTo);

    // O codigo e sequencial e unico. Sob acesso simultaneo, duas pessoas podem
    // calcular o mesmo numero antes de qualquer uma gravar; por isso ha novas
    // tentativas ate encontrar um codigo livre, em vez de perder o chamado.
    for(let tentativa=0;tentativa<12;tentativa++){
      const reserva=await rawDb().prepare(RESERVAR_CODIGO_CHAMADO_SQL).first<{value:number}>();
      if(!reserva)throw new Error('Contador de chamados indisponível.');
      const proximo=reserva.value;
      const code=`SUP-${String(proximo).padStart(4,'0')}`;
      const ticketId=id('tck'), eventId=id('tev'), timestamp=now();
      try{
        const contexto:ContextoNotificacaoChamado={id:ticketId,codigo:code,fornecedor:supplierName,prioridade:String(priority),status:'aberto',solicitante:{id:user.id,nome:user.name,email:user.email},responsavel};
        const notificacoes=prepararNotificacoesChamado({eventId,anterior:null,atual:contexto,autor:user,alteracoes:['Chamado atribuído'],timestamp});
        const busca=dadosBuscaChamado({code,supplier_name:supplierName,city:body.city?normalizeText(body.city):null,state});
        await rawDb().batch([
          rawDb().prepare(`INSERT INTO tickets (id,code,supplier_name,cnpj,city,state,contact,scope,priority,status,requested_by,assigned_to,notes,created_at,updated_at,request_key,request_hash,search_text,supplier_sort) VALUES (?,?,?,?,?,?,?,?,?,'aberto',?,?,?,?,?,?,?,?,?)`)
            .bind(ticketId,code,supplierName,ticketCnpj,body.city?normalizeText(body.city):null,state,nullableText(body.contact),nullableText(body.scope),priority,user.id,assignedTo,nullableText(body.notes),timestamp,timestamp,requestKey,requestHash,busca.searchText,busca.supplierSort),
          rawDb().prepare(`INSERT INTO ticket_events (id,ticket_id,user_id,kind,to_status,message,created_at) VALUES (?,?,?,'created','aberto',?,?)`)
            .bind(eventId,ticketId,user.id,`Chamado aberto para ${supplierName}`,timestamp),
          rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)')
            .bind(id('aud'),user.id,'CREATE','ticket',ticketId,`Chamado ${code} aberto: ${supplierName}`,timestamp),
          ...notificacoes,
        ]);
        return ok({ id:ticketId, code },{status:201});
      }catch(error:unknown){
        if(!errorMessage(error).includes('UNIQUE')) throw error;
        const resposta=await repetido();
        if(resposta)return resposta;
        // Codigo tomado por outra pessoa no mesmo instante: tenta o proximo.
      }
    }
    return fail('Muitos chamados sendo abertos ao mesmo tempo. Tente novamente.',503);
  }

  async function updateTicket(request:Request,user:User,ticketId:string){
    const body=await jsonBody<TicketInput>(request);
    const current=await first<{id:string;code:string;supplier_name:string;cnpj:string|null;city:string|null;state:string|null;contact:string|null;scope:string|null;priority:string;status:string;requested_by:string|null;assigned_to:string|null;agreement_id:string|null;notes:string|null;closed_at:string|null;revision:number}>('SELECT * FROM tickets WHERE id=?',[ticketId]);
    if(!current) return fail('Chamado não encontrado.',404);
    if (!revisaoConfere(body.expectedRevision, current.revision)) return fail('Este chamado foi alterado ou a tela está desatualizada. Atualize o chamado antes de salvar novamente.',409);
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
    if(assignedTo && assignedTo!==current.assigned_to && !responsavelElegivel(await first('SELECT role,active FROM users WHERE id=?',[assignedTo]))) return fail('O responsável deve ser um usuário ativo com perfil editor ou administrador.',400);
    const supplierName=fornecedorChamado(body.supplierName === undefined ? current.supplier_name : body.supplierName);
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
    const busca=dadosBuscaChamado({code:current.code,supplier_name:supplierName,city,state:nextState});
    await rawDb().batch([
      rawDb().prepare(`UPDATE tickets SET supplier_name=?,cnpj=?,city=?,state=?,contact=?,scope=?,priority=?,status=?,assigned_to=?,agreement_id=?,notes=?,updated_at=?,closed_at=?,search_text=?,supplier_sort=?,revision=revision+1 WHERE id=?`)
        .bind(supplierName,nextCnpj,city,nextState,contact,scope,priority,status,assignedTo,agreementId,notes,timestamp,closedAt,busca.searchText,busca.supplierSort,ticketId),
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
    const mensagem=textValue(body.message);
    const requestKey=chaveIdempotencia(request);
    if(requestKey){
      const anterior=await first<{message:string}>('SELECT message FROM ticket_events WHERE ticket_id=? AND user_id=? AND request_key=?',[ticketId,user.id,requestKey]);
      if(anterior){
        if(anterior.message!==mensagem)return fail('Esta tentativa já foi usada com outro andamento. Atualize o chamado antes de tentar novamente.',409);
        return ok({success:true},{status:201});
      }
    }
    const timestamp=now();
    const ticket=await contextoNotificacaoChamado(ticketId);
    if(!ticket) return fail('Chamado não encontrado.',404);
    const eventId=id('tev');
    const notificacoes=prepararNotificacoesChamado({eventId,anterior:ticket,atual:ticket,mudanca:{andamentoAdicionado:true},autor:user,alteracoes:['Novo andamento'],mensagem,timestamp});
    await rawDb().batch([
      rawDb().prepare(`INSERT INTO ticket_events (id,ticket_id,user_id,kind,message,created_at,request_key) VALUES (?,?,?,'note',?,?,?)`).bind(eventId,ticketId,user.id,mensagem,timestamp,requestKey),
      rawDb().prepare('UPDATE tickets SET updated_at=?,revision=revision+1 WHERE id=?').bind(timestamp,ticketId),
      rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)').bind(id('aud'),user.id,'COMMENT','ticket',ticketId,`Andamento no chamado ${ticket.codigo}`,timestamp),
      ...notificacoes,
    ]);
    return ok({ success:true },{status:201});
  }

  return { comTravaDoChamado, ticketDetail, ticketList, ticketStats, createTicket, updateTicket, addTicketEvent };
}
