// syncBuiltinESMExports nao atualiza os exports experimentais de node:sqlite.
// O preload ja protegeu o export CommonJS; imports ESM usam o mesmo construtor.
export function resolve(specifier, context, nextResolve) {
  if (specifier === 'node:sqlite' && !context.conditions.includes('require')) return { url: 'sv-preparo:sqlite', shortCircuit: true };
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (url !== 'sv-preparo:sqlite') return nextLoad(url, context);
  return { format: 'module', shortCircuit: true, source: `
    import { createRequire } from 'node:module';
    const sqlite = createRequire(${JSON.stringify(import.meta.url)})('node:sqlite');
    export const DatabaseSync = sqlite.DatabaseSync;
    export const StatementSync = sqlite.StatementSync;
    export const constants = sqlite.constants;
    export const backup = sqlite.backup;
    export default sqlite;
  ` };
}
