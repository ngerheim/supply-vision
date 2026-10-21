import { AsyncLocalStorage } from 'node:async_hooks';
const chave = Symbol.for('supply-vision:conexao');
export const conexao = globalThis[chave] ??= new AsyncLocalStorage();
export const ipConexao = () => conexao.getStore() || 'local';
