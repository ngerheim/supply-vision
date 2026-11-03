import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { bancoFicticio } from './apoio/backup.mjs';
import { destinoBanco } from '../scripts/banco-local.mjs';
import { portaSemServico } from '../scripts/porta-teste.mjs';
import { ATIVOS_PRIVADOS, configuracaoPermitida, listarConfiguracao, montarPacote, validarPacote } from '../scripts/backup-pacote.mjs';
import { restaurarCopia } from '../scripts/restaurar-backup.mjs';

const escrever = (raiz, nome, conteudo) => { fs.mkdirSync(path.dirname(path.join(raiz, nome)), { recursive: true }); fs.writeFileSync(path.join(raiz, nome), conteudo); };

void test('backup leva o template do contrato e a marca; pacote antigo nao apaga os atuais', async t => {
  const ensaio = process.env.MODO_ENSAIO;
  delete process.env.MODO_ENSAIO;
  const dir = criarTemporarioTeste('sv-backup-ativos-');
  t.after(() => { if (ensaio === undefined) delete process.env.MODO_ENSAIO; else process.env.MODO_ENSAIO = ensaio; fs.rmSync(dir, { recursive: true, force: true }); });
  const raiz = path.join(dir, 'privado');
  bancoFicticio(destinoBanco('fixture.sqlite', path.join(raiz, 'portal'))).close();
  escrever(raiz, 'portal/configuracao/portal.env', `PORTAL_PORTA=${await portaSemServico()}\nRELATORIOS_PORTA=${await portaSemServico()}\n`);
  // Pacote antigo: ainda sem template nem marca.
  const antigo = path.join(dir, 'antigo');
  montarPacote(antigo, { raiz });
  const metaAntigo = validarPacote(antigo);
  assert.equal(Object.hasOwn(metaAntigo.arquivos, ATIVOS_PRIVADOS[0]), false);

  escrever(raiz, ATIVOS_PRIVADOS[0], 'template ficticio');
  escrever(raiz, ATIVOS_PRIVADOS[1], '<svg/>');
  escrever(raiz, 'portal/contratos/outro.docx', 'nao entra');
  assert.deepEqual(listarConfiguracao(raiz).filter(n => n.startsWith('portal/contratos/') || n.startsWith('portal/marca/')), ATIVOS_PRIVADOS);
  assert.equal(configuracaoPermitida('portal/contratos/outro.docx'), false);
  const novo = path.join(dir, 'novo');
  montarPacote(novo, { raiz });
  const metaNovo = validarPacote(novo);
  for (const nome of ATIVOS_PRIVADOS) assert.ok(Object.hasOwn(metaNovo.arquivos, nome), nome);

  // Restaurar o antigo mantem o template e a marca atuais.
  await restaurarCopia(path.join(antigo, 'banco/portal.sqlite'), { raiz, pasta: antigo, meta: metaAntigo, configuracao: true });
  assert.equal(fs.readFileSync(path.join(raiz, ATIVOS_PRIVADOS[0]), 'utf8'), 'template ficticio');
  // Arquivo perdido volta com o pacote novo, byte a byte.
  fs.rmSync(path.join(raiz, ATIVOS_PRIVADOS[0]));
  await restaurarCopia(path.join(novo, 'banco/portal.sqlite'), { raiz, pasta: novo, meta: metaNovo, configuracao: true });
  assert.equal(fs.readFileSync(path.join(raiz, ATIVOS_PRIVADOS[0]), 'utf8'), 'template ficticio');
  assert.equal(fs.readFileSync(path.join(raiz, ATIVOS_PRIVADOS[1]), 'utf8'), '<svg/>');
});
