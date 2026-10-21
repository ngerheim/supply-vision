import { AsyncLocalStorage } from 'node:async_hooks';

type Autor = { id: string; role: string; token: string };
const contexto = new AsyncLocalStorage<{ autor?: Autor }>();

export const comContextoEscrita = <T>(operacao: () => T): T => contexto.run({}, operacao);
export function definirAutorEscrita(autor: Autor) {
  const atual = contexto.getStore();
  if (atual) atual.autor = autor;
}
export const autorEscrita = () => contexto.getStore()?.autor;
export class SessaoRevogada extends Error {
  constructor() { super('Sua sessão ou permissão mudou. Entre novamente antes de salvar.'); }
}
