import { id, now, rawDb } from './database.ts';
import { planejarNotificacoesChamado, type DestinatarioChamado, type EstadoNotificacaoChamado, type MudancaChamado } from './notificacoes-chamados.ts';
import { type DadosEmailChamado } from './email-chamados.ts';

export type ContextoNotificacaoChamado = {
  id: string;
  codigo: string;
  fornecedor: string;
  prioridade: string;
  status: EstadoNotificacaoChamado['status'];
  solicitante: DestinatarioChamado | null;
  responsavel: DestinatarioChamado | null;
};

export async function pessoaNotificacao(userId: string | null) {
  if (!userId) return null;
  const pessoa = await rawDb().prepare('SELECT id,name,email FROM users WHERE id=?').bind(userId)
    .first<{ id: string; name: string; email: string }>();
  return pessoa ? { id: pessoa.id, nome: pessoa.name, email: pessoa.email } : null;
}

export async function contextoNotificacaoChamado(ticketId: string): Promise<ContextoNotificacaoChamado | null> {
  const registro = await rawDb().prepare(`SELECT t.id,t.code,t.supplier_name,t.priority,t.status,
    r.id requested_id,r.name requested_name,r.email requested_email,
    a.id assigned_id,a.name assigned_name,a.email assigned_email
    FROM tickets t LEFT JOIN users r ON r.id=t.requested_by LEFT JOIN users a ON a.id=t.assigned_to WHERE t.id=?`)
    .bind(ticketId).first<Record<string, string | null>>();
  if (!registro) return null;
  return {
    id: registro.id!, codigo: registro.code!, fornecedor: registro.supplier_name!,
    prioridade: registro.priority!, status: registro.status as EstadoNotificacaoChamado['status'],
    solicitante: registro.requested_id ? { id: registro.requested_id, nome: registro.requested_name!, email: registro.requested_email! } : null,
    responsavel: registro.assigned_id ? { id: registro.assigned_id, nome: registro.assigned_name!, email: registro.assigned_email! } : null,
  };
}

const resumoPorTipo = {
  atribuicao: 'Este chamado foi atribuído a você.',
  atualizacao: 'Houve uma atualização neste chamado.',
  conclusao: 'A tratativa deste chamado foi concluída.',
  cancelamento: 'Este chamado foi cancelado.',
};

export function prepararNotificacoesChamado({
  eventId, anterior, atual, mudanca, autor, alteracoes, mensagem, timestamp = now(),
}: {
  eventId: string;
  anterior: ContextoNotificacaoChamado | null;
  atual: ContextoNotificacaoChamado;
  mudanca?: MudancaChamado;
  autor: { name: string };
  alteracoes: string[];
  mensagem?: string | null;
  timestamp?: string;
}) {
  const planejadas = planejarNotificacoesChamado(anterior, atual, mudanca);
  return planejadas.map(({ tipo, destinatario }) => {
    const payload: DadosEmailChamado = {
      ticketId: atual.id, codigo: atual.codigo, fornecedor: atual.fornecedor,
      prioridade: atual.prioridade, situacao: atual.status,
      solicitante: atual.solicitante?.nome || '', responsavel: atual.responsavel?.nome || '',
      autor: autor.name, resumo: resumoPorTipo[tipo], alteracoes, mensagem,
    };
    const dedupe = `${eventId}:${tipo}:${destinatario.email.trim().toLocaleLowerCase('pt-BR')}`;
    return rawDb().prepare(`INSERT OR IGNORE INTO email_notifications
      (id,ticket_id,event_id,type,recipient_name,recipient_email,payload_json,status,attempts,next_attempt_at,dedupe_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'pending',0,?,?,?,?)`)
      .bind(id('eml'), atual.id, eventId, tipo, destinatario.nome, destinatario.email.trim(), JSON.stringify(payload), timestamp, dedupe, timestamp, timestamp);
  });
}
