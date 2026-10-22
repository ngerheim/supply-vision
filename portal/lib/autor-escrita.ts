import { AsyncLocalStorage } from 'node:async_hooks';

type Autor = { id: string; role: string; token: string };
const contexto = new AsyncLocalStorage<{ autor?: Autor; notificacoesProprias?: boolean }>();

export const comContextoEscrita = <T>(operacao: () => T): T => contexto.run({}, operacao);
export function definirAutorEscrita(autor: Autor) {
  const atual = contexto.getStore();
  if (atual) atual.autor = autor;
}
export const autorEscrita = () => contexto.getStore()?.autor;
// Marcar recibos pessoais nao exige perfil de escrita; a sessao ainda e
// revalidada pelo adaptador dentro da transacao, como nas demais escritas.
export const escritaNotificacoesProprias = () => contexto.getStore()?.notificacoesProprias === true;
export const comEscritaNotificacoesProprias = <T>(operacao: () => T): T => contexto.run({ ...contexto.getStore(), notificacoesProprias: true }, operacao);
export class SessaoRevogada extends Error {
  constructor() { super('Sua sessão ou permissão mudou. Entre novamente antes de salvar.'); }
}
