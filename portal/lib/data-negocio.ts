// Data de negocio: o dia do calendario em Sao Paulo, qualquer que seja o fuso
// da maquina.
//
// As regras de vigencia (acordo vigente, agendado, expirado, a vencer e a
// busca de precos) usavam date('now') no SQLite, que e UTC -- e o Worker
// tambem roda em UTC. Das 21h a meia-noite o Portal ja agia como se fosse o
// dia seguinte: um acordo que vence hoje sumia da busca tres horas antes, e
// um que comeca amanha aparecia antes da hora. Agora o dia e calculado aqui,
// com o fuso explicito, e entra nas consultas como parametro.
export const FUSO_NEGOCIO = 'America/Sao_Paulo';

export function dataDeNegocio(agora: Date = new Date()): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_NEGOCIO, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(agora)
      .map(({ type, value }) => [type, value]),
  );
  return `${partes.year}-${partes.month}-${partes.day}`;
}
