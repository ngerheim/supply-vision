import type { ContextoApi, User } from './api-compartilhada.ts';
import { pode } from './permissoes.ts';
import { linkSolicitacao, situacaoSolicitacao } from './email-solicitacoes.ts';

type Pessoa = User & { active: number };

// Apenas prepara instrucoes. A existencia do evento novo e a ativacao do
// destinatario sao conferidas dentro do mesmo BEGIN IMMEDIATE da causa.
export async function prepararAvisosSolicitacao(contexto: ContextoApi, {
  solicitacaoId, evento, autor, anterior, para, timestamp,
}: { solicitacaoId: string; evento: string; autor: User; anterior: string | null; para: string; timestamp: string }) {
  if (anterior === para) return []; // Reconsulta na Receita nao e andamento.
  const { all, first, rawDb, id } = contexto;
  const pessoas = await all<Pessoa>('SELECT id,name,email,role,active FROM users WHERE active=1');
  const atendentes = pessoas.filter(pessoa => pode(pessoa, 'solicitacao:atender'));
  const atual = anterior === null ? null : await first<{ solicitante_id: string }>('SELECT solicitante_id FROM solicitacoes WHERE id=?', [solicitacaoId]);
  let destinatarios: Pessoa[];
  if (anterior === null) destinatarios = atendentes;
  else if (para === 'aberta') {
    const devolucao = await first<{ user_id: string }>("SELECT user_id FROM solicitacao_andamentos WHERE solicitacao_id=? AND de_status='em_analise' AND para_status='devolvida' ORDER BY rowid DESC LIMIT 1", [solicitacaoId]);
    const devolveu = pessoas.find(pessoa => pessoa.id === devolucao?.user_id && pode(pessoa, 'solicitacao:atender'));
    destinatarios = devolveu ? [devolveu] : atendentes;
  } else destinatarios = pessoas.filter(pessoa => pessoa.id === atual?.solicitante_id);
  return destinatarios.filter(pessoa => pessoa.id !== autor.id).flatMap(pessoa => {
    const condicao = `EXISTS(SELECT 1 FROM solicitacao_andamentos WHERE id=? AND solicitacao_id=s.id)
      AND ? IN (SELECT role FROM users WHERE id=? AND active=1)`;
    // O perfil e somente uma versao da pessoa escolhida com pode(), nunca
    // uma lista SQL de perfis autorizados. Revogacao entre leitura e lote cala o aviso.
    const valores = [solicitacaoId, evento, pessoa.role, pessoa.id];
    const texto = anterior === null ? "'Nova solicitação ' || s.codigo || CASE WHEN s.urgencia='urgente' THEN ' (urgente)' ELSE '' END"
      : para === 'aberta' ? "s.codigo || ': corrigida e reenviada'" : `s.codigo || ': ' || ?`;
    const central = rawDb().prepare(`INSERT INTO notificacoes_usuario(id,user_id,tipo,texto,link,criada_em)
      SELECT ?,?,'solicitacao',${texto},?,? FROM solicitacoes s WHERE s.id=? AND ${condicao}`)
      .bind(id('ntf'), pessoa.id, ...(anterior !== null && para !== 'aberta' ? [situacaoSolicitacao[para]] : []), linkSolicitacao(solicitacaoId), timestamp, ...valores);
    if ((para === 'aberta' && anterior !== null) || !pessoa.email.trim()) return [central];
    const tipo = anterior === null ? 'solicitacao_abertura' : 'solicitacao_andamento';
    const email = rawDb().prepare(`INSERT OR IGNORE INTO email_notifications
      (id,ticket_id,solicitacao_id,event_id,type,recipient_user_id,recipient_name,recipient_email,payload_json,status,attempts,next_attempt_at,dedupe_key,created_at,updated_at)
      SELECT ?,NULL,s.id,?,?,?,?,?,json_object('solicitacaoId',s.id,'codigo',s.codigo,'fornecedor',s.razao_social,'cnpj',s.cnpj,'situacao',s.status,
        'mensagem',(SELECT COALESCE(texto,'') FROM solicitacao_andamentos WHERE id=?)), 'pending',0,?,?,?,?
      FROM solicitacoes s WHERE s.id=? AND ${condicao} ${anterior === null ? "AND s.urgencia='urgente'" : ''}`)
      .bind(id('eml'), evento, tipo, pessoa.id, pessoa.name, pessoa.email.trim(), evento, timestamp,
        `${evento}:${tipo}:${pessoa.id}`, timestamp, timestamp, ...valores);
    return [central, email];
  });
}
