import { validacaoAtiva } from './operacao-validacao.mjs';
import { abrirBancoLocal } from './banco-local.mjs';
import { travarRestauracao } from './trava-restauracao.mjs';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { montarEmailChamado, proximaTentativa } from '../lib/email-chamados.ts';
import { montarEmailRelatorioDiario } from '../lib/email-relatorio-diario.ts';
import { criarTransportador, lerConfig, portalPrivado } from './configuracao.mjs';
export { criarTransportador, lerConfig } from './configuracao.mjs';

const arquivoLog = path.join(portalPrivado, 'logs', 'portal-email.log');
const observar = process.argv.includes('--watch');
const testarConexao = process.argv.includes('--test-connection');
const indiceBanco = process.argv.indexOf('--database');
const bancoInformado = indiceBanco >= 0 && process.argv[indiceBanco + 1] ? path.resolve(process.argv[indiceBanco + 1]) : null;
const maxTentativas = 5;

// Falha ao gravar o log nunca pode desfazer um envio ja feito: se o erro
// subisse, o item seria marcado como falho e reenviado.
function registrar(texto) {
  const linha = `${new Date().toISOString()}  ${texto}`;
  console.log(linha);
  try {
    fs.appendFileSync(arquivoLog, `${linha}\n`, 'utf8');
    const linhas = fs.readFileSync(arquivoLog, 'utf8').split(/\r?\n/);
    if (linhas.length > 501) fs.writeFileSync(arquivoLog, `${linhas.slice(-500).join('\n')}\n`, 'utf8');
  } catch (erro) {
    console.error(`Nao foi possivel gravar o log: ${erro instanceof Error ? erro.message : 'erro desconhecido'}.`);
  }
}

export const MENSAGEM_INTERROMPIDO = 'Envio interrompido: resultado incerto. Confira com o destinatario antes de reenviar.';

// So repete automaticamente quando o SMTP comprovadamente nao aceitou DATA.
export function falhaAntesEntrega(erro) {
  if (!erro || typeof erro !== 'object') return false;
  if (Number(erro.responseCode) >= 400 && Number(erro.responseCode) <= 599) return true;
  return ['CONN','AUTH','MAIL FROM','RCPT TO'].includes(erro.command) && ['ECONNECTION','EDNS','EAUTH','EENVELOPE','ETIMEDOUT','ESOCKET'].includes(erro.code);
}

export const MENSAGEM_NAO_CONFIRMADO = 'Enviado, mas não confirmado no banco. Confira com o destinatário antes de reenviar.';

// Depois que o SMTP aceitou a mensagem, nenhuma falha pode leva-la de volta
// para 'pending': isso reenviaria o e-mail. A confirmacao e tentada algumas
// vezes; se o banco continuar recusando, o item vira 'failed' com mensagem
// explicita (o reenvio na tela e manual). Se nem isso gravar, o item fica em
// 'processing'. Ao expirar, exige revisao: nao e seguro presumir que nao enviou.
export async function confirmarEnvio(item, { concluir: confirmar, naoConfirmado, esperas = [200, 1000, 3000] }) {
  for (let tentativa = 0; ; tentativa++) {
    try { confirmar(); return true; }
    catch (erro) {
      if (tentativa >= esperas.length) {
        try { naoConfirmado(); registrar(`${item.id} enviado, mas sem confirmacao no banco (${erro instanceof Error ? erro.message : 'erro desconhecido'}); marcado para revisao.`); }
        catch (erroFinal) { registrar(`${item.id} enviado, mas o banco nao aceitou nem a confirmacao nem a marcacao (${erroFinal instanceof Error ? erroFinal.message : 'erro desconhecido'}); a reserva expirada exigira revisao antes de reenviar.`); }
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, esperas[tentativa]));
    }
  }
}

function marcarNaoConfirmado(db, tabela, item) {
  const agora = new Date().toISOString();
  db.prepare(`UPDATE ${tabela} SET status='failed',locked_at=NULL,last_error=?,updated_at=? WHERE id=? AND status='processing' AND attempts=? AND locked_at=?`)
    .run(MENSAGEM_NAO_CONFIRMADO, agora, item.id, item.attempts, item.locked_at);
}

const abrirBanco = () => abrirBancoLocal('email_notifications', bancoInformado);

