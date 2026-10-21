import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VALIDACAO, VALIDACAO_ATIVA_SQL } from '../lib/operacao-validacao.ts';
import { localizarBanco } from './banco-local.mjs';
import { privado } from './configuracao.mjs';

export function validacaoAtiva(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='operacao_validacao'").get()
    && !!db.prepare(VALIDACAO_ATIVA_SQL).get();
}
export function configurarValidacao(db, ativa) {
  db.exec(SCHEMA_VALIDACAO);
  db.prepare('INSERT INTO operacao_validacao(id,ativa) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET ativa=excluded.ativa').run(ativa ? 1 : 0);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const ativa=process.argv[2]==='--ativar';
  if (!ativa && process.argv[2]!=='--liberar') throw new Error('Use --ativar ou --liberar.');
  const arquivo=localizarBanco();if(!arquivo)throw new Error('Banco da operacao nao encontrado.');
  const sinal=path.join(privado,'operacao/validacao-atualizacao.sinal');
  if(ativa){fs.mkdirSync(path.dirname(sinal),{recursive:true});fs.writeFileSync(sinal,'validacao');}
  const db=new DatabaseSync(arquivo);
  if(!ativa)fs.rmSync(sinal,{force:true});
  try { db.exec('PRAGMA busy_timeout=5000');configurarValidacao(db,ativa); } finally { db.close(); }
}
