import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
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

function registrar(texto) {
  const linha = `${new Date().toISOString()}  ${texto}`;
  console.log(linha);
  fs.appendFileSync(arquivoLog, `${linha}\n`, 'utf8');
  const linhas = fs.readFileSync(arquivoLog, 'utf8').split(/\r?\n/);
  if (linhas.length > 501) fs.writeFileSync(arquivoLog, `${linhas.slice(-500).join('\n')}\n`, 'utf8');
}

function localizarBanco() {
  if (bancoInformado) return bancoInformado;
  const diretorio = path.join(portalPrivado, 'banco', 'estado', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!fs.existsSync(diretorio)) return null;
  const nome = fs.readdirSync(diretorio).find((item) => item.endsWith('.sqlite') && item !== 'metadata.sqlite');
  return nome ? path.join(diretorio, nome) : null;
}

function abrirBanco() {
  const arquivo = localizarBanco();
  if (!arquivo) return null;
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA busy_timeout=5000');
  const tabela = db.prepare("SELECT 1 ok FROM sqlite_schema WHERE type='table' AND name='email_notifications'").get();
  if (!tabela) { db.close(); return null; }
  return db;
}

export function reservar(db, limite = 10) {
  const agora = new Date();
  const agoraIso = agora.toISOString();
  const travaVencida = new Date(agora.getTime() - 10 * 60_000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE email_notifications SET status='pending',locked_at=NULL,updated_at=? WHERE status='processing' AND locked_at<?")
      .run(agoraIso, travaVencida);
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
  db.prepare("UPDATE email_notifications SET status='sent',sent_at=?,locked_at=NULL,last_error=NULL,updated_at=? WHERE id=?")
    .run(agora, agora, item.id);
}

export function falhar(db, item, erro) {
  const agora = new Date();
  const definitivo = Number(item.attempts) >= maxTentativas;
  const mensagem = (erro instanceof Error ? erro.message : 'Falha SMTP').replace(/[\r\n]+/g, ' ').slice(0, 500);
  db.prepare('UPDATE email_notifications SET status=?,next_attempt_at=?,locked_at=NULL,last_error=?,updated_at=? WHERE id=?')
    .run(definitivo ? 'failed' : 'pending', proximaTentativa(Number(item.attempts), agora), mensagem, agora.toISOString(), item.id);
}

function horarioSaoPaulo(data=new Date()){
  const partes=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(data).filter((p)=>p.type!=='literal').map((p)=>[p.type,p.value]));
  return {data:`${partes.year}-${partes.month}-${partes.day}`,horario:`${partes.hour}:${partes.minute}`};
}

export function prepararRelatoriosDiarios(db,agora=new Date()){
  const local=horarioSaoPaulo(agora),agoraIso=agora.toISOString();
  const usuarios=db.prepare("SELECT id FROM users WHERE active=1 AND daily_report_enabled=1 AND daily_report_time<=?").all(local.horario);
  const inserir=db.prepare("INSERT OR IGNORE INTO daily_report_deliveries (id,user_id,report_date,status,attempts,next_attempt_at,created_at,updated_at) VALUES (?,?,?,'pending',0,?,?,?)");
  for(const usuario of usuarios) inserir.run(`rpt_${crypto.randomUUID().replaceAll('-','')}`,usuario.id,local.data,agoraIso,agoraIso,agoraIso);
  return local.data;
}

function reservarRelatoriosDiarios(db,agora=new Date()){
  const agoraIso=agora.toISOString(),travaVencida=new Date(agora.getTime()-10*60_000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare("UPDATE daily_report_deliveries SET status='pending',locked_at=NULL,updated_at=? WHERE status='processing' AND locked_at<?").run(agoraIso,travaVencida);
    const itens=db.prepare("SELECT d.*,u.name recipient_name,u.email recipient_email FROM daily_report_deliveries d JOIN users u ON u.id=d.user_id WHERE d.status='pending' AND d.attempts<? AND d.next_attempt_at<=? AND u.active=1 AND u.daily_report_enabled=1 ORDER BY d.created_at LIMIT 5").all(maxTentativas,agoraIso);
    const reservar=db.prepare("UPDATE daily_report_deliveries SET status='processing',attempts=attempts+1,locked_at=?,updated_at=? WHERE id=? AND status='pending'");
    const escolhidos=[];
    for(const item of itens)if(reservar.run(agoraIso,agoraIso,item.id).changes===1)escolhidos.push({...item,attempts:Number(item.attempts)+1});
    db.exec('COMMIT');return escolhidos;
  }catch(erro){db.exec('ROLLBACK');throw erro}
}

