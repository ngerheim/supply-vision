import type { ContextoApi, User } from './api-compartilhada.ts';
import { ehErroUnique } from './api-compartilhada.ts';
import { pode } from './permissoes.ts';
import { comAcaoEscrita } from './autor-escrita.ts';
import { revisaoConfere } from './controle-escrita.ts';
import { chaveIdempotencia, EntradaInvalida } from './limites-entrada.ts';
import { prepararNotificacaoCondicional } from './central-notificacoes.ts';
import { pessoasAtivas } from './pessoas-permissoes.ts';
import { intervaloDatasNegocio } from './periodo-auditoria.ts';
import { paginaSolicitada } from './paginacao.ts';
import { createHash } from 'node:crypto';
import { ANEXOS_POR_ENVIO, ANEXOS_POR_PAGAMENTO, BYTES_POR_ANEXO, BYTES_POR_ENVIO, BYTES_POR_PAGAMENTO } from './pagamentos-schema.ts';

const STATUS=['aberta','em_analise','paga','recusada'];
type Corpo=Record<string,unknown>;
const statement=(ctx:ContextoApi,sql:string,valores:unknown[]=[])=>ctx.rawDb().prepare(sql).bind(...valores);
type PagamentoRow={id:string;codigo:string;status:string;solicitante_id:string;revision:number;request_hash:string;request_key:string;[key:string]:unknown};
type AnexoRow={nome_arquivo:string;mime:string;conteudo:Uint8Array};
type Anexo={tipo:'oc'|'nf';nome:string;bytes:Uint8Array;mime:string;sha:string};
const nomeSeguro=(s:string)=>s.replaceAll('/','_').replaceAll('\\','_').replaceAll('"','_').replace(/\p{Cc}/gu,'_').replace(/^\.+/,'').slice(0,120)||'anexo';
// Cabecalho HTTP so aceita Latin-1: um travessao ou apostrofo do Word no nome
// derrubava o download com erro 500. ASCII como reserva e o nome real em
// filename* (RFC 6266/5987).
const disposicaoAnexo=(nome:string)=>`attachment; filename="${nome.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(nome).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
function validarArquivo(file:File,tipo:'oc'|'nf') {
  if(!file.size||file.size>BYTES_POR_ANEXO)throw new EntradaInvalida('Cada anexo deve ter até 5 MB.');
  const nome=nomeSeguro(file.name);
  return file.arrayBuffer().then(buffer=>{
    const b=new Uint8Array(buffer),pdf=b.length>=5&&new TextDecoder().decode(b.slice(0,5))==='%PDF-',jpg=b[0]===0xff&&b[1]===0xd8&&b[2]===0xff,png=b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v);
    const xml=tipo==='nf'&&/^\s*(?:<\?xml\b|<)/i.test(new TextDecoder('utf-8',{fatal:false}).decode(b.slice(0,256)));
    if(!pdf&&!jpg&&!png&&!xml)throw new EntradaInvalida('Formato de anexo inválido. Use PDF, JPEG, PNG ou XML na nota fiscal.');
    const mime=pdf?'application/pdf':jpg?'image/jpeg':png?'image/png':'application/xml';
    return {tipo,nome,bytes:b,mime,sha:createHash('sha256').update(b).digest('hex')} as Anexo;
  });
}
// Arquivos dos campos 'oc' e 'nf' do formulario (cada campo pode repetir).
// Tamanho e quantidade sao conferidos antes de ler o conteudo.
async function lerAnexos(form:FormData,exigirAmbos:boolean):Promise<Anexo[]|{status:number;erro:string}>{
  const arquivos=(['oc','nf'] as const).flatMap(tipo=>form.getAll(tipo).map(v=>({tipo,v})));
  if(arquivos.some(a=>!(a.v instanceof File)))throw new EntradaInvalida('Anexo inválido.');
  const files=arquivos as {tipo:'oc'|'nf';v:File}[];
  if(exigirAmbos&&(!files.some(a=>a.tipo==='oc')||!files.some(a=>a.tipo==='nf')))throw new EntradaInvalida('Anexe a ordem de compra e a nota fiscal.');
  if(!files.length)throw new EntradaInvalida('Escolha pelo menos um arquivo.');
  if(files.length>ANEXOS_POR_ENVIO)throw new EntradaInvalida(`Envie no máximo ${ANEXOS_POR_ENVIO} arquivos de cada vez.`);
  if(files.some(a=>a.v.size>BYTES_POR_ANEXO))return {status:413,erro:'Cada anexo deve ter até 5 MB.'};
  if(files.reduce((t,a)=>t+a.v.size,0)>BYTES_POR_ENVIO)return {status:413,erro:'Os anexos excedem o limite total de 10 MB por envio.'};
  return Promise.all(files.map(a=>validarArquivo(a.v,a.tipo)));
}
export function pagamentosApi(ctx:ContextoApi){
  const {all,first,id,now,ok,fail,rawDb,tokenHash}=ctx;
  const ausente=()=>fail('Solicitação de pagamento não encontrada.',404);
  async function visivel(user:User,pagamentoId:string){const p=await first<PagamentoRow>('SELECT p.*,u.name solicitante FROM pagamentos p JOIN users u ON u.id=p.solicitante_id WHERE p.id=?',[pagamentoId]);return p&&(p.solicitante_id===user.id||pode(user,'pagamento:ver_todas'))?p:null;}
  async function listar(user:User,params:URLSearchParams){
    const where:string[]=[],values:unknown[]=[];if(!pode(user,'pagamento:ver_todas')){where.push('p.solicitante_id=?');values.push(user.id);}
    const status=params.get('status');if(status!==null){if(!STATUS.includes(status))throw new EntradaInvalida('Situação inválida.');where.push('p.status=?');values.push(status);}
    const periodo=intervaloDatasNegocio(params.get('de'),params.get('ate'));if(periodo.inicio){where.push('julianday(p.criado_em)>=julianday(?)');values.push(periodo.inicio);}if(periodo.fim){where.push('julianday(p.criado_em)<julianday(?)');values.push(periodo.fim);}
    const busca=params.get('busca');if(busca){if(busca.length>200)throw new EntradaInvalida('Busca inválida.');where.push('(p.codigo LIKE ? OR p.fornecedor LIKE ? OR p.numero_nf LIKE ? OR p.numero_oc LIKE ? OR p.link LIKE ? OR (SELECT name FROM users WHERE id=p.solicitante_id) LIKE ?)');values.push(...Array(6).fill(`%${busca}%`));}
    const w=where.length?`WHERE ${where.join(' AND ')}`:'';const total=Number((await first<PagamentoRow>(`SELECT COUNT(*) n FROM pagamentos p ${w}`,values))?.n||0),pg=paginaSolicitada(params),page=Math.min(pg.page,Math.max(1,Math.ceil(total/pg.pageSize)));
    const pagamentos=await all(`SELECT p.id,p.codigo,p.fornecedor,p.cnpj,p.numero_oc,p.numero_nf,p.valor_centavos,p.vencimento,p.link,p.observacao,p.status,p.motivo_recusa,p.solicitante_id,p.atendente_id,p.criado_em,p.atualizado_em,p.revision,(SELECT name FROM users WHERE id=p.solicitante_id) solicitante FROM pagamentos p ${w} ORDER BY p.atualizado_em DESC,p.id DESC LIMIT ? OFFSET ?`,[...values,pg.pageSize,(page-1)*pg.pageSize]);return ok({pagamentos,total,page,pageCount:Math.max(1,Math.ceil(total/pg.pageSize)),pageSize:pg.pageSize});
  }
  async function detalhe(user:User,pid:string){const pagamento=await visivel(user,pid);if(!pagamento)return ausente();const andamentos=await all('SELECT a.id,a.user_id,a.de_status,a.para_status,a.texto,a.criado_em,u.name usuario FROM pagamento_andamentos a JOIN users u ON u.id=a.user_id WHERE pagamento_id=? ORDER BY a.criado_em,a.rowid',[pid]);const anexos=await all('SELECT id,tipo,nome_arquivo,mime,tamanho,sha256,criado_em,user_id FROM pagamento_anexos WHERE pagamento_id=? ORDER BY tipo,criado_em,rowid',[pid]);const seguro=Object.fromEntries(Object.entries(pagamento).filter(([k])=>!['request_key','request_hash'].includes(k)));return ok({pagamento:seguro,andamentos,anexos});}
  async function download(user:User,pid:string,anexo:string){const p=await visivel(user,pid);if(!p)return ausente();
    // Pelo id do anexo; 'oc'/'nf' (telas antigas) baixam o primeiro daquele tipo.
    const a=['oc','nf'].includes(anexo)?await first<AnexoRow>('SELECT nome_arquivo,mime,conteudo FROM pagamento_anexos WHERE pagamento_id=? AND tipo=? ORDER BY criado_em,rowid LIMIT 1',[pid,anexo])
      :await first<AnexoRow>('SELECT nome_arquivo,mime,conteudo FROM pagamento_anexos WHERE pagamento_id=? AND id=?',[pid,anexo]);if(!a)return ausente();const conteudo=new Uint8Array(a.conteudo).buffer;return new ctx.NextResponse(conteudo,{status:200,headers:{'content-type':a.mime,'content-disposition':disposicaoAnexo(nomeSeguro(a.nome_arquivo)),'x-content-type-options':'nosniff','cache-control':'no-store'}});}
  async function criar(request:Request,user:User){return comAcaoEscrita('pagamento:abrir',async()=>{
    const form=await request.formData(),body:Corpo={link:form.get('link')};
    const anexos=await lerAnexos(form,true);if(!Array.isArray(anexos))return ctx.ok({error:anexos.erro},{status:anexos.status,headers:{connection:'close'}});
    const txt=(k:string,max:number,obrigatorio=false)=>{const v=body[k];if(typeof v!=='string'||v.trim().length>max||obrigatorio&&!v.trim())throw new EntradaInvalida(`Campo inválido: ${k}.`);return v.trim();};
    const linkIn=txt('link',500);if(!linkIn)throw new EntradaInvalida('Informe o link.');try{if(new URL(linkIn).protocol!=='https:')throw new Error();}catch{throw new EntradaInvalida('Informe um link HTTPS válido.');}
    const chave=chaveIdempotencia(request),hash=chave?await tokenHash(JSON.stringify({linkIn,files:anexos.map(a=>`${a.tipo}:${a.sha}`)})):null;
    if(chave){const old=await first<PagamentoRow>('SELECT id,codigo,request_hash FROM pagamentos WHERE solicitante_id=? AND request_key=?',[user.id,chave]);if(old)return old.request_hash===hash?ok({id:old.id,codigo:old.codigo},{status:201}):ctx.ok({error:'Esta tentativa já foi usada com outros dados.',codigo:'duplicado'},{status:409});}
    const pid=id('pag'),event=id('pan'),ts=now(),nots=await pessoasAtivas(all),statements:ReturnType<typeof statement>[]=[];
    statements.push(statement(ctx,`INSERT INTO pagamentos(id,link,solicitante_id,criado_em,atualizado_em,request_key,request_hash) VALUES(?,?,?,?,?,?,?)`,[pid,linkIn,user.id,ts,ts,chave,hash]));
    statements.push(statement(ctx,"INSERT INTO pagamento_andamentos(id,pagamento_id,user_id,para_status,texto,criado_em) VALUES(?,?,?,'aberta','Solicitação de pagamento aberta',?)",[event,pid,user.id,ts]));
    for(const a of anexos)statements.push(statement(ctx,'INSERT INTO pagamento_anexos(id,pagamento_id,tipo,nome_arquivo,mime,tamanho,sha256,conteudo,criado_em,user_id) VALUES(?,?,?,?,?,?,?,?,?,?)',[id('pax'),pid,a.tipo,a.nome,a.mime,a.bytes.length,a.sha,a.bytes,ts,user.id]));
    statements.push(statement(ctx,"INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) SELECT ?,?,'CREATE','pagamento',?,(SELECT codigo||': solicitação aberta' FROM pagamentos WHERE id=?),? WHERE EXISTS(SELECT 1 FROM pagamento_andamentos WHERE id=?)",[id('aud'),user.id,pid,pid,ts,event]));
    for(const p of nots.filter(p=>p.id!==user.id&&pode(p,'pagamento:atender'))){statements.push(prepararNotificacaoCondicional({tipo:'pagamento',texto:'Nova solicitação de pagamento',textoSql:"'Nova solicitação de pagamento ' || p.codigo",link:`/?aba=chamados&sub=pagamento&pagamento=${pid}`,timestamp:ts,origem:'pagamentos p',destinatarioSql:'?',valoresDestinatario:[p.id],condicao:'p.id=? AND EXISTS(SELECT 1 FROM pagamento_andamentos WHERE id=?) AND ? IN (SELECT role FROM users WHERE id=? AND active=1)',valores:[pid,event,p.role,p.id]}));}
    try{await rawDb().batch(statements);}catch(erro){if(!ehErroUnique(erro))throw erro;if(chave){const antiga=await first<PagamentoRow>('SELECT id,codigo,request_hash FROM pagamentos WHERE solicitante_id=? AND request_key=?',[user.id,chave]);if(antiga)return antiga.request_hash===hash?ok({id:antiga.id,codigo:antiga.codigo},{status:201}):ctx.ok({error:'Esta tentativa já foi usada com outros dados.',codigo:'duplicado'},{status:409});}throw erro;}const row=await first<PagamentoRow>('SELECT codigo FROM pagamentos WHERE id=?',[pid]);return ok({id:pid,codigo:row?.codigo},{status:201});
  });}
  async function transicionar(request:Request,user:User,pid:string){return comAcaoEscrita('pagamento:atender',async()=>{if(!pode(user,'pagamento:atender'))return fail('Seu perfil não permite atender solicitações.',403);const body=await ctx.jsonBody<Corpo>(request),atual=await first<PagamentoRow>('SELECT * FROM pagamentos WHERE id=?',[pid]);if(!atual)return ausente();const chave=chaveIdempotencia(request),hash=chave?await tokenHash(JSON.stringify(body)):null;if(chave){const antiga=await first<PagamentoRow>('SELECT request_hash FROM pagamento_andamentos WHERE pagamento_id=? AND user_id=? AND request_key=?',[pid,user.id,chave]);if(antiga)return antiga.request_hash===hash?ok({success:true}):ctx.ok({error:'Esta tentativa já foi usada com outros dados.',codigo:'duplicado'},{status:409});}if(!revisaoConfere(body.expectedRevision,atual.revision))return ctx.ok({error:'Registro alterado. Recarregue.',codigo:'revisao'},{status:409});const para=typeof body.para==='string'?body.para:'',texto=typeof body.texto==='string'?body.texto.trim():'';if(!((atual.status==='aberta'&&para==='em_analise')||(atual.status==='em_analise'&&['paga','recusada'].includes(para))))return ctx.ok({error:'Transição de situação inválida.',codigo:'status_invalido'},{status:409});if(para==='recusada'&&!texto)return fail('Informe o motivo da recusa.');if(texto.length>1000)throw new EntradaInvalida('Texto acima do limite.');const ts=now(),event=id('pan'),detail=(await pessoasAtivas(all,[atual.solicitante_id])).filter(p=>pode(p,'pagamento:abrir'));const stmts=[statement(ctx,'UPDATE pagamentos SET status=?,motivo_recusa=?,atendente_id=?,atualizado_em=?,revision=revision+1 WHERE id=? AND revision=?',[para,para==='recusada'?texto:null,user.id,ts,pid,atual.revision]),statement(ctx,'INSERT INTO pagamento_andamentos(id,pagamento_id,user_id,de_status,para_status,texto,criado_em,request_key,request_hash) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1',[event,pid,user.id,atual.status,para,texto||null,ts,chave,hash]),statement(ctx,"INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) SELECT ?,?,'UPDATE','pagamento',?,(SELECT codigo||': '||? FROM pagamentos WHERE id=?),? WHERE EXISTS(SELECT 1 FROM pagamento_andamentos WHERE id=?)",[id('aud'),user.id,pid,para,pid,ts,event])];if(detail[0])stmts.push(prepararNotificacaoCondicional({tipo:'pagamento',texto:'Atualização da solicitação de pagamento',textoSql:"p.codigo || ': ' || ?",link:`/?aba=chamados&sub=pagamento&pagamento=${pid}`,timestamp:ts,origem:'pagamentos p',destinatarioSql:'?',valoresDestinatario:[detail[0].id],condicao:'p.id=? AND EXISTS(SELECT 1 FROM pagamento_andamentos WHERE id=?) AND ? IN (SELECT role FROM users WHERE id=? AND active=1)',valoresTexto:[texto||para],valores:[pid,event,detail[0].role,detail[0].id]}));const r=await rawDb().batch(stmts);return r[0].meta.changes?ok({success:true,revision:atual.revision+1}):ctx.ok({error:'Registro alterado.',codigo:'revisao'},{status:409});});}
  // Mais arquivos depois de aberta: solicitante (com acesso a aba) ou quem atende,
  // so enquanto Aberta ou Em analise. Nada e apagado. O mesmo arquivo (tipo e
  // conteudo) ja anexado nao se repete, entao reenviar apos falha e seguro.
  async function adicionarAnexos(request:Request,user:User,pid:string){return comAcaoEscrita('pagamento:abrir',async()=>{
    const p=await visivel(user,pid);if(!p)return ausente();
    if(p.solicitante_id!==user.id&&!pode(user,'pagamento:atender'))return fail('Seu perfil não permite anexar arquivos a esta solicitação.',403);
    if(!['aberta','em_analise'].includes(p.status))return ctx.ok({error:'Só é possível anexar arquivos enquanto a solicitação está aberta ou em análise.',codigo:'status_invalido'},{status:409});
    const anexos=await lerAnexos(await request.formData(),false);if(!Array.isArray(anexos))return ctx.ok({error:anexos.erro},{status:anexos.status,headers:{connection:'close'}});
    const existentes=await all<{tipo:string;sha256:string;tamanho:number}>('SELECT tipo,sha256,tamanho FROM pagamento_anexos WHERE pagamento_id=?',[pid]);
    const ja=new Set(existentes.map(e=>`${e.tipo}:${e.sha256}`)),novos=anexos.filter((a,i)=>!ja.has(`${a.tipo}:${a.sha}`)&&anexos.findIndex(b=>b.tipo===a.tipo&&b.sha===a.sha)===i);
    if(!novos.length)return ok({success:true,incluidos:0});
    if(existentes.length+novos.length>ANEXOS_POR_PAGAMENTO)throw new EntradaInvalida(`A solicitação pode ter no máximo ${ANEXOS_POR_PAGAMENTO} anexos.`);
    if(existentes.reduce((t,e)=>t+Number(e.tamanho),0)+novos.reduce((t,a)=>t+a.bytes.length,0)>BYTES_POR_PAGAMENTO)return ctx.ok({error:'A solicitação passaria de 30 MB em anexos.'},{status:413});
    const ts=now(),nomes=novos.map(a=>`${a.tipo==='oc'?'OC':'NF'} ${a.nome}`).join(', ');
    // O UPDATE guardado pela revisao vem primeiro; as demais linhas so entram se
    // foi este pedido que o aplicou (mesma revisao nova e mesmo instante).
    const stmts=[statement(ctx,'UPDATE pagamentos SET atualizado_em=?,revision=revision+1 WHERE id=? AND revision=? AND status IN (\'aberta\',\'em_analise\')',[ts,pid,p.revision]),
      ...novos.map(a=>statement(ctx,'INSERT INTO pagamento_anexos(id,pagamento_id,tipo,nome_arquivo,mime,tamanho,sha256,conteudo,criado_em,user_id) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pagamentos WHERE id=? AND revision=? AND atualizado_em=?)',[id('pax'),pid,a.tipo,a.nome,a.mime,a.bytes.length,a.sha,a.bytes,ts,user.id,pid,p.revision+1,ts])),
      statement(ctx,"INSERT INTO pagamento_andamentos(id,pagamento_id,user_id,de_status,para_status,texto,criado_em) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pagamentos WHERE id=? AND revision=? AND atualizado_em=?)",[id('pan'),pid,user.id,p.status,p.status,`Anexos incluídos: ${nomes}`.slice(0,1000),ts,pid,p.revision+1,ts]),
      statement(ctx,"INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) SELECT ?,?,'UPDATE','pagamento',?,(SELECT codigo||': anexos incluídos ('||?||')' FROM pagamentos WHERE id=?),? WHERE EXISTS(SELECT 1 FROM pagamentos WHERE id=? AND revision=? AND atualizado_em=?)",[id('aud'),user.id,pid,nomes.slice(0,500),pid,ts,pid,p.revision+1,ts])];
    const r=await rawDb().batch(stmts);
    return r[0].meta.changes?ok({success:true,incluidos:novos.length},{status:201}):ctx.ok({error:'Registro alterado. Recarregue.',codigo:'revisao'},{status:409});
  });}
  return {listar,detalhe,download,criar,transicionar,adicionarAnexos};
}
