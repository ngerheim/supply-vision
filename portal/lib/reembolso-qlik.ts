import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { privado } from '../scripts/caminhos.mjs';

// Consulta ao Qlik para a calculadora de Reembolso. Reaproveita o Python do
// Alertas (mesma conexao e credencial privada), chamado sem shell e com a
// placa ja validada. O Portal roda com a pasta portal/ como diretorio de
// trabalho; o Alertas fica ao lado.
export type ConsultaPlaca = (placa: string) => Promise<unknown>;
export class ConsultaIndisponivel extends Error {}

const TEMPO_LIMITE_MS = 90_000;
const MAXIMO_SIMULTANEAS = 3;
const SAIDA_MAXIMA = 16 * 1024 * 1024;

function consultarPython(placa: string): Promise<unknown> {
  const alertas = path.resolve(process.cwd(), '..', 'alertas');
  const python = path.join(alertas, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) return Promise.reject(new ConsultaIndisponivel('Python do Alertas não encontrado neste servidor.'));
  return new Promise((resolve, reject) => {
    let saida = '', erros = '';
    const filho = spawn(python, ['processo/consultar_os_placa.py', placa], {
      cwd: alertas, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SUPPLY_VISION_PRIVADO: privado, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
    });
    const limite = setTimeout(() => { filho.kill(); reject(new ConsultaIndisponivel('O Qlik demorou demais para responder.')); }, TEMPO_LIMITE_MS);
    filho.stdout.setEncoding('utf8');
    filho.stderr.setEncoding('utf8');
    filho.stdout.on('data', (parte: string) => { saida += parte; if (saida.length > SAIDA_MAXIMA) filho.kill(); });
    filho.stderr.on('data', (parte: string) => { erros = (erros + parte).slice(-4000); });
    filho.once('error', erro => { clearTimeout(limite); reject(new ConsultaIndisponivel(erro.message)); });
    filho.once('close', codigo => {
      clearTimeout(limite);
      const linha = saida.split(/\r?\n/).find(l => l.startsWith('RESULTADO_JSON='));
      if (codigo !== 0 || !linha) {
        console.error(`[reembolso] consulta ao Qlik falhou (código ${codigo}): ${erros.trim().split(/\r?\n/).at(-1) ?? ''}`);
        reject(new ConsultaIndisponivel('A consulta ao Qlik falhou.'));
        return;
      }
      try { resolve((JSON.parse(linha.slice('RESULTADO_JSON='.length)) as { linhas?: unknown }).linhas); }
      catch { reject(new ConsultaIndisponivel('Resposta do Qlik ilegível.')); }
    });
  });
}

// Mesma placa pedida de novo enquanto a consulta roda espera a mesma
// resposta; no maximo algumas consultas ao Qlik ao mesmo tempo.
let consultar: ConsultaPlaca = consultarPython;
const emAndamento = new Map<string, Promise<unknown>>();
let ativas = 0;
const fila: (() => void)[] = [];
async function comVaga<T>(tarefa: () => Promise<T>): Promise<T> {
  if (ativas >= MAXIMO_SIMULTANEAS) await new Promise<void>(r => fila.push(r));
  ativas++;
  try { return await tarefa(); } finally { ativas--; fila.shift()?.(); }
}
export function consultarPlacaQlik(placa: string): Promise<unknown> {
  const atual = emAndamento.get(placa);
  if (atual) return atual;
  const nova = comVaga(() => consultar(placa)).finally(() => emAndamento.delete(placa));
  emAndamento.set(placa, nova);
  return nova;
}
// Testes e demonstracao trocam a consulta real por uma ficticia.
export function trocarConsultaPlaca(nova: ConsultaPlaca | null) { consultar = nova ?? consultarPython; }