function temTrabalho(db, tabela, agoraIso, travaVencida) {
  return !!db.prepare(`SELECT 1 FROM ${tabela} WHERE (status='processing' AND (locked_at<? OR locked_at IS NULL)) OR (status='pending' AND (attempts>=? OR next_attempt_at<=?)) LIMIT 1`)
    .get(travaVencida, maxTentativas, agoraIso);
}

export function reservar(db, limite = 10) {
  const agora = new Date();
  const agoraIso = agora.toISOString();
  const travaVencida = new Date(agora.getTime() - 10 * 60_000).toISOString();
  // So abre a transacao de escrita se houver algo a fazer: o processador roda
  // a cada 30 s e escrever sem necessidade disputa o banco com o portal.
  if (!temTrabalho(db, 'email_notifications', agoraIso, travaVencida)) return [];
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE email_notifications SET status='failed',locked_at=NULL,last_error=?,updated_at=? WHERE status='processing' AND (locked_at<? OR locked_at IS NULL)")
      .run(MENSAGEM_INTERROMPIDO, agoraIso, travaVencida);
    db.prepare("UPDATE email_notifications SET status='failed',locked_at=NULL,last_error=COALESCE(last_error,'Envio interrompido no limite de tentativas.'),updated_at=? WHERE status='pending' AND attempts>=?").run(agoraIso,maxTentativas);
    const candidatas = db.prepare("SELECT id FROM email_notifications WHERE status='pending' AND attempts<? AND next_attempt_at<=? ORDER BY created_at LIMIT ?")
      .all(maxTentativas, agoraIso, limite);
    const reservada = db.prepare("UPDATE email_notifications SET status='processing',attempts=attempts+1,locked_at=?,updated_at=? WHERE id=? AND status='pending'");
    const idsReservados = [];
    for (const item of candidatas) if (reservada.run(agoraIso, agoraIso, item.id).changes === 1) idsReservados.push(item.id);
    db.exec('COMMIT');
    if (!idsReservados.length) return [];
    const marcadores = idsReservados.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM email_notifications WHERE id IN (${marcadores}) AND status='processing'`).all(...idsReservados);
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}

export function concluir(db, item) {
  const agora = new Date().toISOString();
  db.prepare("UPDATE email_notifications SET status='sent',sent_at=?,locked_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='processing' AND attempts=? AND locked_at=?")
    .run(agora, agora, item.id, item.attempts, item.locked_at);
}

export function falhar(db, item, erro) {
  const agora = new Date();
  const definitivo = Number(item.attempts) >= maxTentativas || !falhaAntesEntrega(erro);
  const mensagem = (!falhaAntesEntrega(erro) ? MENSAGEM_INTERROMPIDO + ' ' : '') + (erro instanceof Error ? erro.message : 'Falha SMTP').replace(/[\r\n]+/g, ' ').slice(0, 500);
  db.prepare("UPDATE email_notifications SET status=?,next_attempt_at=?,locked_at=NULL,last_error=?,updated_at=? WHERE id=? AND status='processing' AND attempts=? AND locked_at=?")
    .run(definitivo ? 'failed' : 'pending', proximaTentativa(Number(item.attempts), agora), mensagem, agora.toISOString(), item.id, item.attempts, item.locked_at);
}

export const MENSAGEM_RESTAURACAO = 'Banco restaurado: confirme o reenvio.';

// Depois de restaurar um backup, o que estava pendente ou em envio na copia
// pode ja ter saido antes da restauracao. Em vez de reenviar sozinho, fica
// como falha explicita para o administrador decidir o reenvio.
export function marcarFilasAposRestauracao(db) {
  const agora = new Date().toISOString();
  const tabelas = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((linha) => linha.name));
  let total = 0;
  for (const tabela of ['email_notifications', 'daily_report_deliveries']) {
    if (!tabelas.has(tabela)) continue;
    total += Number(db.prepare(`UPDATE ${tabela} SET status='failed',locked_at=NULL,last_error=?,updated_at=? WHERE status IN ('pending','processing')`).run(MENSAGEM_RESTAURACAO, agora).changes);
  }
  return total;
}

function horarioSaoPaulo(data=new Date()){
  const partes=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(data).filter((p)=>p.type!=='literal').map((p)=>[p.type,p.value]));
  return {data:`${partes.year}-${partes.month}-${partes.day}`,horario:`${partes.hour}:${partes.minute}`};
}

const inicioDoDia=(data)=>`${data}T03:00:00.000Z`;
const fimLegado=(data,agora)=>new Date(Math.min(agora.getTime(),Date.parse(inicioDoDia(data))+24*60*60_000)).toISOString();

// O portal cria as colunas na inicializacao, mas este processo pode rodar
// antes dele numa base antiga.
function garantirPeriodoRelatorio(db){
  const colunas=new Set(db.prepare('PRAGMA table_info(daily_report_deliveries)').all().map((c)=>c.name));
  for(const coluna of ['period_start','period_end'])if(!colunas.has(coluna)){
    try{db.exec(`ALTER TABLE daily_report_deliveries ADD COLUMN ${coluna} TEXT`)}
    catch(erro){if(!String(erro?.message||'').toLowerCase().includes('duplicate column'))throw erro}
  }
}

// Cada relatorio cobre do fim do anterior (enviado ou nao) ate a preparacao
// deste. Antes cobria so o dia D ate o horario do envio, e o que acontecia
// depois disso nunca era relatado.
export function prepararRelatoriosDiarios(db,agora=new Date()){
  garantirPeriodoRelatorio(db);
  const local=horarioSaoPaulo(agora),agoraIso=agora.toISOString();
  const usuarios=db.prepare("SELECT id FROM users u WHERE active=1 AND role IN ('admin','editor') AND daily_report_enabled=1 AND daily_report_time<=? AND NOT EXISTS (SELECT 1 FROM daily_report_deliveries d WHERE d.user_id=u.id AND d.report_date=?)").all(local.horario,local.data);
  const ultimo=db.prepare("SELECT report_date,period_end,sent_at,created_at FROM daily_report_deliveries WHERE user_id=? AND report_date<? ORDER BY report_date DESC LIMIT 1");
  const inserir=db.prepare("INSERT OR IGNORE INTO daily_report_deliveries (id,user_id,report_date,status,attempts,next_attempt_at,created_at,updated_at,period_start,period_end) VALUES (?,?,?,'pending',0,?,?,?,?,?)");
  for(const usuario of usuarios){
    const anterior=ultimo.get(usuario.id,local.data);
    // Linha antiga sem periodo: cobria o dia ate o envio (ou a preparacao).
    let inicio=anterior?(anterior.period_end||fimLegado(anterior.report_date,new Date(anterior.sent_at||anterior.created_at))):inicioDoDia(local.data);
    if(inicio>agoraIso)inicio=agoraIso;
    inserir.run(`rpt_${crypto.randomUUID().replaceAll('-','')}`,usuario.id,local.data,agoraIso,agoraIso,agoraIso,inicio,agoraIso);
  }
  return local.data;
}

export function reservarRelatoriosDiarios(db,agora=new Date()){
  const agoraIso=agora.toISOString(),travaVencida=new Date(agora.getTime()-10*60_000).toISOString();
  if(!temTrabalho(db,'daily_report_deliveries',agoraIso,travaVencida))return [];
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare("UPDATE daily_report_deliveries SET status='failed',locked_at=NULL,last_error=?,updated_at=? WHERE status='processing' AND (locked_at<? OR locked_at IS NULL)").run(MENSAGEM_INTERROMPIDO,agoraIso,travaVencida);
    db.prepare("UPDATE daily_report_deliveries SET status='failed',locked_at=NULL,last_error=COALESCE(last_error,'Envio interrompido no limite de tentativas.'),updated_at=? WHERE status='pending' AND attempts>=?").run(agoraIso,maxTentativas);
    db.prepare("UPDATE daily_report_deliveries SET status='failed',locked_at=NULL,last_error='Permissão de relatório revogada.',updated_at=? WHERE status IN ('pending','processing') AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=user_id AND u.active=1 AND u.role IN ('admin','editor') AND u.daily_report_enabled=1)").run(agoraIso);
    const itens=db.prepare("SELECT d.*,u.name recipient_name,u.email recipient_email FROM daily_report_deliveries d JOIN users u ON u.id=d.user_id WHERE d.status='pending' AND d.attempts<? AND d.next_attempt_at<=? AND u.active=1 AND u.role IN ('admin','editor') AND u.daily_report_enabled=1 ORDER BY d.created_at LIMIT 1").all(maxTentativas,agoraIso);
    const reservar=db.prepare("UPDATE daily_report_deliveries SET status='processing',attempts=attempts+1,locked_at=?,updated_at=? WHERE id=? AND status='pending'");
    const escolhidos=[];
    for(const item of itens)if(reservar.run(agoraIso,agoraIso,item.id).changes===1)escolhidos.push({...item,attempts:Number(item.attempts)+1,locked_at:agoraIso});
    db.exec('COMMIT');return escolhidos;
  }catch(erro){db.exec('ROLLBACK');throw erro}
}

export function dadosRelatorioDiario(db,dataRelatorio,agora=new Date(),periodo=null){
  // Periodo gravado na entrega (tentativas repetidas usam o mesmo); linhas
  // antigas sem periodo usam o dia ate agora.
  const inicio=periodo?.inicio||inicioDoDia(dataRelatorio);
  const fim=periodo?.fim||fimLegado(dataRelatorio,agora);
  const totais=db.prepare(`SELECT SUM(status='aberto') aberto,SUM(status='aguardando_fornecedor') aguardando,SUM(status='fechado') fechado,SUM(status='cancelado') cancelado FROM tickets`).get();
  const chamados=db.prepare("SELECT id,code codigo,supplier_name fornecedor,status situacao FROM tickets WHERE (created_at>=? AND created_at<?) OR EXISTS (SELECT 1 FROM ticket_events e WHERE e.ticket_id=tickets.id AND e.created_at>=? AND e.created_at<?) ORDER BY updated_at DESC").all(inicio,fim,inicio,fim);
  const eventos=db.prepare("SELECT e.kind,e.from_status,e.to_status,e.message,e.created_at,u.name autor FROM ticket_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.ticket_id=? AND e.created_at>=? AND e.created_at<? ORDER BY e.created_at");
  const nomesSituacao={aberto:'Aberto',aguardando_fornecedor:'Aguardando fornecedor',fechado:'Fechado',cancelado:'Cancelado'};
  return {periodo:{inicio,fim},totais:{aberto:Number(totais.aberto||0),aguardando:Number(totais.aguardando||0),fechado:Number(totais.fechado||0),cancelado:Number(totais.cancelado||0)},chamados:chamados.map((chamado)=>({...chamado,atualizacoes:eventos.all(chamado.id,inicio,fim).map((evento)=>({horario:new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(evento.created_at)),autor:evento.autor||'Sistema',descricao:evento.kind==='status'?`Situação alterada para ${nomesSituacao[evento.to_status]||evento.to_status}${evento.message ? `: ${evento.message}` : ''}`:evento.message||'Chamado atualizado'}))}))};
}

function concluirRelatorio(db,item){const agora=new Date().toISOString();db.prepare("UPDATE daily_report_deliveries SET status='sent',sent_at=?,locked_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='processing' AND attempts=? AND locked_at=?").run(agora,agora,item.id,item.attempts,item.locked_at)}
function falharRelatorio(db,item,erro){const agora=new Date(),definitivo=Number(item.attempts)>=maxTentativas||!falhaAntesEntrega(erro),mensagem=((!falhaAntesEntrega(erro)?MENSAGEM_INTERROMPIDO+' ':'')+(erro instanceof Error?erro.message:'Falha SMTP')).replace(/[\r\n]+/g,' ').slice(0,500);db.prepare("UPDATE daily_report_deliveries SET status=?,next_attempt_at=?,locked_at=NULL,last_error=?,updated_at=? WHERE id=? AND status='processing' AND attempts=? AND locked_at=?").run(definitivo?'failed':'pending',proximaTentativa(Number(item.attempts),agora),mensagem,agora.toISOString(),item.id,item.attempts,item.locked_at)}

export async function processarRelatoriosDiarios(db,config,transportador,{concluir:confirmar=concluirRelatorio,esperas}={}){
  if(validacaoAtiva(db))return;
  prepararRelatoriosDiarios(db);
  for(let indice=0;indice<5;indice++){
    const [item]=reservarRelatoriosDiarios(db);if(!item)break;
    try{
      if(!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1 AND role IN ('admin','editor') AND daily_report_enabled=1").get(item.user_id)){
        db.prepare("UPDATE daily_report_deliveries SET status='failed',locked_at=NULL,last_error='Permissão de relatório revogada.' WHERE id=? AND status='processing' AND locked_at=?").run(item.id,item.locked_at);
        continue;
      }
      const periodo=item.period_start&&item.period_end?{inicio:item.period_start,fim:item.period_end}:null;
      const dados=dadosRelatorioDiario(db,item.report_date,new Date(),periodo),email=montarEmailRelatorioDiario(item.report_date,dados.totais,dados.chamados,config.PORTAL_URL,dados.periodo);
      await transportador.sendMail({from:{name:config.EMAIL_FROM_NAME,address:config.SMTP_USER},to:{name:item.recipient_name,address:item.recipient_email},subject:email.assunto,text:email.texto,html:email.html});
    }catch(erro){
      try{falharRelatorio(db,item,erro)}catch(erroBanco){registrar(`${item.id} falha nao registrada: ${erroBanco instanceof Error?erroBanco.message:'erro desconhecido'}.`)}
      registrar(`${item.id} relatorio diario falhou na tentativa ${item.attempts}: ${erro instanceof Error?erro.message:'erro desconhecido'}.`);continue;
    }
    if(await confirmarEnvio(item,{concluir:()=>confirmar(db,item),naoConfirmado:()=>marcarNaoConfirmado(db,'daily_report_deliveries',item),esperas}))registrar(`${item.id} relatorio diario enviado para ${item.recipient_email}.`);
  }
}

async function ciclo(config, transportador) {
  const db = abrirBanco();
  if (!db) { registrar('Fila ainda nao disponivel; aguardando o portal inicializar a base.'); return; }
  try {
    await processarNotificacoes(db, config, transportador);
    await processarRelatoriosDiarios(db,config,transportador);
    db.exec('CREATE TABLE IF NOT EXISTS email_runner(id INTEGER PRIMARY KEY CHECK(id=1),heartbeat_at TEXT NOT NULL)');
    db.prepare('INSERT INTO email_runner(id,heartbeat_at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at').run(new Date().toISOString());
  } finally { db.close(); }
}

export async function processarNotificacoes(db, config, transportador, { concluir: confirmar = concluir, esperas } = {}) {
    for (let indice=0;indice<10;indice++) {
      if(validacaoAtiva(db))break;
      const [item]=reservar(db,1);if(!item)break;
      try {
        // Revalida imediatamente antes do SMTP; uma fila antiga nao concede acesso.
        const destinatario = db.prepare("SELECT id FROM users WHERE lower(email)=lower(?) AND active=1 AND role IN ('admin','editor') AND (? IS NULL OR id=?)")
          .get(item.recipient_email, item.recipient_user_id ?? null, item.recipient_user_id ?? null);
        if (!destinatario) {
          db.prepare("UPDATE email_notifications SET status='failed',locked_at=NULL,last_error='Permissão de chamado revogada ou destinatário alterado.',updated_at=? WHERE id=? AND status='processing' AND attempts=? AND locked_at=?")
            .run(new Date().toISOString(), item.id, item.attempts, item.locked_at);
          continue;
        }
        const dados = JSON.parse(item.payload_json);
        const email = montarEmailChamado(item.type, dados, config.PORTAL_URL);
        await transportador.sendMail({
          from: { name: config.EMAIL_FROM_NAME, address: config.SMTP_USER },
          to: { name: item.recipient_name, address: item.recipient_email },
          subject: email.assunto,
          text: email.texto,
          html: email.html,
        });
      } catch (erro) {
        try { falhar(db, item, erro); }
        catch (erroBanco) { registrar(`${item.id} falha nao registrada: ${erroBanco instanceof Error ? erroBanco.message : 'erro desconhecido'}.`); }
        registrar(`${item.id} falhou na tentativa ${item.attempts}: ${erro instanceof Error ? erro.message : 'erro desconhecido'}.`);
        continue;
      }
      // Fora do try do envio: falha daqui nao pode chamar falhar() e reenviar.
      if (await confirmarEnvio(item, { concluir: () => confirmar(db, item), naoConfirmado: () => marcarNaoConfirmado(db, 'email_notifications', item), esperas }))
        registrar(`${item.id} enviado para ${item.recipient_email}.`);
    }
}

async function principal() {
  const config = lerConfig();
  const liberarRestauracao = travarRestauracao();
  try {
  const transportador = criarTransportador(config);
  if (testarConexao) {
    await transportador.verify();
    registrar('Conexao e autenticacao SMTP verificadas; nenhuma mensagem enviada.');
    return;
  }
  do {
    try { await ciclo(config, transportador); }
    catch (erro) { registrar(`Ciclo interrompido: ${erro instanceof Error ? erro.message : 'erro desconhecido'}.`); }
    if (observar) await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (observar);
  transportador.close();
  } finally { liberarRestauracao(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  principal().catch((erro) => {
    registrar(`ERRO: ${erro instanceof Error ? erro.message : 'falha inesperada'}.`);
    process.exitCode = 1;
  });
}
