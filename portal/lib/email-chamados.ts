import { type TipoNotificacaoChamado } from './notificacoes-chamados.ts';
import { montarCasca, escapar, paleta } from './email-visual.ts';

export type DadosEmailChamado = {
  ticketId: string;
  codigo: string;
  fornecedor: string;
  prioridade: string;
  situacao: string;
  solicitante: string;
  responsavel: string;
  autor: string;
  resumo: string;
  alteracoes: string[];
  mensagem?: string | null;
};

const titulos: Record<TipoNotificacaoChamado, string> = {
  atribuicao: 'Chamado atribuído a você',
  atualizacao: 'Chamado atualizado',
  conclusao: 'Chamado concluído',
  cancelamento: 'Chamado cancelado',
};
const assuntos: Record<TipoNotificacaoChamado, string> = {
  atribuicao: 'atribuído a você',
  atualizacao: 'atualizado',
  conclusao: 'concluído',
  cancelamento: 'cancelado',
};
const statusLegivel: Record<string, string> = {
  aberto: 'Aberto',
  aguardando_fornecedor: 'Aguardando fornecedor',
  fechado: 'Concluído',
  cancelado: 'Cancelado',
};
const prioridadeLegivel: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const limparBase = (valor: string) => valor.trim().replace(/\/+$/, '');

export function montarEmailChamado(tipo: TipoNotificacaoChamado, dados: DadosEmailChamado, baseUrl: string) {
  const assunto = `[Portal Suprimentos] ${dados.codigo} ${assuntos[tipo]}`;
  const url = `${limparBase(baseUrl)}/?chamado=${encodeURIComponent(dados.ticketId)}`;
  const mudancas = dados.alteracoes.length ? dados.alteracoes.join(', ') : 'Andamento registrado';
  const mensagem = dados.mensagem?.trim();
  const texto = [
    titulos[tipo], '', `${dados.codigo} — ${dados.fornecedor}`, dados.resumo, '',
    `Situação: ${statusLegivel[dados.situacao] || dados.situacao}`,
    `Prioridade: ${prioridadeLegivel[dados.prioridade] || dados.prioridade}`,
    `Solicitante: ${dados.solicitante || 'Não informado'}`,
    `Responsável: ${dados.responsavel || 'Não atribuído'}`,
    `Alterado por: ${dados.autor}`, `Alterações: ${mudancas}`,
    ...(mensagem ? ['', 'Mensagem:', mensagem] : []), '', `Abrir chamado: ${url}`,
  ].join('\n');
  const linhasAlteracao = dados.alteracoes.length
    ? `<ul style="margin:8px 0 0;padding-left:20px">${dados.alteracoes.map((item) => `<li>${escapar(item)}</li>`).join('')}</ul>`
    : '<p style="margin:8px 0 0">Andamento registrado</p>';
  const detalhes = [
    ['Situação', statusLegivel[dados.situacao] || dados.situacao],
    ['Prioridade', prioridadeLegivel[dados.prioridade] || dados.prioridade],
    ['Solicitante', dados.solicitante || 'Não informado'],
    ['Responsável', dados.responsavel || 'Não atribuído'],
    ['Alterado por', dados.autor],
  ].map(([rotulo, valor]) => `<tr><td><b>${escapar(rotulo)}</b></td><td>${escapar(valor)}</td></tr>`).join('');

  const conteudo = [
    `<p style="margin:0 0 22px;line-height:1.55">${escapar(dados.resumo)}</p>`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="7" style="font-size:14px;background:${paleta.rodapeFundo};border-radius:10px">${detalhes}</table>`,
    `<div style="margin-top:22px;font-size:14px;line-height:1.5"><b>Alterações</b>${linhasAlteracao}</div>`,
    mensagem
      ? `<div style="margin-top:20px;padding:14px 16px;border-left:4px solid #14b8a6;background:#f0fdfa;white-space:pre-wrap;line-height:1.5">${escapar(mensagem)}</div>`
      : '',
  ].join('');

  const html = montarCasca(
    titulos[tipo],
    `${dados.codigo} · ${dados.fornecedor}`,
    conteudo,
    { texto: 'Abrir chamado', url },
  );
  return { assunto, texto, html, url };
}

export function proximaTentativa(tentativas: number, agora = new Date()) {
  const minutos = [1, 5, 15, 60, 240][Math.max(0, Math.min(tentativas - 1, 4))];
  return new Date(agora.getTime() + minutos * 60_000).toISOString();
}
