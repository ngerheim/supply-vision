import { AsyncLocalStorage } from 'node:async_hooks';
import type { Acao } from './permissoes.ts';

type Autor = { id: string; role: string; token: string };
const contexto = new AsyncLocalStorage<{ autor?: Autor; acao?: Acao }>();

export const comContextoEscrita = <T>(operacao: () => T): T => contexto.run({}, operacao);
export function definirAutorEscrita(autor: Autor) {
  const atual = contexto.getStore();
  if (atual) atual.autor = autor;
}
export const autorEscrita = () => contexto.getStore()?.autor;
// A acao delimita uma operacao ja autorizada; posse continua no SQL do handler.
export const acaoEscritaAutorizada = () => contexto.getStore()?.acao;
export const comAcaoEscrita = <T>(acao: Acao, operacao: () => T): T => contexto.run({ ...contexto.getStore(), acao }, operacao);
export class SessaoRevogada extends Error {
  constructor() { super('Sua sessão ou permissão mudou. Entre novamente antes de salvar.'); }
}
