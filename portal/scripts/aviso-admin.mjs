import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { criarTransportador, lerConfigSmtp, privado } from './configuracao.mjs';
import { modoEnsaio } from './modo-ensaio.mjs';

export const EVENTOS_ADMIN = Object.freeze({
  'tarefa-falhou': { nome: 'Tarefa principal falhou ao iniciar', ocorrido: 'A vigilância encontrou falha na partida da tarefa principal.', acao: 'Confira a conta e reconfigure a senha da tarefa pela central elevada.', secao: 'A conta da tarefa não consegue entrar', ancora: 'a-conta-da-tarefa-não-consegue-entrar' },
  'vigilancia-health': { nome: 'Vigilância: Portal indisponível', ocorrido: 'A verificação diária não recebeu uma resposta saudável do Portal.', acao: 'Abra a central e confira a tarefa e supervisor.log.', secao: 'A conta da tarefa não consegue entrar', ancora: 'a-conta-da-tarefa-não-consegue-entrar' },
  'portal-parou': { nome: 'Portal parou de responder', ocorrido: 'O Portal deixou de responder após duas verificações seguidas.', acao: 'Confira a central, teste o acesso local e consulte portal-erro.log e supervisor.log.', secao: 'O Portal não responde na LAN', ancora: 'o-portal-não-responde-na-lan' },
  'portal-reiniciado': { nome: 'Portal reiniciado automaticamente', ocorrido: 'O supervisor iniciou a recuperação automática do Portal após falhas persistentes.', acao: 'Confira se o Portal voltou a responder. Se os reinícios continuarem, pare a operação e preserve os logs.', secao: 'O Portal não responde na LAN', ancora: 'o-portal-não-responde-na-lan' },
  'backup-falhou': { nome: 'Backup falhou', ocorrido: 'A rotina de backup terminou com falha.', acao: 'Confira supervisor.log, o último backup e o acesso à pasta de rede. Não sobrescreva o banco atual.', secao: 'O backup não chegou', ancora: 'o-backup-não-chegou' },
  'alertas-falharam': { nome: 'Alertas falharam', ocorrido: 'A execução dos Alertas terminou com falha.', acao: 'Confira supervisor.log e o último pipeline_*.log. Valide a configuração e a conectividade antes de tentar novamente.', secao: 'Os Alertas não rodaram', ancora: 'os-alertas-não-rodaram' },
  'alertas-revisao': { nome: 'Alertas exigem revisão de entrega', ocorrido: 'A execução dos Alertas indicou entrega parcial ou incerta.', acao: 'Confira a entrega com os destinatários e os registros em privado/alertas/estado-envios. Não reenvie antes de conferir.', secao: 'Os Alertas não rodaram', ancora: 'os-alertas-não-rodaram' },
  'disco-baixo': { nome: 'Espaço em disco baixo', ocorrido: 'O espaço livre ficou abaixo do limite ESPACO_MINIMO_GB.', acao: 'Confira o espaço livre na central e a limpeza diária. Faça a faxina indicada no manual com a operação parada.', secao: 'Espaço em disco baixo', ancora: 'espaço-em-disco-baixo' },
  'supervisor-iniciado': { nome: 'Supervisor iniciado', ocorrido: 'O supervisor iniciou a operação nesta máquina.', acao: 'Confira na central se os módulos estão ativos. Se a partida foi inesperada, consulte supervisor.log e verifique o reinício da máquina.', secao: 'O supervisor caiu', ancora: 'o-supervisor-caiu' },
});

export function destinatariosAdmin(valor = '') {
  return [...new Set(valor.split(',').map(email => email.trim()).filter(Boolean))];
}

// Banco separado do Portal: somente tipo de evento e instante da tentativa.
// A reserva atomica antecede SMTP, inclusive para falha/resultado incerto.
function tentarReservaAviso(arquivo, evento, agora) {
  if (!Object.hasOwn(EVENTOS_ADMIN, evento)) throw new Error('Evento desconhecido.');
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  try {
    db.exec('PRAGMA busy_timeout=2000; CREATE TABLE IF NOT EXISTS avisos(evento TEXT PRIMARY KEY, tentativa_ms INTEGER NOT NULL)');
    return db.prepare(`INSERT INTO avisos(evento,tentativa_ms) VALUES(?,?)
      ON CONFLICT(evento) DO UPDATE SET tentativa_ms=excluded.tentativa_ms
      WHERE avisos.tentativa_ms<=?`).run(evento, agora, agora - 60 * 60_000).changes === 1;
  } finally { db.close(); }
}

export function reservarAviso(arquivo, evento, agora = Date.now()) {
  const limite = Date.now() + 10_000;
  for (;;) {
    try { return tentarReservaAviso(arquivo, evento, agora); }
    catch (erro) {
      // Inclui locks no open/schema, anteriores ao PRAGMA busy_timeout.
      if (![5, 6].includes(Number(erro?.errcode)) || Date.now() >= limite) throw erro;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

export function montarAviso(evento, agora = new Date(), maquina = os.hostname()) {
  const dados = EVENTOS_ADMIN[evento];
  if (!dados) throw new Error('Evento desconhecido.');
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'long' }).format(agora);
  return {
    subject: `[Supply Vision] ${dados.nome} — ${maquina}`,
    text: `Data/hora: ${data} (America/Sao_Paulo)\nMáquina: ${maquina}\n\n${dados.ocorrido}\n\nO que fazer: ${dados.acao}\n\nConsulte docs/SOCORRO.md, seção "${dados.secao}".\nhttps://github.com/ngerheim/supply-vision/blob/main/docs/SOCORRO.md#${dados.ancora}\n`,
  };
}

export async function enviarAvisoAdmin(evento, {
  destinatarios = process.env.ADMIN_ALERTA_EMAIL || '', ensaio = modoEnsaio(),
  arquivo = path.join(privado, 'operacao', 'avisos-admin.sqlite'), agora = new Date(),
  lerSmtp = lerConfigSmtp, criarTransporte = criarTransportador, limiteMs = 55_000,
  registrar = console.log,
} = {}) {
  const para = destinatariosAdmin(destinatarios);
  if (!para.length) return 'desligado';
  const dados = EVENTOS_ADMIN[evento];
  if (!dados) throw new Error('Evento desconhecido.');
  if (ensaio) { registrar(`ensaio: aviso ao administrador suprimido — ${dados.nome}`); return 'ensaio'; }
  if (!reservarAviso(arquivo, evento, agora.getTime())) return 'limitado';
  let transporte, timer;
  try {
    const config = lerSmtp();
    transporte = criarTransporte(config);
    const mensagem = montarAviso(evento, agora);
    await Promise.race([
      transporte.sendMail({ ...mensagem, from: { name: config.EMAIL_FROM_NAME, address: config.SMTP_USER }, to: para }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tempo limite.')), Math.min(limiteMs, 55_000)); }),
    ]);
    return 'enviado';
  } finally {
    clearTimeout(timer);
    transporte?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // Prazo independente do supervisor, inclusive se o transporte nao concluir.
  const watchdog = setTimeout(() => { process.exit(1); }, 55_000);
  try {
    const resultado = await enviarAvisoAdmin(process.argv[2]);
    process.exitCode = resultado === 'limitado' ? 2 : 0;
  } catch {
    // Nao propagar erros que possam carregar credenciais, destinatarios ou dados.
    process.exitCode = 1;
  } finally { clearTimeout(watchdog); }
}
