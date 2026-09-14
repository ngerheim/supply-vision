import { type TicketStatus } from './domain.ts';

export type DestinatarioChamado = { id: string; email: string; nome: string };
export type EstadoNotificacaoChamado = {
  status: TicketStatus;
  solicitante: DestinatarioChamado | null;
  responsavel: DestinatarioChamado | null;
};
export type MudancaChamado = { andamentoAdicionado?: boolean; camposAlterados?: readonly string[] };
export type TipoNotificacaoChamado = 'atribuicao' | 'atualizacao' | 'conclusao' | 'cancelamento';
export type NotificacaoChamadoPlanejada = { tipo: TipoNotificacaoChamado; destinatario: DestinatarioChamado };

const emailValido = (destinatario: DestinatarioChamado | null): destinatario is DestinatarioChamado =>
  Boolean(destinatario?.email.trim());

function destinatariosUnicos(...destinatarios: Array<DestinatarioChamado | null>) {
  const unicos = new Map<string, DestinatarioChamado>();
  for (const destinatario of destinatarios) {
    if (!emailValido(destinatario)) continue;
    const chave = destinatario.email.trim().toLocaleLowerCase('pt-BR');
    if (!unicos.has(chave)) unicos.set(chave, { ...destinatario, email: destinatario.email.trim() });
  }
  return [...unicos.values()];
}

// Decide somente os disparos. Banco, conteudo e SMTP ficam fora para que as
// regras possam ser provadas sem rede nem credenciais.
export function planejarNotificacoesChamado(
  anterior: EstadoNotificacaoChamado | null,
  atual: EstadoNotificacaoChamado,
  mudanca: MudancaChamado = {},
): NotificacaoChamadoPlanejada[] {
  const mudouResponsavel = anterior?.responsavel?.id !== atual.responsavel?.id;
  const mudouStatus = anterior !== null && anterior.status !== atual.status;
  const houveAtualizacao = Boolean(mudanca.andamentoAdicionado || mudanca.camposAlterados?.length || mudouStatus);

  // Conclusao e cancelamento prevalecem: cada pessoa recebe no maximo uma
  // mensagem mesmo quando o mesmo salvamento altera outros campos.
  if (mudouStatus && atual.status === 'fechado') {
    return destinatariosUnicos(atual.solicitante, atual.responsavel)
      .map((destinatario) => ({ tipo: 'conclusao', destinatario }));
  }
  if (mudouStatus && atual.status === 'cancelado') {
    return destinatariosUnicos(atual.solicitante, atual.responsavel)
      .map((destinatario) => ({ tipo: 'cancelamento', destinatario }));
  }

  // Na criacao atribuida e na reatribuicao, somente o novo responsavel recebe
  // atribuicao. Se houve outra mudanca, o solicitante recebe uma atualizacao.
  if (mudouResponsavel && emailValido(atual.responsavel)) {
    const notificacoes: NotificacaoChamadoPlanejada[] = [
      { tipo: 'atribuicao', destinatario: atual.responsavel },
    ];
    if (houveAtualizacao && emailValido(atual.solicitante)
      && atual.solicitante.email.trim().toLocaleLowerCase('pt-BR') !== atual.responsavel.email.trim().toLocaleLowerCase('pt-BR')) {
      notificacoes.push({ tipo: 'atualizacao', destinatario: atual.solicitante });
    }
    return notificacoes;
  }

  if (!houveAtualizacao) return [];
  return destinatariosUnicos(atual.solicitante, atual.responsavel)
    .map((destinatario) => ({ tipo: 'atualizacao', destinatario }));
}
