export type TotaisRelatorio = { aberto:number; aguardando:number; fechado:number; cancelado:number };
export type AtualizacaoRelatorio = { horario:string; autor:string; descricao:string };
export type ChamadoRelatorio = { id:string; codigo:string; titulo?:string; fornecedor:string; situacao:string; atualizacoes:AtualizacaoRelatorio[] };

import { montarCasca, escapar, paleta } from './email-visual.ts';
const situacoes:Record<string,string>={aberto:'Aberto',aguardando_fornecedor:'Aguardando fornecedor',fechado:'Fechado',cancelado:'Cancelado'};

export type PeriodoRelatorio = { inicio:string; fim:string };
const formatoPeriodo=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

// O relatorio cobre do fim do envio anterior ate a preparacao deste; com o
// periodo informado, o texto diz a janela em vez de "hoje".
export function montarEmailRelatorioDiario(data:string,totais:TotaisRelatorio,chamados:ChamadoRelatorio[],portalUrl:string,periodo?:PeriodoRelatorio){
  const dataExibida=data.split('-').reverse().join('/');
  const janela=periodo?`${formatoPeriodo.format(new Date(periodo.inicio))} a ${formatoPeriodo.format(new Date(periodo.fim))}`:'';
  const vazio=periodo?'Nenhum chamado foi atualizado no período.':'Nenhum chamado foi atualizado hoje.';
  const titulo=periodo?'Atualizações do período':'Atualizações do dia';
  const resumo=`${totais.aberto} aberto(s), ${totais.aguardando} aguardando, ${totais.fechado} fechado(s) e ${totais.cancelado} cancelado(s)`;
  const linhas=chamados.length?chamados.map((chamado)=>{
    const eventos=chamado.atualizacoes.length?chamado.atualizacoes.map((item)=>`    ${item.horario} — ${item.autor}: ${item.descricao}`).join('\n'):'    Sem detalhes adicionais.';
    return `${chamado.codigo} · ${chamado.fornecedor||chamado.titulo||chamado.codigo} · ${situacoes[chamado.situacao]||chamado.situacao}\n${eventos}\n    ${portalUrl}?chamado=${encodeURIComponent(chamado.id)}`;
  }).join('\n\n'):vazio;
  const blocos=chamados.length?chamados.map((chamado)=>`<section style="margin-top:18px;padding:16px;border:1px solid #dbe3ea;border-radius:12px"><div style="font-weight:700;color:#0f766e"><a href="${escapar(portalUrl)}?chamado=${encodeURIComponent(chamado.id)}" style="color:#0f766e">${escapar(chamado.codigo)}</a></div><div style="margin-top:4px;font-weight:600">${escapar(chamado.fornecedor||chamado.titulo||chamado.codigo)}</div><div style="margin-top:4px;color:#64748b">${escapar(situacoes[chamado.situacao]||chamado.situacao)}</div><ul style="margin:12px 0 0;padding-left:20px">${chamado.atualizacoes.map((item)=>`<li style="margin-top:7px"><strong>${escapar(item.horario)}</strong> — ${escapar(item.autor)}: ${escapar(item.descricao)}</li>`).join('')}</ul></section>`).join(''):`<p style="margin-top:20px">${vazio}</p>`;
  const conteudo = `<div style="margin-top:4px;padding:16px;border-radius:12px;background:${paleta.rodapeFundo};font-weight:600">${escapar(resumo)}</div>${janela?`<p style="margin-top:12px;color:#64748b">Período: ${escapar(janela)}</p>`:''}<h2 style="margin-top:28px;font-size:18px">${titulo}</h2>${blocos}`;
  return {
    assunto:`[Supply Vision] Relatório diário de chamados — ${dataExibida}`,
    texto:`Relatório diário de chamados — ${dataExibida}\n${janela?`Período: ${janela}\n`:''}\n${resumo}\n\n${titulo}\n\n${linhas}\n`,
    html: montarCasca(
      'Relatório diário de chamados',
      dataExibida,
      conteudo,
      { texto: 'Abrir Portal', url: portalUrl },
    ),
  };
}
