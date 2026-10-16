import fs from 'node:fs';
import path from 'node:path';

export const DIAS_RETENCAO = 14;
export const PADRAO_BACKUP = /^supply-vision-(\d{4}-\d{2}-\d{2}_\d{4})\.7z$/;
export function nomeBackup(data = new Date()) {
  const dois = n => String(n).padStart(2, '0');
  return `supply-vision-${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}_${dois(data.getHours())}${dois(data.getMinutes())}.7z`;
}
export function listarHistorico(pasta) {
  return fs.readdirSync(pasta).filter(nome => PADRAO_BACKUP.test(nome))
    .filter(nome => fs.lstatSync(path.join(pasta, nome)).isFile())
    .sort().reverse().map(nome => ({ arquivo: path.join(pasta, nome), data: PADRAO_BACKUP.exec(nome)[1] }));
}
export function podarHistorico(pasta, agora = new Date(), dias = DIAS_RETENCAO) {
  if (!Number.isInteger(dias) || dias < 1) throw new Error('Retencao deve ser inteiro positivo.');
  const corte = nomeBackup(new Date(agora.getTime() - dias * 86400_000));
  const apagados = [];
  for (const { arquivo } of listarHistorico(pasta)) {
    if (path.basename(arquivo) < corte) { fs.unlinkSync(arquivo); apagados.push(path.basename(arquivo)); }
  }
  return apagados;
}

// Migracao: limpar apenas o legado conhecido APOS confirmar um pacote na rede.
export function removerHistoricoLocal(pasta) {
  if (!fs.existsSync(pasta)) return;
  for (const nome of ['portal-atual.sqlite', 'portal-atual.anterior.sqlite', 'portal-atual.tmp.sqlite', 'pre-expurgo.sqlite']) {
    const arquivo = path.join(pasta, nome);
    if (fs.existsSync(arquivo) && fs.lstatSync(arquivo).isFile()) fs.unlinkSync(arquivo);
  }
  const historico = path.join(pasta, 'historico');
  if (!fs.existsSync(historico) || fs.lstatSync(historico).isSymbolicLink() || !fs.lstatSync(historico).isDirectory()) return;
  for (const nome of fs.readdirSync(historico)) {
    const arquivo = path.join(historico, nome);
    if (/^portal-\d{4}-\d{2}-\d{2}\.sqlite$/.test(nome) && fs.lstatSync(arquivo).isFile()) fs.unlinkSync(arquivo);
  }
  if (!fs.readdirSync(historico).length) fs.rmdirSync(historico);
}
