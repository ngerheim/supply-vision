import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { privado } from '../scripts/caminhos.mjs';

// Consulta ao Qlik para a calculadora de Reembolso. Reaproveita o Python do
// Alertas (mesma conexao e credencial privada) num processo que fica aberto
// com a sessao do Qlik: so a primeira consulta paga a abertura do app.
// Pedidos e respostas sao linhas JSON; a placa chega ja validada e o
// processo e chamado sem shell. O Portal roda com a pasta portal/ como
// diretorio de trabalho; o Alertas fica ao lado.
export type ConsultaPlaca = (placa: string) => Promise<unknown>;
export class ConsultaIndisponivel extends Error {}

const TEMPO_LIMITE_MS = 60_000;
// O Qlik encerra sessoes paradas; fechar antes evita a primeira consulta
// depois de um intervalo falhar e ter de reabrir.
const OCIOSO_MS = 15 * 60_000;
const SAIDA_MAXIMA = 16 * 1024 * 1024;

type Pendente = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; limite: NodeJS.Timeout };
let processo: ChildProcessWithoutNullStreams | null = null;
let proximoId = 1, ocioso: NodeJS.Timeout | null = null, resto = '';
const pendentes = new Map<number, Pendente>();

function encerrar(motivo: string) {
  const p = processo;
  processo = null; resto = '';
  if (ocioso) { clearTimeout(ocioso); ocioso = null; }
  for (const [id, pend] of pendentes) { clearTimeout(pend.limite); pendentes.delete(id); pend.reject(new ConsultaIndisponivel(motivo)); }
  if (p && p.exitCode === null) p.kill();
}

function iniciar(): ChildProcessWithoutNullStreams {
  if (processo) return processo;
  const alertas = path.resolve(process.cwd(), '..', 'alertas');
  const python = path.join(alertas, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) throw new ConsultaIndisponivel('Python do Alertas não encontrado neste servidor.');
  const filho = spawn(python, ['processo/consultar_os_placa.py', '--servidor'], {
    cwd: alertas, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, SUPPLY_VISION_PRIVADO: privado, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
  });
  processo = filho;
  let erros = '';
  filho.stdout.setEncoding('utf8');
  filho.stderr.setEncoding('utf8');
  filho.stderr.on('data', (parte: string) => { erros = (erros + parte).slice(-4000); });
  filho.stdout.on('data', (parte: string) => {
    resto += parte;
    if (resto.length > SAIDA_MAXIMA) { encerrar('Resposta do Qlik grande demais.'); return; }
    let fim;
    while ((fim = resto.indexOf('\n')) >= 0) {
      const linha = resto.slice(0, fim).trim(); resto = resto.slice(fim + 1);
      if (!linha.startsWith('RESULTADO_JSON=')) continue;
      let resposta: Record<string, unknown>;
      try { resposta = JSON.parse(linha.slice('RESULTADO_JSON='.length)) as Record<string, unknown>; } catch { continue; }
      const pend = pendentes.get(Number(resposta.id));
      if (!pend) continue;
      pendentes.delete(Number(resposta.id)); clearTimeout(pend.limite);
      if (typeof resposta.erro === 'string') {
        console.error(`[reembolso] consulta ao Qlik falhou: ${resposta.erro}`);
        pend.reject(new ConsultaIndisponivel('A consulta ao Qlik falhou.'));
      } else pend.resolve(resposta);
    }
  });
  filho.once('error', erro => { if (processo === filho) encerrar(`Consulta ao Qlik indisponível: ${erro.message}`); });
  // Escrever no stdin de um Python que acabou de cair gera EPIPE/EOF no stream.
  // Sem ouvinte, o erro vira excecao nao tratada e derruba o Portal inteiro.
  filho.stdin.on('error', erro => { if (processo === filho) encerrar(`Consulta ao Qlik indisponível: ${erro.message}`); });
  filho.once('exit', codigo => {
    if (processo !== filho) return;
    if (codigo) console.error(`[reembolso] processo de consulta ao Qlik saiu (código ${codigo}): ${erros.trim().split(/\r?\n/).at(-1) ?? ''}`);
    encerrar('A consulta ao Qlik foi interrompida.');
  });
  return filho;
}

function pedir(corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let filho;
    try { filho = iniciar(); } catch (erro) { reject(erro); return; }
    const id = proximoId++;
    // Sem resposta no prazo, a sessao esta em estado ruim: reinicia tudo.
    const limite = setTimeout(() => { if (pendentes.has(id)) encerrar('O Qlik demorou demais para responder.'); }, TEMPO_LIMITE_MS);
    pendentes.set(id, { resolve, reject, limite });
    if (ocioso) clearTimeout(ocioso);
    ocioso = setTimeout(() => { if (!pendentes.size) encerrar('ocioso'); }, OCIOSO_MS);
    filho.stdin.write(`${JSON.stringify({ id, ...corpo })}\n`);
  });
}

const consultarPython: ConsultaPlaca = async placa => (await pedir({ placa })).linhas;

// Mesma placa pedida de novo enquanto a consulta roda espera a mesma resposta.
let consultar: ConsultaPlaca = consultarPython;
const emAndamento = new Map<string, Promise<unknown>>();
export function consultarPlacaQlik(placa: string): Promise<unknown> {
  const atual = emAndamento.get(placa);
  if (atual) return atual;
  const nova = consultar(placa).finally(() => emAndamento.delete(placa));
  emAndamento.set(placa, nova);
  return nova;
}
// Abre a sessao com o Qlik antes da primeira placa (ao abrir a calculadora).
export function aquecerQlik() {
  if (consultar !== consultarPython || processo) return;
  pedir({ aquecer: true }).catch(() => undefined);
}
// Testes e demonstracao trocam a consulta real por uma ficticia.
export function trocarConsultaPlaca(nova: ConsultaPlaca | null) { consultar = nova ?? consultarPython; }