function dadosRelatorioDiario(db,dataRelatorio,agora=new Date()){
  const inicio=new Date(`${dataRelatorio}T03:00:00.000Z`).toISOString(),fim=agora.toISOString();
  const totais=db.prepare(`SELECT SUM(status='aberto') aberto,SUM(status='aguardando_fornecedor') aguardando,SUM(status='fechado') fechado,SUM(status='cancelado') cancelado FROM tickets`).get();
  const chamados=db.prepare("SELECT id,code codigo,supplier_name fornecedor,status situacao FROM tickets WHERE updated_at>=? AND updated_at<=? ORDER BY updated_at DESC").all(inicio,fim);
  const eventos=db.prepare("SELECT e.kind,e.from_status,e.to_status,e.message,e.created_at,u.name autor FROM ticket_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.ticket_id=? AND e.created_at>=? AND e.created_at<=? ORDER BY e.created_at");
  const nomesSituacao={aberto:'Aberto',aguardando_fornecedor:'Aguardando fornecedor',fechado:'Fechado',cancelado:'Cancelado'};
  return {totais:{aberto:Number(totais.aberto||0),aguardando:Number(totais.aguardando||0),fechado:Number(totais.fechado||0),cancelado:Number(totais.cancelado||0)},chamados:chamados.map((chamado)=>({...chamado,atualizacoes:eventos.all(chamado.id,inicio,fim).map((evento)=>({horario:new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(evento.created_at)),autor:evento.autor||'Sistema',descricao:evento.kind==='status'?`Situação alterada para ${nomesSituacao[evento.to_status]||evento.to_status}`:evento.message||'Chamado atualizado'}))}))};
}

function concluirRelatorio(db,item){const agora=new Date().toISOString();db.prepare("UPDATE daily_report_deliveries SET status='sent',sent_at=?,locked_at=NULL,last_error=NULL,updated_at=? WHERE id=?").run(agora,agora,item.id)}
function falharRelatorio(db,item,erro){const agora=new Date(),definitivo=Number(item.attempts)>=maxTentativas,mensagem=(erro instanceof Error?erro.message:'Falha SMTP').replace(/[\r\n]+/g,' ').slice(0,500);db.prepare("UPDATE daily_report_deliveries SET status=?,next_attempt_at=?,locked_at=NULL,last_error=?,updated_at=? WHERE id=?").run(definitivo?'failed':'pending',proximaTentativa(Number(item.attempts),agora),mensagem,agora.toISOString(),item.id)}

async function processarRelatoriosDiarios(db,config,transportador){
  prepararRelatoriosDiarios(db);
  for(const item of reservarRelatoriosDiarios(db)){
    try{
      const dados=dadosRelatorioDiario(db,item.report_date),email=montarEmailRelatorioDiario(item.report_date,dados.totais,dados.chamados,config.PORTAL_URL);
      await transportador.sendMail({from:{name:config.EMAIL_FROM_NAME,address:config.SMTP_USER},to:{name:item.recipient_name,address:item.recipient_email},subject:email.assunto,text:email.texto,html:email.html});
      concluirRelatorio(db,item);registrar(`${item.id} relatorio diario enviado para ${item.recipient_email}.`);
    }catch(erro){falharRelatorio(db,item,erro);registrar(`${item.id} relatorio diario falhou na tentativa ${item.attempts}: ${erro instanceof Error?erro.message:'erro desconhecido'}.`)}
  }
}

async function ciclo(config, transportador) {
  const db = abrirBanco();
  if (!db) { registrar('Fila ainda nao disponivel; aguardando o portal inicializar a base.'); return; }
  try {
    const itens = reservar(db);
    for (const item of itens) {
      try {
        const dados = JSON.parse(item.payload_json);
        const email = montarEmailChamado(item.type, dados, config.PORTAL_URL);
        await transportador.sendMail({
          from: { name: config.EMAIL_FROM_NAME, address: config.SMTP_USER },
          to: { name: item.recipient_name, address: item.recipient_email },
          subject: email.assunto,
          text: email.texto,
          html: email.html,
        });
        concluir(db, item);
        registrar(`${item.id} enviado para ${item.recipient_email}.`);
      } catch (erro) {
        falhar(db, item, erro);
        registrar(`${item.id} falhou na tentativa ${item.attempts}: ${erro instanceof Error ? erro.message : 'erro desconhecido'}.`);
      }
    }
    await processarRelatoriosDiarios(db,config,transportador);
  } finally { db.close(); }
}

async function principal() {
  const config = lerConfig();
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
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  principal().catch((erro) => {
    registrar(`ERRO: ${erro instanceof Error ? erro.message : 'falha inesperada'}.`);
    process.exitCode = 1;
  });
}
