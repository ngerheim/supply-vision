// Historico de 7 dias do backup do banco.
//
// O backup mantinha so a copia mais recente, sobrescrita a cada horario: um
// acordo apagado por engano as 10h sumia tambem do backup das 11h, e nao havia
// ponto anterior ao erro para onde voltar. Agora a copia de cada dia fica em
// historico/portal-AAAA-MM-DD.sqlite -- a ultima daquele dia, porque cada
// backup regrava o arquivo do dia -- e os dias alem da janela sao apagados.
//
// So toca arquivos com esse padrao de nome, na pasta historico/; qualquer
// outro arquivo ali fica como esta.
import fs from 'node:fs';
import path from 'node:path';

export const DIAS_RETENCAO = 7;
const PADRAO = /^portal-(\d{4}-\d{2}-\d{2})\.sqlite$/;

// Data local da maquina, que e a do expediente.
export function nomeDoDia(data = new Date()) {
  const dois = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

export function pastaHistorico(pastaBase) {
  return path.join(pastaBase, 'historico');
}

// Copia a origem para o arquivo do dia (via temporario + rename, para nunca
// deixar um arquivo do dia pela metade) e apaga o que passou da janela.
export function guardarNoHistorico(pastaBase, origem, agora = new Date(), dias = DIAS_RETENCAO) {
  const pasta = pastaHistorico(pastaBase);
  fs.mkdirSync(pasta, { recursive: true });
  const destino = path.join(pasta, `portal-${nomeDoDia(agora)}.sqlite`);
  const temporario = `${destino}.tmp`;
  fs.rmSync(temporario, { force: true });
  fs.copyFileSync(origem, temporario);
  fs.rmSync(destino, { force: true });
  fs.renameSync(temporario, destino);
  const apagados = podarHistorico(pastaBase, agora, dias);
  return { destino, apagados };
}

export function podarHistorico(pastaBase, agora = new Date(), dias = DIAS_RETENCAO) {
  const limite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - (dias - 1));
  const corte = nomeDoDia(limite);
  const apagados = [];
  for (const { arquivo, dia } of listarHistorico(pastaBase)) {
    if (dia < corte) {
      fs.rmSync(arquivo, { force: true });
      apagados.push(path.basename(arquivo));
    }
  }
  return apagados;
}

// Do mais recente para o mais antigo.
export function listarHistorico(pastaBase) {
  const pasta = pastaHistorico(pastaBase);
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta)
    .map((nome) => ({ nome, dia: PADRAO.exec(nome)?.[1] }))
    .filter((item) => item.dia)
    .sort((a, b) => b.dia.localeCompare(a.dia))
    .map(({ nome, dia }) => ({ arquivo: path.join(pasta, nome), dia }));
}
